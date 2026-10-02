import type { Edge } from './types'

const JS_SPEC = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\(\s*)['"]([^'"\n]+)['"]/g
const PY_FROM = /^\s*from\s+(\.*[\w.]*)\s+import\s+([\w\s,*()]+)/
const PY_IMPORT = /^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/
const PY_OPEN_PAREN = /^\s*from\s+\.*[\w.]*\s+import\s*\(/
const PY_STATEMENT = /^\s*(from\s+\.*[\w.]*\s+)?import\s/

const JS_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.json', '.vue', '.svelte']
const JS_INDEX = ['index.ts', 'index.tsx', 'index.js', 'index.jsx', 'index.mjs']
const DECLARATION = /\.d\.(m|c)?ts$/

/** A tsconfig or jsconfig, by its file name. */
const TS_CONFIG = /(^|\/)[tj]sconfig[^/]*\.json$/
const PACKAGE_JSON = /(^|\/)package\.json$/
const PNPM_WORKSPACE = /(^|\/)pnpm-workspace\.yaml$/
/** A package's entry fields, read in this order. */
const ENTRY_FIELDS = ['source', 'module', 'main', 'types']
/** Conditions of `exports` and `imports` read first, as Node and the TypeScript compiler read them. */
const CONDITIONS = new Set(['types', 'import', 'require', 'node', 'default'])
/** Folders whose package.json gives way to another of the same name. */
const FIXTURE = /(^|\/)(node_modules|fixtures?|__fixtures__|__tests__|tests?)\//
/** JSONC's extras: a string (kept), a comment, or a comma before a closing bracket. */
const JSONC = /"(?:[^"\\]|\\.)*"|\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|,(?=(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*[}\]])/g

/** Extensions of the files an import can name, so an empty one still belongs on the map. */
export const IMPORTABLE = [...JS_EXT, '.py']

export const isPython = (path: string): boolean => path.endsWith('.py')

/** One `git grep -n` row: a source line, its file and its line number. */
export type Row = { path: string; line: number; text: string }

/** `a/b/../c/./d` → `a/c/d`; null when it climbs out of the repo. */
export function normalize(path: string): string | null {
  const out: string[] = []

  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (out.length === 0) return null
      out.pop()
    } else out.push(part)
  }

  return out.join('/')
}

const dirOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
const joined = (dir: string, rest: string): string | null => normalize(dir === '' ? rest : `${dir}/${rest}`)

/** The index file of a folder ('' is the repo root). */
const indexIn = (dir: string | null, files: ReadonlySet<string>): string | null =>
  dir === null ? null : JS_INDEX.map(i => (dir === '' ? i : `${dir}/${i}`)).find(c => files.has(c)) ?? null

/** The file a path names: the file itself, its TypeScript twin, or the path with an extension. */
function fileAt(base: string, files: ReadonlySet<string>): string | null {
  if (base === '') return null
  const candidates = [base]
  const ext = /\.(m|c)?jsx?$/.exec(base)

  if (ext !== null) {
    const stem = base.slice(0, -ext[0].length)

    candidates.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.cts`)
  }
  for (const e of JS_EXT) candidates.push(base + e)

  return candidates.find(c => files.has(c)) ?? null
}

/** A JSONC text (comments and trailing commas allowed) as an object, or null. */
export function parseJsonc(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text.replace(JSONC, t => (t.startsWith('"') ? t : '')))

    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const recordOf = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

/** The entry of a `paths`, `exports` or `imports` map for `spec`: the exact key, else the `*` key with the longest prefix, and the text its `*` stands for. */
function bestMatch(map: Record<string, unknown>, spec: string): { value: unknown; star: string } | null {
  if (Object.hasOwn(map, spec)) return { value: map[spec], star: '' }
  let best: { value: unknown; star: string; prefix: number } | null = null

  for (const [key, value] of Object.entries(map)) {
    const at = key.indexOf('*')

    if (at < 0 || key.includes('*', at + 1)) continue
    const prefix = key.slice(0, at)
    const suffix = key.slice(at + 1)

    if (spec.length >= key.length - 1 && spec.startsWith(prefix) && spec.endsWith(suffix) && (best === null || prefix.length > best.prefix)) {
      best = { value, star: spec.slice(prefix.length, spec.length - suffix.length), prefix: prefix.length }
    }
  }
  return best
}

/** The paths in an entry (a path, a list of fallbacks or an object of conditions, the common ones first), `*` filled in, declaration files last. */
function targetsOf(entry: { value: unknown; star: string } | null): string[] {
  const out: string[] = []
  const walk = (v: unknown) => {
    if (typeof v === 'string') out.push(v.replaceAll('*', entry?.star ?? ''))
    else if (Array.isArray(v)) v.forEach(walk)
    else if (typeof v === 'object' && v !== null) {
      const conditions = Object.entries(v)

      for (const [, x] of [...conditions.filter(([k]) => CONDITIONS.has(k)), ...conditions.filter(([k]) => !CONDITIONS.has(k))]) walk(x)
    }
  }

  if (entry !== null) walk(entry.value)
  return [...out.filter(t => !DECLARATION.test(t)), ...out.filter(t => DECLARATION.test(t))]
}

/** The entry a package's `exports` gives a subpath ('.' or './sub'). */
function exported(exports: unknown, subpath: string): { value: unknown; star: string } | null {
  if (typeof exports === 'string' || Array.isArray(exports)) return subpath === '.' ? { value: exports, star: '' } : null
  const map = recordOf(exports)

  if (!Object.keys(map).some(k => k.startsWith('.'))) return subpath === '.' && Object.keys(map).length > 0 ? { value: map, star: '' } : null
  return bestMatch(map, subpath)
}

/** A workspace glob as a regex over folders: `*` is one folder name, `**` any number of folders. */
function globOf(base: string, glob: string): RegExp | null {
  const path = joined(base, glob.replace(/\/+$/, ''))

  if (path === null) return null
  const source = path
    .split('/')
    .map(part => (part === '**' ? '\0' : part.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '[^/]*')))
    .join('/')
    .replaceAll('\0/', '(?:[^/]+/)*')
    .replaceAll('/\0', '(?:/[^/]+)*')
    .replaceAll('\0', '.*')

  return new RegExp(`^${source}$`)
}

/** The `packages` globs of a pnpm-workspace.yaml. */
function pnpmGlobs(text: string): string[] {
  const block = /^packages:[ \t]*\n((?:[ \t]+-.*\n?|[ \t]*#.*\n?|[ \t]*\n)*)/m.exec(text)?.[1] ?? ''

  return block.split('\n').map(l => /^\s+-\s*(['"]?)(.*?)\1\s*(#.*)?$/.exec(l)?.[2] ?? '').filter(Boolean)
}

/** A tracked package.json: its folder and its fields. */
export type Package = { dir: string; json: Record<string, unknown> }

/** The `compilerOptions` that map a bare specifier, as repo paths: `baseUrl` (null when it leaves the repo) and `paths` with the folder they are relative to. */
type PathOptions = { baseUrl?: string | null; paths?: { base: string; map: Record<string, unknown> } }

/** How a repo resolves bare JS/TS specifiers, read from its tracked tsconfig, jsconfig and package.json files. */
export type JsRules = {
  /** The repo paths a bare specifier names through the nearest tsconfig.json or jsconfig.json: its `paths` targets, then `baseUrl`. */
  aliased(from: string, spec: string): string[]
  /** The nearest package.json at or above a folder. */
  packageAt(dir: string): Package | null
  /** The package.json in a folder. */
  packageIn(dir: string): Package | undefined
  /**
   * The repo package a package manager links under this name: a folder a workspace declares
   * (package.json `workspaces`, pnpm-workspace.yaml) or a `link:` or `file:` dependency names.
   * Where several share the name, the one outside fixture and test folders, then the shallowest.
   */
  named(name: string): Package | undefined
}

/** The rules from config files, each path to its text. */
export function jsRulesOf(texts: ReadonlyMap<string, string>): JsRules {
  const configs = new Map<string, Record<string, unknown> | null>()
  const packages = new Map<string, Package>()
  const names = new Map<string, Package>()
  const rank = (dir: string) => (FIXTURE.test(`${dir}/`) ? 1000 : 0) + (dir === '' ? 0 : dir.split('/').length)
  const declared: { glob: RegExp; negated: boolean }[] = []
  const linked = new Set<string>()
  const declare = (base: string, glob: unknown) => {
    if (typeof glob !== 'string') return
    const negated = glob.startsWith('!')
    const re = globOf(base, negated ? glob.slice(1) : glob)

    if (re !== null) declared.push({ glob: re, negated })
  }

  for (const [path, text] of texts) {
    if (TS_CONFIG.test(path)) configs.set(path, parseJsonc(text))
    if (PNPM_WORKSPACE.test(path)) for (const glob of pnpmGlobs(text)) declare(dirOf(path), glob)
    const json = PACKAGE_JSON.test(path) ? parseJsonc(text) : null

    if (json !== null) packages.set(dirOf(path), { dir: dirOf(path), json })
  }
  for (const { dir, json } of packages.values()) {
    const workspaces = Array.isArray(json.workspaces) ? json.workspaces : recordOf(json.workspaces).packages

    if (Array.isArray(workspaces)) for (const glob of workspaces) declare(dir, glob)
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      for (const version of Object.values(recordOf(json[field]))) {
        const target = typeof version === 'string' && /^(link|file):/.test(version) ? joined(dir, version.slice(5)) : null

        if (target !== null) linked.add(target)
      }
    }
  }
  // workspace globs never reach into node_modules, as npm, yarn and pnpm read them
  const isLinked = (dir: string) =>
    linked.has(dir) ||
    (!/(^|\/)node_modules(\/|$)/.test(dir) && declared.some(d => !d.negated && d.glob.test(dir)) && !declared.some(d => d.negated && d.glob.test(dir)))

  for (const pkg of packages.values()) {
    const name = pkg.json.name
    const had = typeof name === 'string' ? names.get(name) : undefined

    if (typeof name !== 'string' || !isLinked(pkg.dir)) continue
    if (had === undefined || rank(pkg.dir) < rank(had.dir) || (rank(pkg.dir) === rank(had.dir) && pkg.dir < had.dir)) names.set(name, pkg)
  }

  const options = new Map<string, PathOptions | null>()
  /** A config's options over those of the configs it extends, inside the repo. */
  const optionsOf = (path: string, seen: ReadonlySet<string> = new Set()): PathOptions | null => {
    const known = options.get(path)

    if (known !== undefined) return known
    const json = configs.get(path)

    if (json == null || seen.has(path)) return null
    const dir = dirOf(path)
    const extended = Array.isArray(json.extends) ? json.extends : [json.extends]
    let out: PathOptions = {}

    for (const spec of extended) {
      if (typeof spec !== 'string' || !(spec.startsWith('./') || spec.startsWith('../'))) continue
      const target = joined(dir, spec)
      const file = target === null ? undefined : [target, `${target}.json`].find(p => configs.has(p))

      if (file !== undefined) out = { ...out, ...optionsOf(file, new Set([...seen, path])) }
    }
    const own = recordOf(json.compilerOptions)

    if (typeof own.baseUrl === 'string') out.baseUrl = joined(dir, own.baseUrl)
    if (typeof own.paths === 'object' && own.paths !== null) out.paths = { base: dir, map: recordOf(own.paths) }
    options.set(path, out)
    return out
  }

  const nearest = new Map<string, PathOptions | null>()
  const nearestTo = (dir: string): PathOptions | null => {
    const known = nearest.get(dir)

    if (known !== undefined) return known
    const here = ['tsconfig.json', 'jsconfig.json'].map(n => (dir === '' ? n : `${dir}/${n}`)).find(p => configs.has(p))
    const found = here !== undefined ? optionsOf(here) : dir === '' ? null : nearestTo(dirOf(dir))

    nearest.set(dir, found)
    return found
  }

  const packageMemo = new Map<string, Package | null>()
  const packageAt = (dir: string): Package | null => {
    const known = packageMemo.get(dir)

    if (known !== undefined) return known
    const found = packages.get(dir) ?? (dir === '' ? null : packageAt(dirOf(dir)))

    packageMemo.set(dir, found)
    return found
  }

  return {
    aliased(from, spec) {
      const o = configs.size === 0 ? null : nearestTo(dirOf(from))

      if (o === null || o.baseUrl === null) return []
      const base = o.baseUrl ?? o.paths?.base ?? ''
      const out = o.paths === undefined ? [] : targetsOf(bestMatch(o.paths.map, spec)).map(t => joined(base, t))

      if (o.baseUrl !== undefined) out.push(joined(o.baseUrl, spec))
      return out.filter((p): p is string => p !== null)
    },
    packageAt: dir => (packages.size === 0 ? null : packageAt(dir)),
    packageIn: dir => packages.get(dir),
    named: name => names.get(name),
  }
}

const NO_RULES = jsRulesOf(new Map())

/** `@scope/name/sub` as `['@scope/name', 'sub']`; a name with no subpath has ''. */
function packageSplit(spec: string): [string, string] {
  const parts = spec.split('/')
  const n = spec.startsWith('@') ? 2 : 1

  return [parts.slice(0, n).join('/'), parts.slice(n).join('/')]
}

/** The first entry field of a package that names a file, or a folder with an index. */
function entryOf(pkg: Package, files: ReadonlySet<string>): string | null {
  for (const field of ENTRY_FIELDS) {
    const value = pkg.json[field]
    const path = typeof value === 'string' ? joined(pkg.dir, value) : null
    const hit = path === null ? null : (fileAt(path, files) ?? indexIn(path, files))

    if (hit !== null) return hit
  }
  return null
}

/** The repo file a specifier's path names: a file, else for a folder its package.json entry or its index. */
function probe(base: string | null, files: ReadonlySet<string>, rules: JsRules): string | null {
  if (base === null) return null
  const file = fileAt(base, files)

  if (file !== null) return file
  const pkg = rules.packageIn(base)

  return (pkg === undefined ? null : entryOf(pkg, files)) ?? indexIn(base, files)
}

/** The first of `targets`, relative to `dir`, that names a repo file. */
function firstFile(dir: string, targets: readonly string[], files: ReadonlySet<string>, rules: JsRules): string | null {
  for (const t of targets) {
    const hit = probe(joined(dir, t), files, rules)

    if (hit !== null) return hit
  }
  return null
}

/**
 * The repo file a JS/TS specifier names, or null for a package outside the repo or a miss.
 * A bare specifier goes through tsconfig `paths` and `baseUrl`, then package.json `imports`
 * for `#name`, then the repo's own linked packages by name, then `@/` and `~/` as `src/`.
 */
export function resolveJs(from: string, spec: string, files: ReadonlySet<string>, rules: JsRules = NO_RULES): string | null {
  if (spec.startsWith('.')) return probe(joined(dirOf(from), spec), files, rules)
  if (spec.startsWith('/')) return null
  const aliased = firstFile('', rules.aliased(from, spec), files, rules)

  if (aliased !== null) return aliased
  if (spec.startsWith('#')) {
    const pkg = rules.packageAt(dirOf(from))
    const targets = pkg === null ? [] : targetsOf(bestMatch(recordOf(pkg.json.imports), spec)).filter(t => t.startsWith('./'))

    return pkg === null ? null : firstFile(pkg.dir, targets, files, rules)
  }

  const [name, sub] = packageSplit(spec)
  const pkg = rules.named(name)

  if (pkg !== undefined) {
    const exports = firstFile(pkg.dir, targetsOf(exported(pkg.json.exports, sub === '' ? '.' : `./${sub}`)), files, rules)

    if (sub !== '') return exports ?? probe(joined(pkg.dir, sub), files, rules)
    return exports ?? entryOf(pkg, files) ?? indexIn(pkg.dir, files) ?? indexIn(joined(pkg.dir, 'src'), files)
  }
  if (spec.startsWith('@/') || spec.startsWith('~/')) return probe(`src/${spec.slice(2)}`, files, rules)
  return null
}

/** Where Python looks for an absolute import: the folders that are packages (they hold an `__init__.py`) and the sys.path roots. */
type PyLayout = { packages: ReadonlySet<string>; roots: string[] }

const layouts = new WeakMap<ReadonlySet<string>, PyLayout>()

/** The sys.path roots are the repo root, `src/` and the parent of every top-level package (a package whose parent folder is none); worked out once per file set. */
function layoutOf(files: ReadonlySet<string>): PyLayout {
  const known = layouts.get(files)

  if (known !== undefined) return known
  const packages = new Set<string>()

  for (const f of files) if (f === '__init__.py' || f.endsWith('/__init__.py')) packages.add(dirOf(f))
  const roots = new Set(['', 'src'])

  for (const p of [...packages].sort()) if (p !== '' && !packages.has(dirOf(p))) roots.add(dirOf(p))
  const layout = { packages, roots: [...roots] }

  layouts.set(files, layout)
  return layout
}

/**
 * The repo files a Python import line names: a module, or its submodules for `from x import a, b`,
 * else the package itself for a name that is no submodule. An absolute import is Python 3's: it
 * looks beside the importing file only when that file sits outside any package (a script, a test folder).
 */
export function resolvePython(from: string, line: string, files: ReadonlySet<string>): string[] {
  const found = new Set<string>()
  // every root is a normalized folder, so a module's path is the root and the dotted name joined
  const tryModule = (dotted: string, roots: readonly string[]) => {
    const rel = dotted.split('.').filter(Boolean).join('/')

    if (rel === '') return false
    for (const root of roots) {
      const stem = root === '' ? rel : `${root}/${rel}`

      for (const path of [`${stem}.py`, `${stem}/__init__.py`]) {
        if (files.has(path)) {
          found.add(path)
          return true
        }
      }
    }
    return false
  }

  const here = dirOf(from)
  const layout = layoutOf(files)
  const absolute = layout.packages.has(here) ? layout.roots : [here, ...layout.roots]
  const fromMatch = PY_FROM.exec(line)

  if (fromMatch !== null) {
    const mod = fromMatch[1] ?? ''
    const names = (fromMatch[2] ?? '').replace(/[()]/g, '').split(',').map(s => s.trim().split(/\s+/)[0] ?? '')
    const dots = /^\.*/.exec(mod)?.[0].length ?? 0
    let roots: string[]

    if (dots > 0) {
      let dir: string | null = here

      for (let i = 1; i < dots && dir !== null; i++) dir = dir === '' ? null : dirOf(dir)
      roots = dir === null ? [] : [dir]
    } else roots = absolute

    const rest = mod.slice(dots)
    const init = dots > 0 && rest === '' && roots[0] !== undefined ? joined(roots[0], '__init__.py') : null

    for (const name of names) {
      if (name === '') continue
      const isSubmodule = name !== '*' && tryModule(rest === '' ? name : `${rest}.${name}`, roots)

      // `from . import name` takes a name that is no submodule from the package's own __init__.py
      if (!isSubmodule && init !== null && files.has(init)) found.add(init)
    }
    if (rest !== '') tryModule(rest, roots)

    return [...found]
  }

  const importMatch = PY_IMPORT.exec(line)

  if (importMatch !== null) {
    for (const dotted of (importMatch[1] ?? '').split(',')) tryModule(dotted.trim(), absolute)
  }

  return [...found]
}

/**
 * The import statements among a Python file's grep rows, in order: each import line, and an
 * import that runs on over several lines, `from x import (` to `)`, joined into the row of its
 * first line. The other rows are lines that may continue an import: a block reads them while
 * they come one after another, so a comment line inside it ends it early.
 */
export function joinedPython(rows: readonly Row[]): Row[] {
  const out: Row[] = []
  let open: Row | null = null
  let last = 0

  for (const row of rows) {
    const code = row.text.replace(/#.*/, '')
    const isImport = PY_STATEMENT.test(code)

    if (open !== null && (isImport || row.path !== open.path || row.line !== last + 1)) {
      out.push(open)
      open = null
    }
    last = row.line
    if (open !== null) {
      open.text += ` ${code.trim()}`
      if (code.includes(')')) {
        out.push(open)
        open = null
      }
    } else if (isImport && PY_OPEN_PAREN.test(code) && !code.includes(')')) open = { ...row, text: code.trim() }
    else if (isImport) out.push(row)
  }
  if (open !== null) out.push(open)
  return out
}

/** Edges from `git grep` hits: each `{ path, text }` is one matched source line, or a Python import joined into one. */
export function edgesOf(hits: readonly { path: string; text: string }[], files: ReadonlySet<string>, rules: JsRules = NO_RULES): Edge[] {
  const seen = new Set<string>()
  const edges: Edge[] = []
  const add = (from: string, to: string | null) => {
    if (to === null || to === from) return
    const key = `${from}\n${to}`

    if (seen.has(key)) return
    seen.add(key)
    edges.push({ from, to })
  }

  for (const { path, text } of hits) {
    if (isPython(path)) {
      for (const to of resolvePython(path, text, files)) add(path, to)
      continue
    }
    for (const m of text.matchAll(JS_SPEC)) add(path, resolveJs(path, m[1] ?? '', files, rules))
  }

  return edges
}
