/**
 * Import-graph accuracy: isobar's grep-and-regex edges against a compiler's over the same
 * files. JS/TS repos are resolved by the TypeScript compiler API, Python repos by grimp.
 *
 *   tsx bench/imports.mts [--only vite,django]    (PYTHON names a python with grimp installed)
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BENCH, git, graph, imports, median, picked, rootOf, round, run, save, ts, type Repo } from './isobar.mts'

const here = dirname(fileURLToPath(import.meta.url))

// A copy of imports.ts's specifier regex, used only to say which specifier made an edge.
const JS_SPEC = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\(\s*)['"]([^'"\n]+)['"]/g

const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/
const DECLARATION = /\.d\.(m|c)?ts$/
const MINIFIED = /\.min\.[cm]?js$/

/** One edge and the import that made it. */
type Edge = { from: string; to: string; spec: string; line?: number }
type Cause = { cause: string; count: number; example: string }

const extOf = (p: string) => /\.[^./]+$/.exec(p)?.[0] ?? '(none)'
const countBy = (xs: string[]) => Object.fromEntries([...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]))
const key = (e: { from: string; to: string }) => `${e.from}\n${e.to}`
const byKey = (edges: Edge[]) => {
  const m = new Map<string, Edge>()

  for (const e of edges) if (e.from !== e.to && !m.has(key(e))) m.set(key(e), e)
  return m
}

/** isobar's edges, each with the specifier or line that made it, and every specifier and line it read: the hits and rules gatherFacts uses. */
async function isobarEdges(root: string, files: ReadonlySet<string>) {
  const { hits, configs } = await git.importSources(run, root)
  const rules = imports.jsRulesOf(configs)
  const edges: Edge[] = []
  const specs = new Map<string, Set<string>>()
  const lines = new Map<string, string>()

  for (const h of hits) {
    if (imports.isPython(h.path)) {
      lines.set(`${h.path}:${h.line}`, h.text)
      for (const to of imports.resolvePython(h.path, h.text, files)) edges.push({ from: h.path, to, spec: h.text.trim(), line: h.line })
      continue
    }
    for (const m of h.text.matchAll(JS_SPEC)) {
      const spec = m[1] ?? ''
      const to = imports.resolveJs(h.path, spec, files, rules)

      specs.set(h.path, (specs.get(h.path) ?? new Set()).add(spec))
      if (to !== null) edges.push({ from: h.path, to, spec, line: h.line })
    }
  }
  return { edges: byKey(edges), specs, lines, rules }
}

/** Tallies causes, most common first, keeping the first example of each. */
function tally(rows: { cause: string; example: string }[]): Cause[] {
  const m = new Map<string, Cause>()

  for (const r of rows) {
    const c = m.get(r.cause)

    if (c === undefined) m.set(r.cause, { cause: r.cause, count: 1, example: r.example })
    else c.count++
  }
  return [...m.values()].sort((a, b) => b.count - a.count)
}

/** Names of the repo's workspace packages, from package.json `workspaces` or pnpm-workspace.yaml. */
function workspacesOf(root: string, tracked: ReadonlySet<string>): Set<string> {
  const read = (p: string) => (tracked.has(p) ? readFileSync(resolve(root, p), 'utf8') : '')
  const pkg = read('package.json') ? JSON.parse(read('package.json')).workspaces : undefined
  const pnpm = /^packages:\s*\n((?:\s+-.*\n?)+)/m.exec(read('pnpm-workspace.yaml'))?.[1] ?? ''
  const globs: string[] = [
    ...(Array.isArray(pkg) ? pkg : pkg?.packages ?? []),
    ...pnpm.split('\n').map(l => l.replace(/^\s*-\s*/, '').replace(/['"]/g, '').trim()).filter(Boolean),
  ]
  const patterns = globs.map(g => new RegExp(`^${g.replace(/\/$/, '').replace(/[.+^${}()|[\]]/g, '\\$&').replace(/\*\*/g, '\0').replace(/\*/g, '[^/]*').replace(/\0/g, '.*')}$`))
  const names = new Set<string>()

  for (const p of tracked) {
    if (!p.endsWith('package.json') || p.includes('node_modules/')) continue
    const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''

    if (dir === '' || !patterns.some(re => re.test(dir))) continue
    try {
      const name = JSON.parse(read(p)).name

      if (typeof name === 'string') names.add(name)
    } catch {}
  }
  return names
}

/** The JS/TS edges the TypeScript compiler resolves, plus how many it could not and why. */
function compilerEdges(root: string, tracked: ReadonlySet<string>, sources: readonly string[], targets: ReadonlySet<string>) {
  const inside = (p: string) => p === root || p.startsWith(`${root}/`)
  const host = {
    useCaseSensitiveFileNames: true,
    fileExists: (p: string) => inside(p) && ts.sys.fileExists(p),
    readFile: (p: string) => (inside(p) ? ts.sys.readFile(p) : undefined),
    directoryExists: (p: string) => inside(p) && ts.sys.directoryExists(p),
    realpath: (p: string) => ts.sys.realpath(p),
    getCurrentDirectory: () => root,
    readDirectory: () => [],
  }
  // Every option comes from the nearest config, except that a .js or .json target always counts.
  const FORCED = { allowJs: true, resolveJsonModule: true }
  const FALLBACK = { moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, ...FORCED }
  const configs = new Map<string, { options: object; cache: unknown }>()
  const nearest = new Map<string, string>()
  const configErrors = new Set<string>()

  const settingsFor = (file: string) => {
    const dir = dirname(file)
    let path = nearest.get(dir)

    if (path === undefined) {
      const found = ['tsconfig.json', 'jsconfig.json'].map(n => ts.findConfigFile(dir, host.fileExists, n) as string | undefined).filter(Boolean) as string[]

      path = found.sort((a, b) => b.length - a.length)[0] ?? ''
      nearest.set(dir, path)
    }
    let s = configs.get(path)

    if (s === undefined) {
      let options: object = FALLBACK

      if (path !== '') {
        const read = ts.readConfigFile(path, host.readFile)
        const parsed = read.error ? null : ts.parseJsonConfigFileContent(read.config, host, dirname(path), undefined, path)
        // TS18003 (no inputs) is expected: the host lists no files, since only the options matter.
        const errors = parsed === null ? [read.error] : parsed.errors.filter((d: { code: number }) => d.code !== 18003)

        if (errors.length > 0) configErrors.add(relative(root, path))
        options = parsed === null ? FALLBACK : { ...parsed.options, ...FORCED }
      }
      s = { options, cache: ts.createModuleResolutionCache(root, (x: string) => x, options) }
      configs.set(path, s)
    }
    return s
  }

  const workspaces = workspacesOf(root, tracked)
  const packageOf = (spec: string) => spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/')
  const sourceOf = (rel: string) => {
    if (!DECLARATION.test(rel)) return rel
    const stem = rel.replace(DECLARATION, '')

    return ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'].map(e => stem + e).find(c => targets.has(c)) ?? null
  }

  const edges: Edge[] = []
  /** file → specifier → the tracked file it resolves to, or a reason it does not */
  const seen = new Map<string, Map<string, string>>()
  const counts = { specifiers: 0, workspaceUnresolved: 0, packages: 0, unresolvedRelative: 0, declarationOnly: 0, untracked: 0 }
  const workspaceExamples: string[] = []
  const unresolvedTypes: string[] = []

  for (const from of sources) {
    const abs = resolve(root, from)
    const { options, cache } = settingsFor(abs)
    const specs = new Map<string, string>()

    seen.set(from, specs)
    for (const { fileName: spec } of ts.preProcessFile(readFileSync(abs, 'utf8'), true, true).importedFiles) {
      if (specs.has(spec)) continue
      counts.specifiers++
      const m = ts.resolveModuleName(spec, abs, options, host, cache).resolvedModule
      const bare = !spec.startsWith('.') && !spec.startsWith('/')
      const miss = (why: keyof typeof counts) => (counts[why]++, `:${why}`)
      let at: string

      if (m === undefined) {
        at = !bare ? miss('unresolvedRelative') : workspaces.has(packageOf(spec)) ? miss('workspaceUnresolved') : miss('packages')
        if (at === ':workspaceUnresolved' && workspaceExamples.length < 3) workspaceExamples.push(`${from} → ${spec}`)
        if (at === ':unresolvedRelative') unresolvedTypes.push(extOf(spec))
      } else if (m.isExternalLibraryImport || m.resolvedFileName.includes('/node_modules/')) at = miss('packages')
      else {
        const rel = sourceOf(relative(root, m.resolvedFileName))

        at = rel === null ? miss('declarationOnly') : !tracked.has(rel) ? miss('untracked') : rel
        if (rel !== null && targets.has(rel)) edges.push({ from, to: rel, spec })
      }
      specs.set(spec, at)
    }
  }
  return { edges: byKey(edges), seen, counts, workspaces, workspaceExamples, unresolvedTypes: countBy(unresolvedTypes), configs: configs.size, configErrors: [...configErrors].sort() }
}

/** grimp's edges for one Python package, from pygraph.py, and the import lines of every file it parsed. */
function grimpEdges(repo: Repo, root: string) {
  const venv = resolve(BENCH, 'venv/bin/python')
  const python = process.env.PYTHON ?? (existsSync(venv) ? venv : 'python3')
  const out = JSON.parse(execFileSync(python, [resolve(here, 'pygraph.py'), root, repo.package ?? '', repo.path ?? ''], { maxBuffer: 256 << 20 }).toString())
  const edges = (out.edges as [string, string, number, string][]).map(([from, to, line, spec]) => ({ from, to, line, spec }))
  const importLines = new Map(Object.entries(out.importLines as Record<string, number[]>).map(([f, l]) => [f, new Set(l)]))

  return { edges: byKey(edges), importLines, modules: out.modules as number, portions: out.portions as string[], version: `grimp ${out.grimp}` }
}

const isAlias = (spec: string) => spec.startsWith('@/') || spec.startsWith('~/')

/** Why isobar drew a JS/TS edge the compiler does not. */
function jsFalse(e: Edge, seen: Map<string, Map<string, string>>) {
  const at = seen.get(e.from)?.get(e.spec)
  const cause =
    at === undefined ? 'matched text the compiler does not read as an import (inside a string or template, or a method called `import`)'
    : !at.startsWith(':') ? 'the compiler resolves the specifier to another file'
    : at === ':packages' ? 'the compiler resolves the specifier to a package'
    : at === ':workspaceUnresolved' ? 'a workspace package the compiler cannot resolve without node_modules links'
    : isAlias(e.spec) ? '`@/` or `~/` read as src/, which this repo maps elsewhere or not at all'
    : at === ':unresolvedRelative' ? 'the compiler finds no file for the specifier'
    : at === ':declarationOnly' ? 'the compiler resolves the specifier to a declaration file with no source beside it'
    : `the compiler cannot resolve the specifier (${at.slice(1)})`

  return { cause, example: `${e.from} → '${e.spec}' (isobar: ${e.to}${at && !at.startsWith(':') ? `, compiler: ${at}` : ''})` }
}

/** Why isobar missed an edge the compiler resolves. */
function jsMiss(t: Edge, specs: Map<string, Set<string>>, files: ReadonlySet<string>, workspaces: ReadonlySet<string>, rules: unknown) {
  const guess = imports.resolveJs(t.from, t.spec, files, rules)
  const name = t.spec.split('/').slice(0, t.spec.startsWith('@') ? 2 : 1).join('/')
  const cause =
    !t.spec.startsWith('.') && !isAlias(t.spec)
      ? t.spec.startsWith('#') ? 'a package.json `imports` (#) specifier isobar does not resolve'
        : workspaces.has(name) ? 'a workspace package name the compiler maps through tsconfig paths, which isobar does not resolve'
        : 'a path alias (tsconfig paths or baseUrl) isobar does not resolve'
    : !files.has(t.to) ? "a file off isobar's file list: a symlink, which `git grep` never reads"
    : !(specs.get(t.from)?.has(t.spec) ?? false) ? "an import isobar's line pattern does not match (a template literal, or a comment between `import(` and the string)"
    : guess === null && imports.normalize(`${dirname(t.from)}/${t.spec}`) === '' ? "the repository root as a folder ('..', '../..'): resolveJs probes '/index.js' there, never 'index.js'"
    : guess === null ? 'a relative specifier isobar cannot resolve'
    : 'isobar resolves the specifier to another file'

  return { cause, example: `${t.from} → '${t.spec}' (compiler: ${t.to}${guess ? `, isobar: ${guess}` : ''})` }
}

/** Why isobar drew a Python edge grimp does not. */
function pyFalse(e: Edge, pkg: string, importLines: Map<string, Set<number>>, files: ReadonlySet<string>) {
  const from = /^\s*from\s+(\.*)([\w.]*)\s+import\b/.exec(e.spec)
  const dotted = from ? from[2] ?? '' : /^\s*import\s+([\w.]+)/.exec(e.spec)?.[1] ?? ''
  const isAbsolute = from === null || from[1] === ''
  const ofPackage = from !== null && imports.resolvePython(e.from, `from ${from[1]}${from[2]} import *`, files).includes(e.to)
  const cause =
    !(importLines.get(e.from)?.has(e.line ?? 0) ?? true) ? 'a line that is no import statement (inside a docstring or string)'
    : isAbsolute && dotted.split('.')[0] !== pkg ? 'an absolute import read as a sibling module (Python 2 lookup)'
    : ofPackage ? 'the package itself, for `from pkg import submodule`'
    : 'other'

  return { cause, example: `${e.from}:${e.line} → '${e.spec}' (isobar: ${e.to})` }
}

/** Why isobar missed an edge grimp finds. */
function pyMiss(t: Edge, lines: Map<string, string>, files: ReadonlySet<string>) {
  const text = lines.get(`${t.from}:${t.line}`)
  const cause =
    !files.has(t.to) ? "a file off isobar's file list: a symlink, which `git grep` never reads"
    : text === undefined ? "an import isobar's line pattern does not match"
    : /[(\\]\s*(#.*)?$/.test(text) ? 'a module named on the continuation lines of a multi-line import'
    : /^\s*from\s+\.+\s+import\b/.test(text) ? 'a name from the package itself (`from . import name`), where isobar looks only for a submodule'
    : 'isobar resolves the line to other files'

  return { cause, example: `${t.from}:${t.line} → '${t.spec.trim()}' (grimp: ${t.to})` }
}

/** How far isobar's "N files depend on it" is from the compiler's, for its 20 most-imported files. */
function dependents(truth: Edge[], iso: Edge[]) {
  const gt = graph.graphOf(truth)
  const gi = graph.graphOf(iso)
  const top = [...gt.in as Map<string, string[]>].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).slice(0, 20)
  const rows = top.map(([file]) => ({ file, compiler: graph.dependentsOf(gt, file) as number, isobar: graph.dependentsOf(gi, file) as number }))
  const errors = rows.map(r => Math.abs(r.isobar - r.compiler) / r.compiler)

  return {
    files: rows.length,
    differ: rows.filter(r => r.isobar !== r.compiler).length,
    medianRelativeError: round(median(errors), 3),
    meanRelativeError: round(errors.reduce((s, x) => s + x, 0) / Math.max(1, errors.length), 3),
    rows,
  }
}

const rows = []

for (const repo of picked()) {
  const root = rootOf(repo)
  const facts = await git.gatherFacts(run, root)
  const files = new Set<string>(facts.lines.keys())
  const iso = await isobarEdges(root, files)
  const factKeys = new Set((facts.edges as Edge[]).map(key))
  const emulation = { matches: factKeys.size === iso.edges.size && [...iso.edges.keys()].every(k => factKeys.has(k)), gatherFacts: factKeys.size, here: iso.edges.size }
  let truth: Map<string, Edge>
  let compared: Edge[]
  let falseEdges: { cause: string; example: string }[]
  let ground: Record<string, unknown>

  if (repo.lang === 'js') {
    const tracked = new Set((await run(['git', '-C', root, 'ls-files', '-z'])).stdout.split('\0').filter(Boolean))
    const sources = [...tracked].filter(p => SOURCE.test(p) && !DECLARATION.test(p) && !MINIFIED.test(p) && existsSync(resolve(root, p))).sort()
    const sourceSet = new Set(sources)
    const targets = new Set([...tracked].filter(p => (SOURCE.test(p) && !DECLARATION.test(p)) || p.endsWith('.json')))
    const t0 = performance.now()
    const tsc = compilerEdges(root, tracked, sources, targets)
    const inSet = (e: Edge) => sourceSet.has(e.from) && targets.has(e.to)
    const out = [...iso.edges.values()].filter(e => !inSet(e))

    truth = tsc.edges
    compared = [...iso.edges.values()].filter(inSet)
    falseEdges = compared.filter(e => !truth.has(key(e))).map(e => jsFalse(e, tsc.seen))
    const misses = [...truth.values()].filter(t => !iso.edges.has(key(t))).map(t => jsMiss(t, iso.specs, files, tsc.workspaces, iso.rules))

    ground = {
      by: `typescript ${ts.version}`, seconds: round((performance.now() - t0) / 1000), sourceFiles: sources.length, configs: tsc.configs, configErrors: tsc.configErrors,
      specifiers: tsc.counts, workspaceExamples: tsc.workspaceExamples, unresolvedRelativeByType: tsc.unresolvedTypes,
      isobarEdgesLeftOut: { total: out.length, fromSourceType: countBy(out.filter(e => !sourceSet.has(e.from)).map(e => extOf(e.from))), toFileType: countBy(out.filter(e => sourceSet.has(e.from)).map(e => extOf(e.to))) },
      missCauses: tally(misses),
    }
  } else {
    const py = grimpEdges(repo, root)
    const pkgFiles = new Set([...py.importLines.keys(), ...[...py.edges.values()].flatMap(e => [e.from, e.to])])

    truth = py.edges
    compared = [...iso.edges.values()].filter(e => pkgFiles.has(e.from) && pkgFiles.has(e.to))
    falseEdges = compared.filter(e => !truth.has(key(e))).map(e => pyFalse(e, repo.package ?? '', py.importLines, files))
    const misses = [...truth.values()].filter(t => !iso.edges.has(key(t))).map(t => pyMiss(t, iso.lines, files))

    ground = { by: py.version, modules: py.modules, files: pkgFiles.size, portions: py.portions, missCauses: tally(misses) }
  }

  const agreed = compared.filter(e => truth.has(key(e))).length
  const row = {
    repo: repo.name,
    compilerEdges: truth.size,
    isobarEdges: compared.length,
    agreed,
    precision: round(agreed / compared.length, 3),
    recall: round(agreed / truth.size, 3),
    falseCauses: tally(falseEdges),
    ...ground,
    dependents: dependents([...truth.values()], compared),
    emulation,
  }

  console.log(JSON.stringify({ repo: row.repo, compilerEdges: row.compilerEdges, isobarEdges: row.isobarEdges, precision: row.precision, recall: row.recall, dependents: row.dependents.medianRelativeError, emulation }))
  rows.push(row)
}

save(process.argv.includes('--only') ? `imports-${process.argv[process.argv.indexOf('--only') + 1]}` : 'imports', { rows })
