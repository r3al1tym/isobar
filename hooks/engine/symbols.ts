import { graphOf, reachOf, type Graph, type Reach } from './graph'
import { isPython } from './imports'
import type { Change, Facts, Run } from './types'

/**
 * How a change touches what other files use. `signature` changes a declaration's header (its
 * name, parameters or type, or adds or removes it); `body` changes only what it does;
 * `comments` touches only comments, docstrings and blank lines; `imports` only the file's own
 * imports. `file` is a change read file-wide: module-level code, a new or deleted file, or a
 * language the reader does not parse.
 */
export type Kind = 'signature' | 'body' | 'comments' | 'imports' | 'file'

/** One declaration a change touched: a function, class, method, field, type or constant. */
export type Touch = { name: string; kind: 'signature' | 'body' | 'comments'; owner?: string }

/** A changed file read declaration by declaration. */
export type Shape = {
  path: string
  /** the strongest kind among its touches; `file` when it must be read whole */
  kind: Kind
  touches: Touch[]
  /** what another file mentions to use what changed: the touched names, and the names here that call them */
  words: string[]
  /** the words among them that name a method or field: used through an object, from any distance */
  members: string[]
}

/** A file that uses what a change touched: it depends on the changed file and names a touched word. */
export type User = Reach & {
  /** lines that name a touched word, its imports left out */
  uses: number
  /** the changed file whose words it names */
  of: string
}

/** One source line as the reader sees it: its code with comments cut, and what kind of line it is. */
type Line = { code: string; indent: number; isQuiet: boolean; isImport: boolean; isInString: boolean }

/** A declaration's span, its header (what callers see) and its code (what it does), whitespace folded. */
type Decl = { name: string; owner?: string; start: number; end: number; header: string; code: string; members: Decl[]; isClass: boolean; isPrivate: boolean }

/** The most declarations a file is read for; past it the file is read whole. */
const MAX_LINES = 20_000
/** The most changed files read declaration by declaration in one refresh. */
const MAX_FILES = 40
/** The most words one change asks git about. */
const MAX_WORDS = 60

const isJs = (path: string) => /\.(m|c)?[jt]sx?$/.test(path) && !/\.d\.(m|c)?ts$/.test(path)
const fold = (s: string) => s.replace(/\s+/g, ' ').trim()
const KIND_ORDER: Kind[] = ['imports', 'comments', 'body', 'signature', 'file']
export const strongest = (kinds: readonly Kind[]): Kind => kinds.reduce<Kind>((a, b) => (KIND_ORDER.indexOf(b) > KIND_ORDER.indexOf(a) ? b : a), 'imports')

const JS_IMPORT = /^\s*(import\b(?!\s*\()|export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s*from\b|(?:const|let|var)\s+[\w${},\s:]+=\s*require\()/
const PY_IMPORT = /^\s*(from\s+[.\w]+\s+import\b|import\s+[\w.])/

/** Reads `text` line by line: comments cut, docstrings and blank lines quiet, string and import lines marked. */
export function linesOf(text: readonly string[], lang: 'js' | 'py'): Line[] {
  const out: Line[] = []
  let inBlock = false
  let inTemplate = false
  let triple: string | null = null
  let isDoc = false
  let inImport = false

  for (const raw of text) {
    const indent = /^\s*/.exec(raw)?.[0].length ?? 0

    if (lang === 'py') {
      if (triple !== null) {
        const closes = raw.includes(triple)

        out.push({ code: isDoc ? '' : raw, indent, isQuiet: isDoc, isImport: false, isInString: true })
        if (closes) triple = null
        continue
      }
      const code = raw.replace(/(^|\s)#.*$/, '').trimEnd()
      const opens = /("""|''')/.exec(code)

      if (opens !== null && !code.slice(opens.index + 3).includes(opens[1]!)) {
        // a string left open: a docstring when it is the whole statement, else a string inside code
        triple = opens[1]!
        isDoc = /^\s*[rRbBuUfF]{0,2}("""|''')/.test(code)
      }
      const isDocLine = /^\s*[rRbBuUfF]{0,2}("""|''')/.test(code) && (triple === null || isDoc)
      const isImport = inImport || PY_IMPORT.test(code)

      if (isImport) inImport = (inImport || code.includes('(')) && !code.includes(')')
      out.push({ code: isDocLine ? '' : code, indent, isQuiet: isDocLine || code.trim() === '', isImport, isInString: false })
      continue
    }

    let code = raw
    const wasInTemplate = inTemplate

    if (inBlock) {
      const end = code.indexOf('*/')

      if (end < 0) {
        out.push({ code: '', indent, isQuiet: true, isImport: false, isInString: false })
        continue
      }
      code = code.slice(end + 2)
      inBlock = false
    }
    code = code.replace(/\/\*.*?\*\//g, '')
    if (!wasInTemplate && code.includes('/*')) {
      code = code.slice(0, code.indexOf('/*'))
      inBlock = true
    }
    code = code.replace(/(^|[^:'"`\\])\/\/.*$/, '$1').trimEnd()
    if ((code.match(/(?<!\\)`/g) ?? []).length % 2 === 1) inTemplate = !inTemplate
    const isImport = inImport || (!wasInTemplate && JS_IMPORT.test(code))

    if (isImport) inImport = !/\bfrom\s*['"]|require\(|^\s*import\s*['"]/.test(code) && !/^\s*import\b.*;\s*$/.test(code)
    out.push({ code, indent, isQuiet: code.trim() === '', isImport, isInString: wasInTemplate })
  }
  return out
}

const JS_DECL = /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(function\*?|class|interface|type|enum|const|let|var|namespace)\b\s*([A-Za-z_$][\w$]*)?/
const JS_ASSIGN = /^(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=(?!=)|^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.([A-Za-z_$][\w$]*)\s*=(?![=>])/
const JS_TYPE_ONLY = /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:interface|type|enum|namespace|declare)\b/
const JS_MEMBER = /^(?:(?:public|private|protected|static|readonly|async|override|abstract|declare|accessor|get|set)\s+)*(#?[A-Za-z_$][\w$]*)\s*[?!]?\s*(<[^>]*>\s*)?([(:=;])/
const JS_NOT_MEMBER = new Set(['if', 'for', 'while', 'switch', 'return', 'await', 'yield', 'throw', 'new', 'super', 'this'])
const PY_DECL = /^(?:async\s+)?(def|class)\s+(\w+)/
const PY_ASSIGN = /^([A-Za-z_]\w*)\s*(?::[^=]*)?=(?!=)|^([A-Za-z_]\w*)\s*:\s*\S/
const CLOSER = /^[\])}]/

/** The name a top-level line declares, or null for a statement; `export default` without a name is `default`. */
function nameAt(code: string, lang: 'js' | 'py'): string | null {
  if (lang === 'py') {
    const m = PY_DECL.exec(code) ?? PY_ASSIGN.exec(code)

    return m === null ? null : m[2] ?? m[1] ?? null
  }
  const m = JS_DECL.exec(code)

  if (m !== null && (m[2] !== undefined || /^export\s+default\b/.test(code))) return m[2] ?? 'default'
  if (/^export\s+default\b/.test(code)) return 'default'
  const a = JS_ASSIGN.exec(code)

  return a === null ? null : a[1] ?? a[2] ?? null
}

/** The name a class-body line declares (a method or field), or null. */
function memberAt(code: string, lang: 'js' | 'py'): string | null {
  if (lang === 'py') {
    const m = PY_DECL.exec(code) ?? PY_ASSIGN.exec(code)

    return m === null ? null : m[2] ?? m[1] ?? null
  }
  const m = JS_MEMBER.exec(code)

  return m === null || JS_NOT_MEMBER.has(m[1]!) ? null : m[1]!
}

/** The first index of `token` at bracket depth 0 from `from`, strings skipped; `=` alone, never `==`, `=>`, `<=`. */
function depth0(text: string, token: string, from = 0): number {
  let depth = 0
  let quote: string | null = null

  for (let i = from; i < text.length; i++) {
    const ch = text[i]!

    if (quote !== null) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch
    else if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1)
    else if (depth === 0 && text.startsWith(token, i)) {
      if (token !== '=' || (!'=>'.includes(text[i + 1] ?? '') && !'=!<>+-*/%&|^'.includes(text[i - 1] ?? ''))) return i
    }
  }
  return -1
}

/** What callers see of a declaration: its decorators and signature, a type whole, a value's name and type. */
function headerOf(text: string, lang: 'js' | 'py'): string {
  if (lang === 'py') {
    if (/^(@.*\n)*\s*(async\s+)?(def|class)\b/.test(text)) {
      const colon = /\)\s*(->[^:]*)?:|^\s*class\s+\w+\s*:|^\s*(async\s+)?def\s+\w+\s*:/m.exec(text)

      return colon === null ? text : text.slice(0, colon.index + colon[0].length)
    }
    const eq = depth0(text, '=')

    return eq < 0 ? text : text.slice(0, eq)
  }
  if (JS_TYPE_ONLY.test(text.replace(/^(@.*\n)*/, ''))) return text
  const eq = depth0(text, '=')
  const isValue = /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(const|let|var)\b/.test(text) || JS_ASSIGN.test(text) || /^#?[\w$]+\s*[?!]?\s*(:[^=]*)?=/.test(text)

  if (isValue && eq >= 0) {
    const right = text.slice(eq + 1).trimStart()

    if (/^(async\s+)?function\b/.test(right)) {
      const brace = depth0(text, '{', eq + 1)

      return brace < 0 ? text : text.slice(0, brace)
    }
    if (/^(async\s+)?(\(|<|[A-Za-z_$][\w$]*\s*=>)/.test(right)) {
      const arrow = depth0(text, '=>', eq + 1)

      if (arrow >= 0) return text.slice(0, arrow)
    }
    return text.slice(0, eq)
  }
  const brace = depth0(text, '{')

  return brace < 0 ? text : text.slice(0, brace)
}

/** The code of lines `start` to `end`, quiet lines left out, each line's whitespace folded. */
const codeOf = (lines: readonly Line[], start: number, end: number) =>
  lines.slice(start, end + 1).filter(l => !l.isQuiet).map(l => fold(l.code)).join('\n')

/**
 * The declarations of a file: top-level ones begin on an unindented line that names something,
 * decorators included, and run until the next top-level statement; a class's members begin on
 * the class body's first indent.
 */
function declsOf(lines: readonly Line[], lang: 'js' | 'py'): Decl[] {
  const decls: Decl[] = []
  const exported = lang === 'js' ? exportsOf(lines) : new Set<string>()
  let open: { name: string; start: number } | null = null
  let decorated: number | null = null
  const close = (end: number) => {
    if (open !== null) decls.push(declOf(lines, lang, open.name, open.start, end, undefined, exported))
    open = null
  }

  lines.forEach((l, i) => {
    if (l.isQuiet || l.isInString || l.indent > 0) return
    const code = l.code.trim()

    if (code.startsWith('@')) {
      if (decorated === null) {
        close(i - 1)
        decorated = i
      }
      return
    }
    // a bracket closing the open declaration, or the end of a signature split over lines
    if (open !== null && CLOSER.test(code)) return
    const name = l.isImport ? null : nameAt(code, lang)

    close(i - 1)
    if (name !== null) open = { name, start: decorated ?? i }
    decorated = null
  })
  close(lines.length - 1)
  return decls
}

const isClassText = (text: string, lang: 'js' | 'py') =>
  lang === 'py' ? /^(@.*\n)*\s*class\b/.test(text) : /^(@.*\n)*\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?class\b/.test(text)

/**
 * Whether a declaration is private to its file: a leading underscore or `#`, a TypeScript
 * `private` or `protected` member, or a JS top-level declaration its file never exports.
 */
function isPrivateDecl(name: string, first: string, lang: 'js' | 'py', owner: string | undefined, exported: ReadonlySet<string>): boolean {
  if (name.startsWith('#') || (name.startsWith('_') && !/^__\w+__$/.test(name))) return true
  if (lang === 'py') return false
  if (owner !== undefined) return /^\s*(?:(?:readonly|static|override|abstract|async)\s+)*(?:private|protected)\b/.test(first)
  return !/^\s*export\b/.test(first) && !exported.has(name)
}

/** The names a JS file exports by name: `export { a, b as c }`, `exports.a =`, `module.exports = { a }` or `= a`. */
function exportsOf(lines: readonly Line[]): Set<string> {
  const out = new Set<string>()

  for (const l of lines) {
    for (const m of l.code.matchAll(/\b(?:module\.)?exports\.([A-Za-z_$][\w$]*)/g)) out.add(m[1]!)
    const list = /^\s*export\s*\{([^}]*)\}/.exec(l.code) ?? /\bmodule\.exports\s*=\s*\{([^}]*)\}/.exec(l.code)

    if (list !== null) for (const part of list[1]!.split(',')) out.add(part.trim().split(/\s+/)[0] ?? '')
    const one = /\bmodule\.exports\s*=\s*([A-Za-z_$][\w$]*)\s*;?\s*$/.exec(l.code)

    if (one !== null) out.add(one[1]!)
  }
  return out
}

/** One declaration from `start` to `end`; a top-level class reads its members too, and its own code leaves them out. */
function declOf(lines: readonly Line[], lang: 'js' | 'py', name: string, start: number, end: number, owner?: string, exported: ReadonlySet<string> = new Set()): Decl {
  const text = codeOf(lines, start, end)
  const first = lines.slice(start, end + 1).find(l => !l.isQuiet && !l.code.trim().startsWith('@'))?.code ?? ''
  const members = owner === undefined && isClassText(text, lang) ? membersOf(lines, lang, name, start, end, exported) : []
  const inMember = (i: number) => members.some(m => i >= m.start && i <= m.end)
  const own = members.length === 0 ? text : lines.slice(start, end + 1).filter((l, k) => !l.isQuiet && !inMember(start + k)).map(l => fold(l.code)).join('\n')

  return {
    name,
    ...(owner === undefined ? {} : { owner }),
    start,
    end,
    header: fold(headerOf(text, lang)),
    code: own,
    members,
    isClass: owner === undefined && isClassText(text, lang),
    isPrivate: isPrivateDecl(name, first, lang, owner, exported),
  }
}

/** A class's methods and fields: each begins on the body's first indent and runs to the next. */
function membersOf(lines: readonly Line[], lang: 'js' | 'py', owner: string, start: number, end: number, exported: ReadonlySet<string>): Decl[] {
  const body = lines.slice(start + 1, end + 1).find(l => !l.isQuiet && !l.isInString && l.indent > 0)?.indent

  if (body === undefined) return []
  const out: Decl[] = []
  let open: { name: string; start: number } | null = null
  let decorated: number | null = null
  const close = (to: number) => {
    if (open !== null) out.push(declOf(lines, lang, open.name, open.start, to, owner, exported))
    open = null
  }

  for (let i = start + 1; i <= end; i++) {
    const l = lines[i]!

    if (l.isQuiet || l.isInString || l.indent > body) continue
    const code = l.code.trim()

    if (l.indent < body) {
      close(i - 1)
      continue
    }
    if (code.startsWith('@')) {
      if (decorated === null) {
        close(i - 1)
        decorated = i
      }
      continue
    }
    if (open !== null && CLOSER.test(code)) continue
    const name = memberAt(code, lang)

    close(i - 1)
    if (name !== null) open = { name, start: decorated ?? i }
    decorated = null
  }
  close(end)
  return out
}

const keyOf = (d: { name: string; owner?: string }) => (d.owner === undefined ? d.name : `${d.owner}.${d.name}`)

/** A file read for its declarations: each line's innermost one, and every one by its name. */
function readOf(text: readonly string[], lang: 'js' | 'py') {
  const lines = linesOf(text, lang)
  const decls = declsOf(lines, lang)
  const byKey = new Map<string, Decl>()

  for (const d of decls.flatMap(d => [d, ...d.members])) {
    const prior = byKey.get(keyOf(d))

    // overloads and property setters share a name: they are read as one
    byKey.set(keyOf(d), prior === undefined ? d : { ...prior, header: `${prior.header}\n${d.header}`, code: `${prior.code}\n${d.code}` })
  }
  const at = (n: number): Decl | undefined => {
    const top = decls.find(d => n >= d.start && n <= d.end)

    return top?.members.find(m => n >= m.start && n <= m.end) ?? top
  }
  return { lines, decls, byKey, at }
}

/** A name that stands for its class: a constructor, or a dunder method Python calls on the class's own behalf. */
const isClassHook = (name: string) => name === 'constructor' || /^__\w+__$/.test(name)

const escaped = (w: string) => w.replace(/[$]/g, '\\$')
/** Whether `text` names `word` as a whole identifier. */
export const names = (text: string, words: readonly string[]): boolean =>
  words.length > 0 && new RegExp(`(?<![\\w$])(?:${words.map(escaped).join('|')})(?![\\w$])`).test(text)

/**
 * Whether `text` uses a method or field among `words`: through an object (`app.run`, `this?.run`),
 * or by defining it again in Python, as a subclass's override does. A bare `run(` is another function.
 */
export const namesMember = (text: string, words: readonly string[]): boolean =>
  words.length > 0 &&
  new RegExp(`(?:\\.|\\bdef\\s+)(?:${words.map(escaped).join('|')})(?![\\w$])`).test(text)

/**
 * A changed file read declaration by declaration: `before` and `after` are its lines, `removed`
 * and `added` the 1-based lines the diff touched on each side. A declaration whose header changed,
 * or which appeared or went, changed its signature; one whose code changed otherwise changed its
 * body; one whose code is the same changed only comments.
 */
export function shapeOf(path: string, before: readonly string[] | null, after: readonly string[] | null, removed: readonly number[], added: readonly number[]): Shape {
  const lang = isPython(path) ? 'py' : isJs(path) ? 'js' : null

  if (lang === null || before === null || after === null) return { path, kind: 'file', touches: [], words: [], members: [] }
  const old = readOf(before, lang)
  const now = readOf(after, lang)
  const touched = new Map<string, Decl>()
  const kinds: Kind[] = []
  const visit = (side: ReturnType<typeof readOf>, n: number) => {
    const d = side.at(n)
    const l = side.lines[n]

    if (d !== undefined) touched.set(keyOf(d), d)
    else kinds.push(l === undefined || l.isQuiet ? 'comments' : l.isImport ? 'imports' : 'file')
  }

  for (const n of removed) visit(old, n - 1)
  for (const n of added) visit(now, n - 1)
  const touches: Touch[] = [...touched].map(([key, d]) => {
    const o = old.byKey.get(key)
    const n = now.byKey.get(key)
    const kind = o === undefined || n === undefined ? 'signature' : o.code === n.code ? 'comments' : o.header !== n.header ? 'signature' : 'body'

    return { name: d.name, kind, ...(d.owner === undefined ? {} : { owner: d.owner }) }
  })
  // a default export is used under any name its importer picks, so only the file can say who uses it
  if (touches.some(t => t.name === 'default' && t.owner === undefined && t.kind !== 'comments')) kinds.push('file')
  const kind = strongest([...kinds, ...touches.map(t => t.kind)])

  const isPrivate = (t: Touch) => (now.byKey.get(keyOf(t)) ?? old.byKey.get(keyOf(t)))?.isPrivate === true

  return { path, kind, touches, ...wordsOf(touches, now.decls, isPrivate) }
}

/**
 * The words another file names to use what changed: each touched declaration's name (its class's
 * for a constructor). A private declaration has no users of its own, so the functions and methods
 * here that call it stand in for it, and theirs in turn while they are private too, two calls
 * deep. A public one's users are found directly; a class is never added for calling one.
 */
function wordsOf(touches: readonly Touch[], decls: readonly Decl[], isPrivate: (t: Touch) => boolean): { words: string[]; members: string[] } {
  const words = new Set<string>()
  const members = new Set<string>()
  const add = (d: { name: string; owner?: string }) => {
    const isHook = d.owner !== undefined && isClassHook(d.name)
    const word = isHook ? d.owner! : d.name

    if (word.length < 2 || word === 'default' || word.startsWith('#')) return
    words.add(word)
    if (d.owner !== undefined && !isHook) members.add(word)
  }
  const live = touches.filter(t => t.kind !== 'comments')
  let seeds = live.filter(isPrivate).map(t => t.name)

  for (const t of live) add(t)
  const all = decls.flatMap(d => [d, ...d.members]).filter(d => !d.isClass)

  for (let depth = 0; depth < 2 && seeds.length > 0 && words.size < MAX_WORDS; depth++) {
    const callers = all.filter(d => !words.has(d.name) && !seeds.includes(d.name) && names(d.code, seeds))

    callers.forEach(add)
    seeds = callers.filter(d => d.isPrivate).map(d => d.name)
  }
  const kept = [...words].slice(0, MAX_WORDS)

  return { words: kept, members: kept.filter(w => members.has(w)) }
}

/** `git diff -U0` hunks: per file, the 1-based lines removed from the old side and added on the new. */
export function hunksOf(diff: string): Map<string, { removed: number[]; added: number[] }> {
  const out = new Map<string, { removed: number[]; added: number[] }>()
  let at: { removed: number[]; added: number[] } | null = null
  let from = ''

  for (const line of diff.split('\n')) {
    if (line.startsWith('--- ')) from = line.slice(4).replace(/^a\//, '')
    else if (line.startsWith('+++ ')) {
      const to = line.slice(4).replace(/^b\//, '')
      const path = to === '/dev/null' ? from : to

      at = out.get(path) ?? { removed: [], added: [] }
      out.set(path, at)
    } else if (line.startsWith('@@') && at !== null) {
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)

      if (m === null) continue
      const [a, b, c, d] = [Number(m[1]), m[2] === undefined ? 1 : Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])]

      for (let i = 0; i < b; i++) at.removed.push(a + i)
      for (let i = 0; i < d; i++) at.added.push(c + i)
    }
  }
  return out
}

/** `git grep -z -n -e ''` rows, `[ref:]path\0line\0text`: each file's lines in order. */
export function textsOf(stdout: string, ref = ''): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const prefix = ref === '' ? '' : `${ref}:`

  for (const row of stdout.split('\n')) {
    const a = row.indexOf('\0')
    const b = a < 0 ? -1 : row.indexOf('\0', a + 1)

    if (b < 0) continue
    const path = row.slice(0, a).startsWith(prefix) ? row.slice(prefix.length, a) : row.slice(0, a)
    const lines = out.get(path) ?? []

    lines[Number(row.slice(a + 1, b)) - 1] = row.slice(b + 1).replace(/\r$/, '')
    out.set(path, lines)
  }
  for (const lines of out.values()) for (let i = 0; i < lines.length; i++) lines[i] ??= ''
  return out
}

/** A line that only imports or lists a name (an import, or one name on an import's continuation line): no use of it. */
const isListing = (text: string) => JS_IMPORT.test(text) || PY_IMPORT.test(text) || /^\s*[\w$]+(\s+as\s+[\w$]+)?,?\s*$/.test(text)
/** A comment line: a name in it is no use of the name. */
const isComment = (text: string) => /^\s*(\/\/|\/\*|\*|#)/.test(text)
/** A line with its string literals emptied, so a name inside one is no use of it. */
const unquoted = (text: string) => text.replace(/(["'`])(?:\\.|(?!\1).)*?\1/g, '""')
/** A file that passes its neighbours' names on: an index module or a package's `__init__.py`. */
const isBarrel = (path: string) => /(^|\/)(index\.[cm]?[jt]sx?|__init__\.py)$/.test(path)

/** What a change reads as, declaration by declaration, and the files that use what it touched. */
export type ChangeRead = { shapes: Map<string, Shape>; users: User[] }

/**
 * Reads the change in three git calls (the diff, the files before, the files after) and finds
 * its users in a fourth: files that depend on a changed file, at any distance, and name one of
 * its touched words. The change runs from the commit `from` to the commit `to`, or to the
 * working tree when `to` is absent.
 */
export async function readChange(
  run: Run,
  root: string,
  facts: Facts,
  changes: readonly Change[],
  refs: { from: string; to?: string },
  graph: Graph = graphOf(facts.edges),
): Promise<ChangeRead> {
  const git = (...args: string[]) => run(['git', '-C', root, ...args])
  const from = refs.from
  const to = refs.to === undefined ? [] : [refs.to]
  const readable = changes
    .filter(c => !c.isNew && !c.isDeleted && (isJs(c.path) || isPython(c.path)) && (facts.lines.get(c.path) ?? 0) <= MAX_LINES)
    .slice(0, MAX_FILES)
    .map(c => c.path)
  const shapes = new Map<string, Shape>(changes.map(c => [c.path, { path: c.path, kind: 'file', touches: [], words: [], members: [] }]))

  if (readable.length === 0) return { shapes, users: [] }
  const [diff, before, after] = await Promise.all([
    git('-c', 'core.quotePath=false', 'diff', '-U0', '--no-color', '--no-ext-diff', '--no-renames', from, ...to, '--', ...readable),
    git('grep', '-z', '-n', '-I', '-e', '', from, '--', ...readable),
    git('grep', '-z', '-n', '-I', '-e', '', ...to, '--', ...readable),
  ])

  if (diff.exitCode !== 0) return { shapes, users: [] }
  const hunks = hunksOf(diff.stdout)
  const old = textsOf(before.stdout, from)
  const now = textsOf(after.stdout, to[0] ?? '')

  for (const path of readable) {
    const h = hunks.get(path)

    if (h !== undefined) shapes.set(path, shapeOf(path, old.get(path) ?? null, now.get(path) ?? null, h.removed, h.added))
  }

  // the files each changed file reaches at any distance: its users are among them
  const used = [...shapes.values()].filter(s => (s.kind === 'signature' || s.kind === 'body') && s.words.length > 0)
  const reached = new Map(used.map(s => [s.path, new Map(reachOf(graph, [s.path], 64).map(r => [r.path, r]))]))
  const within = new Set([...reached.values()].flatMap(m => [...m.keys()]))
  const words = [...new Set(used.flatMap(s => s.words))]

  if (within.size === 0 || words.length === 0) return { shapes, users: [] }
  // past a few thousand files a pathspec costs more than the whole tree
  const hits = await git('grep', '-z', '-n', '-w', '-I', '-F', ...words.flatMap(w => ['-e', w]), ...to, '--', ...(within.size <= 4000 ? within : []))
  const rows = hitsOf(hits.stdout, to[0] ?? '')
  const users: User[] = []

  for (const s of used) {
    const reach = reached.get(s.path)!
    // a function, class or constant is named where it is in scope: in the files that import its
    // file, directly or through barrels; a method or field, wherever an object of it can travel
    const near = new Set<string>()

    for (const r of reach.values()) if (r.hop === 1 || (isBarrel(r.via) && near.has(r.via))) near.add(r.path)
    const tops = s.words.filter(w => !s.members.includes(w))
    const counts = new Map<string, number>()

    for (const r of rows) {
      if (!reach.has(r.path) || isComment(r.text)) continue
      const code = unquoted(r.text)

      if (!namesMember(code, s.members) && !(near.has(r.path) && names(code, tops))) continue
      counts.set(r.path, (counts.get(r.path) ?? 0) + (isListing(r.text) ? 0 : 1))
    }
    // each user, and the files its import chain passes through on the way (barrels, re-exports)
    const rowsOf = new Map<string, User>()

    for (const [path, uses] of counts) {
      for (let at = reach.get(path); at !== undefined && !rowsOf.has(at.path); at = reach.get(at.via)) {
        rowsOf.set(at.path, { ...at, uses: at.path === path ? uses : counts.get(at.path) ?? 0, of: s.path })
      }
    }
    users.push(...rowsOf.values())
  }
  return { shapes, users }
}

/** `git grep -z -n` rows, `[ref:]path\0line\0text`, as `{ path, text }`. */
function hitsOf(stdout: string, ref: string): { path: string; text: string }[] {
  const prefix = ref === '' ? '' : `${ref}:`
  const out: { path: string; text: string }[] = []

  for (const row of stdout.split('\n')) {
    const a = row.indexOf('\0')
    const b = a < 0 ? -1 : row.indexOf('\0', a + 1)

    if (b > 0) out.push({ path: row.slice(0, a).startsWith(prefix) ? row.slice(prefix.length, a) : row.slice(0, a), text: row.slice(b + 1) })
  }
  return out
}
