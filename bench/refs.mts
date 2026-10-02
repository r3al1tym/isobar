/**
 * Ground truth for bench/uses.mts: the references a language server finds to a file's
 * declarations. JS/TS through the TypeScript language service, one per nearest tsconfig.json
 * or jsconfig.json with allowJs on; Python through jedi, in bench/pyrefs.py.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { BENCH, ts } from './isobar.mts'

const here = dirname(fileURLToPath(import.meta.url))

/** A declaration to find: a top-level name, or a member of the top-level class `owner`. */
export type Spec = { name: string; owner?: string }

/** One search: how many declarations matched the spec, and every reference, marked when it sits in an import. */
export type Found = { found: number; timedOut: boolean; failed: boolean; refs: { path: string; isImport: boolean }[] }

export interface Truth {
  /** whether searches may run at once */
  parallel: boolean
  /** checks out the next commit: `files` are the tracked files at it */
  commit(sha: string, files: readonly string[]): void
  /** references to each spec in `file`; `scope` widens the project with files that may use it */
  refs(file: string, specs: readonly Spec[], scope: readonly string[]): Promise<Found[]>
  /**
   * Which of `words` the file `other` names in code, and which of `resolve` it names somewhere
   * the truth resolves to no declaration (a member of an untyped value), read in `file`'s project.
   */
  names(file: string, other: string, words: readonly string[], resolve: readonly string[]): Promise<{ named: string[]; unresolved: string[] }>
  /** whether `file` imports `target` itself */
  imports(file: string, target: string): Promise<boolean>
  /** whether the truth reads `file` at all */
  reads(file: string): boolean
  close(): void
}

/** A constructor or a dunder method stands for its class, as isobar reads it. */
export const isClassHook = (name: string) => name === 'constructor' || /^__\w+__$/.test(name)

const SOURCE = /\.(m|c)?[jt]sx?$/
const FORCED = { allowJs: true, noEmit: true }
const FALLBACK = { allowJs: true, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.Preserve }
const LIB = dirname(ts.getDefaultLibFilePath({}))
/** Language services kept at once: vscode's src/ alone holds about 4 GB. */
const KEEP = 2
/** jedi processes searching at once */
const WORKERS = 8

type Project = { config: string; options: object; version: number; service: any }

/** The declaration names in `sf` that `spec` points at. */
function locate(sf: any, spec: Spec): any[] {
  const text = (n: any) => (n !== undefined && (ts.isIdentifier(n) || ts.isPrivateIdentifier(n) || ts.isStringLiteral(n)) ? n.text : undefined)
  const out: any[] = []

  for (const st of sf.statements) {
    if (spec.owner !== undefined) {
      if (!ts.isClassDeclaration(st) || st.name?.text !== spec.owner) continue
      if (isClassHook(spec.name)) out.push(st.name)
      else for (const m of st.members) if (text(m.name) === spec.name) out.push(m.name)
    } else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st) || ts.isModuleDeclaration(st)) && text(st.name) === spec.name) {
      out.push(st.name)
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === spec.name) out.push(d.name)
    } else if (ts.isExpressionStatement(st)) {
      // `exports.name = …`, `a.b.name = …`, chained
      for (let e = st.expression; ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.EqualsToken; e = e.right) {
        if (ts.isPropertyAccessExpression(e.left) && e.left.name.text === spec.name) out.push(e.left.name)
      }
    }
  }
  return out
}

const isRequire = (e: any) => ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'require'

/** Whether the token at `pos` sits in an import: an import or `export … from` statement, or a destructured `require`. */
function isImportAt(sf: any, pos: number): boolean {
  for (let node = sf; node !== undefined; ) {
    const child = ts.forEachChild(node, (c: any) => (c.pos <= pos && pos < c.end ? c : undefined))

    if (child === undefined) return false
    if (ts.isImportDeclaration(child) || ts.isImportEqualsDeclaration(child) || (ts.isExportDeclaration(child) && child.moduleSpecifier !== undefined)) return true
    if (ts.isVariableDeclaration(child) && child.initializer !== undefined && isRequire(child.initializer) && !ts.isIdentifier(child.name)) return true
    node = child
  }
  return false
}

const kindOf = (path: string) =>
  /\.tsx$/.test(path) ? ts.ScriptKind.TSX : /\.jsx$/.test(path) ? ts.ScriptKind.JSX : /\.(m|c)?js$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS
const stem = (path: string) => path.replace(/\.d\.(m|c)?ts$|\.(m|c)?[jt]sx?$/, '')

/** The TypeScript language service's references: one service per nearest config, the last `KEEP` kept. */
export class TsTruth implements Truth {
  parallel = false
  private sha = ''
  private files: readonly string[] = []
  private nearest = new Map<string, string>()
  private settings = new Map<string, { options: object; fileNames: string[] }>()
  private projects = new Map<string, Project & { sha: string; extra: Set<string>; rootSet: Set<string> }>()
  private deadline = Infinity

  constructor(private root: string, private timeoutMs: number) {}

  private inside = (p: string) => p === this.root || p.startsWith(`${this.root}/`) || p.startsWith(LIB)
  private sys = {
    useCaseSensitiveFileNames: true,
    fileExists: (p: string) => this.inside(p) && ts.sys.fileExists(p),
    readFile: (p: string) => (this.inside(p) ? ts.sys.readFile(p) : undefined),
    directoryExists: (p: string) => this.inside(p) && ts.sys.directoryExists(p),
    getDirectories: (p: string) => (this.inside(p) ? ts.sys.getDirectories(p) : []),
    readDirectory: (p: string, ext?: string[], exclude?: string[], include?: string[], depth?: number) =>
      this.inside(p) ? ts.sys.readDirectory(p, ext, exclude, include, depth) : [],
    realpath: (p: string) => ts.sys.realpath(p),
    getCurrentDirectory: () => this.root,
  }

  commit(sha: string, files: readonly string[]) {
    this.sha = sha
    this.files = files
    this.nearest.clear()
    this.settings.clear()
  }

  /** The nearest tsconfig.json or jsconfig.json, the deeper of the two; '' when there is none. */
  private configOf(file: string): string {
    const dir = dirname(resolve(this.root, file))
    let config = this.nearest.get(dir)

    if (config === undefined) {
      const found = ['tsconfig.json', 'jsconfig.json'].map(n => ts.findConfigFile(dir, this.sys.fileExists, n) as string | undefined)

      config = found.filter((c): c is string => c !== undefined).sort((a, b) => b.length - a.length)[0] ?? ''
      this.nearest.set(dir, config)
    }
    return config
  }

  private settingsOf(config: string) {
    let s = this.settings.get(config)

    if (s === undefined) {
      const read = config === '' ? null : ts.readConfigFile(config, this.sys.readFile)
      const parsed = read === null || read.error ? null : ts.parseJsonConfigFileContent(read.config, this.sys, dirname(config), undefined, config)

      s = { options: parsed === null ? { ...FALLBACK } : { ...parsed.options, ...FORCED }, fileNames: parsed?.fileNames ?? [] }
      this.settings.set(config, s)
    }
    return s
  }

  /** The service for `file`'s config, its roots the config's files plus every tracked source whose nearest config it is. */
  private projectOf(file: string) {
    const config = this.configOf(file)
    let p = this.projects.get(config)

    if (p !== undefined) this.projects.delete(config)
    else {
      for (const [key, old] of this.projects) {
        if (this.projects.size < KEEP) break
        old.service.dispose()
        this.projects.delete(key)
      }
      p = this.create(config)
    }
    this.projects.set(config, p)
    if (p.sha !== this.sha) {
      const s = this.settingsOf(config)
      const own = this.files.filter(f => SOURCE.test(f) && this.configOf(f) === config).map(f => resolve(this.root, f))

      p.options = s.options
      p.rootSet = new Set([...s.fileNames, ...own])
      p.extra.clear()
      p.sha = this.sha
      p.version++
    }
    return p
  }

  private create(config: string) {
    const p = { config, options: {}, rootSet: new Set<string>(), extra: new Set<string>(), sha: '', version: 0, service: null as any }
    const host = {
      ...this.sys,
      useCaseSensitiveFileNames: () => true,
      getScriptFileNames: () => [...p.rootSet, ...p.extra],
      getScriptVersion: (f: string) => {
        const s = statSync(f, { throwIfNoEntry: false })

        return s === undefined ? '0' : `${s.mtimeMs}:${s.size}`
      },
      getScriptSnapshot: (f: string) => {
        const text = this.sys.readFile(f)

        return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text)
      },
      getCompilationSettings: () => p.options,
      getDefaultLibFileName: (o: object) => ts.getDefaultLibFilePath(o),
      getProjectVersion: () => `${p.sha}:${p.version}`,
      getCancellationToken: () => ({ isCancellationRequested: () => performance.now() > this.deadline }),
    }

    p.service = ts.createLanguageService(host, ts.createDocumentRegistry())
    return p
  }

  async refs(file: string, specs: readonly Spec[], scope: readonly string[]): Promise<Found[]> {
    const p = this.projectOf(file)
    const abs = resolve(this.root, file)
    const wider = [abs, ...scope.map(s => resolve(this.root, s))].filter(f => SOURCE.test(f) && !p.rootSet.has(f) && !p.extra.has(f) && existsSync(f))

    if (wider.length > 0) {
      for (const f of wider) p.extra.add(f)
      p.version++
    }
    // build the program and its checker before the clock starts: only the search is timed out
    const program = p.service.getProgram()

    program.getTypeChecker()
    const sf = program.getSourceFile(abs)
    const out: Found[] = []

    for (const spec of specs) {
      const at = sf === undefined ? [] : locate(sf, spec)
      const refs: Found['refs'] = []
      let timedOut = false
      let failed = false

      // one spec without an answer leaves the file out: skip the rest
      if (out.some(f => f.timedOut || f.failed)) {
        out.push({ found: at.length, timedOut, failed, refs })
        continue
      }
      this.deadline = performance.now() + this.timeoutMs
      try {
        for (const n of at) {
          const start = n.getStart(sf)
          const symbols = p.service.findReferences(abs, start) ?? []
          // the declaration's own references and each import of it (a group of its own per importing file);
          // the groups of the members it implements or overrides are other symbols'
          const own = symbols.filter((s: any) => s.definition.kind === ts.ScriptElementKind.alias || (s.definition.fileName === abs && s.definition.textSpan.start === start))

          for (const symbol of own.length > 0 ? own : symbols.slice(0, 1)) {
            for (const r of symbol.references) {
              const path = relative(this.root, r.fileName)
              const rsf = program.getSourceFile(r.fileName)

              if (!path.startsWith('..')) refs.push({ path, isImport: rsf !== undefined && isImportAt(rsf, r.textSpan.start) })
            }
          }
        }
      } catch (e) {
        timedOut = (e as Error)?.constructor?.name === 'OperationCanceledException'
        failed = !timedOut
        if (failed) console.error(`refs: ${file} ${spec.owner ?? ''}.${spec.name}: ${(e as Error).message?.split('\n')[0]}`)
      } finally {
        this.deadline = Infinity
      }
      out.push({ found: at.length, timedOut, failed, refs })
    }
    return out
  }

  async names(file: string, other: string, words: readonly string[], toResolve: readonly string[]) {
    const abs = resolve(this.root, other)
    const program = this.projects.get(this.configOf(file))?.service.getProgram()
    const inProgram = program?.getSourceFile(abs)

    if (!SOURCE.test(other) || !existsSync(abs)) return { named: [], unresolved: [] }
    const sf = inProgram ?? ts.createSourceFile(abs, readFileSync(abs, 'utf8'), ts.ScriptTarget.Latest, false, kindOf(abs))
    const checker = inProgram === undefined ? undefined : program.getTypeChecker()
    const want = new Set(words)
    const resolving = new Set(toResolve)
    const named = new Set<string>()
    const unresolved = new Set<string>()
    const visit = (n: any): void => {
      if ((ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) && want.has(n.text)) {
        let symbol = resolving.has(n.text) ? checker?.getSymbolAtLocation(n) : undefined

        // an import the service cannot resolve aliases the unknown symbol, which has no declarations
        if (symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
        named.add(n.text)
        if (resolving.has(n.text) && !((symbol?.declarations?.length ?? 0) > 0)) unresolved.add(n.text)
      }
      ts.forEachChild(n, visit)
    }

    visit(sf)
    return { named: [...named].sort(), unresolved: [...unresolved].sort() }
  }

  async imports(file: string, target: string): Promise<boolean> {
    const abs = resolve(this.root, file)

    if (!SOURCE.test(file) || !existsSync(abs)) return false
    const { options } = this.settingsOf(this.configOf(file))

    return ts.preProcessFile(readFileSync(abs, 'utf8'), true, true).importedFiles.some(({ fileName: spec }: { fileName: string }) => {
      const m = ts.resolveModuleName(spec, abs, options, this.sys).resolvedModule

      return m !== undefined && stem(relative(this.root, m.resolvedFileName)) === stem(target)
    })
  }

  reads(file: string) {
    return SOURCE.test(file)
  }

  close() {
    for (const p of this.projects.values()) p.service.dispose()
    this.projects.clear()
  }
}

/** jedi's references, from a pool of bench/pyrefs.py processes, each request to the least busy. */
export class PyTruth implements Truth {
  parallel = true
  private workers: { child: ReturnType<typeof spawn>; waiting: ((line: string) => void)[] }[]

  constructor(private root: string, private paths: readonly string[], private timeoutS: number, size = WORKERS) {
    const venv = resolve(BENCH, 'venv/bin/python')
    const python = process.env.PYTHON ?? (existsSync(venv) ? venv : 'python3')

    this.workers = Array.from({ length: size }, () => {
      const w = { child: spawn(python, [resolve(here, 'pyrefs.py')], { stdio: ['pipe', 'pipe', 'inherit'] }), waiting: [] as ((line: string) => void)[] }

      createInterface({ input: w.child.stdout! }).on('line', line => w.waiting.shift()?.(line))
      return w
    })
  }

  private ask(req: object): Promise<any> {
    const w = this.workers.reduce((a, b) => (b.waiting.length < a.waiting.length ? b : a))

    return new Promise(done => {
      w.waiting.push(line => done(JSON.parse(line)))
      w.child.stdin!.write(`${JSON.stringify({ root: this.root, paths: this.paths, ...req })}\n`)
    })
  }

  commit() {}

  /** one request per spec, so a file's searches spread over the pool */
  async refs(file: string, specs: readonly Spec[]): Promise<Found[]> {
    const rs = await Promise.all(specs.map(spec => this.ask({ op: 'refs', file, specs: [spec], timeout: this.timeoutS })))

    return rs.map(r => r.specs[0]).map((s: { found: number; timedOut: boolean; failed: boolean; refs: [string, number, boolean][] }) => ({
      found: s.found,
      timedOut: s.timedOut,
      failed: s.failed,
      refs: s.refs.map(([path, , isImport]) => ({ path, isImport })),
    }))
  }

  async names(_file: string, other: string, words: readonly string[], resolve: readonly string[]): Promise<{ named: string[]; unresolved: string[] }> {
    return other.endsWith('.py') ? this.ask({ op: 'names', file: other, words, resolve, timeout: this.timeoutS }) : { named: [], unresolved: [] }
  }

  async imports(file: string, target: string): Promise<boolean> {
    return file.endsWith('.py') && (await this.ask({ op: 'imports', file, target })).imports
  }

  reads(file: string) {
    return file.endsWith('.py')
  }

  close() {
    for (const w of this.workers) w.child.stdin!.end()
  }
}
