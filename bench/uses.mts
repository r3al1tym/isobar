/**
 * Reach by declaration, measured. For a seeded sample of recent commits per repo: what kind of
 * change each source file is (`shapeOf` through `readChange`), how many files the weather rains
 * on before (every importer up to 3 hops: `weatherOf` with no read) and after (the files that
 * use what changed: `weatherOf` with the read), how close those users are to a language
 * server's references, and what `readChange` costs.
 *
 * Sample: the latest 300 non-merge commits from the pinned sha that touch 1 to 15 files
 * readChange reads (JS/TS other than .d.ts, or Python). A seeded shuffle (FNV-1a of
 * `uses:<repo>` seeds mulberry32, as in history.mts) keeps 60, and 30 for vscode and django,
 * whose truths are the slowest, to keep the run near 20 minutes. They run oldest first in a
 * detached worktree of the clone, removed after; the clone itself is never touched.
 *
 * Pass 1 times `readChange` (a warm-up call fetches the parent's blobs into the blobless
 * clone, then one timed call; the 1-minute load average at its start is kept) and draws both
 * weathers. Pass 2 builds the truth for each changed file read as `body` or `signature`, test
 * files left out (the weather never rains from them): the other files that reference a
 * touched declaration outside their import lines, as isobar counts `uses > 0`. JS/TS: the
 * TypeScript language service's `findReferences`, the declaration's own references and its
 * imports' (not those of the interface member it implements), project = the nearest
 * tsconfig.json or jsconfig.json with allowJs on, its roots widened by every tracked source
 * whose nearest config it is and by every file isobar's graph says depends on the changed
 * file. Python: jedi's `get_references` over the whole repo, its 30-file search limit lifted,
 * in a pool of processes. A second truth adds the references to the declarations in the same
 * file that isobar propagated to (its `words`, two calls deep). A search over 20 s counts as
 * timed out and leaves its file out.
 *
 *   tsx bench/uses.mts [--only vite,django] [--commits 60] [--trace]
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { loadavg, tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { getHeapStatistics } from 'node:v8'
import { basemap, git, graph, ISOBAR, median, picked, rootOf, round, run, save, weather } from './isobar.mts'
import { isClassHook, PyTruth, TsTruth, type Found, type Spec, type Truth } from './refs.mts'

// vscode's src/ program alone holds about 4 GB: run again with room for two of them
if (getHeapStatistics().heap_size_limit < 8 * 2 ** 30 && process.env.ISOBAR_USES_HEAP === undefined) {
  const env = { ...process.env, ISOBAR_USES_HEAP: '1', NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=12288`.trim() }

  process.exit(spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], { stdio: 'inherit', env }).status ?? 1)
}

const here = dirname(fileURLToPath(import.meta.url))
const symbols = await import(pathToFileURL(resolve(here, ISOBAR, 'hooks/engine/symbols.ts')).href)

const flag = (name: string, fallback: string) => {
  const at = process.argv.indexOf(`--${name}`)

  return at < 0 ? fallback : process.argv[at + 1] ?? fallback
}
const WINDOW = 300
const PER_REPO = Number(flag('commits', '60'))
/** the slowest truths keep fewer commits: vscode's language service and jedi over django */
const SAMPLE: Record<string, number> = { vscode: Math.min(PER_REPO, 30), django: Math.min(PER_REPO, 30) }
const MIN_SOURCES = 1
const MAX_SOURCES = 15
const TIMEOUT_S = 20
/** `--trace` prints each compared file's words, isobar's users and the truth to stderr */
const TRACE = process.argv.includes('--trace')
const KINDS = ['comments', 'imports', 'body', 'signature', 'file'] as const

// Copies of symbols.ts's predicates: the files it reads, and a line that only imports or lists a name.
const isSource = (p: string) => p.endsWith('.py') || (/\.(m|c)?[jt]sx?$/.test(p) && !/\.d\.(m|c)?ts$/.test(p))
const JS_IMPORT = /^\s*(import\b(?!\s*\()|export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s*from\b|(?:const|let|var)\s+[\w${},\s:]+=\s*require\()/
const PY_IMPORT = /^\s*(from\s+[.\w]+\s+import\b|import\s+[\w.])/
const isListing = (text: string) => JS_IMPORT.test(text) || PY_IMPORT.test(text) || /^\s*[\w$]+(\s+as\s+[\w$]+)?,?\s*$/.test(text)
/** The word another file names to use a declaration, as `wordsOf` adds it; null when it adds none. */
const wordOf = (d: { name: string; owner?: string }) => {
  const word = d.owner !== undefined && isClassHook(d.name) ? d.owner : d.name

  return word.length >= 2 && word !== 'default' && !word.startsWith('#') ? word : null
}
const keyOf = (d: { name: string; owner?: string }) => (d.owner === undefined ? d.name : `${d.owner}.${d.name}`)

/** Non-merge commits, newest first, each its sha and the files it touched. */
async function logOf(root: string, n: number) {
  const r = await run(['git', '-C', root, 'log', '-n', String(n), '--no-merges', '--name-only', '--format=%x1e%H'])

  return r.stdout.split('\x1e').slice(1).map(block => {
    const [sha = '', ...files] = block.split('\n').map(s => s.trim()).filter(Boolean)

    return { sha, files }
  })
}

/** A seeded shuffle, as in history.mts: FNV-1a of the key seeds mulberry32. */
function shuffled<T>(xs: readonly T[], key: string): T[] {
  let h = 2166136261

  for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  const next = () => {
    h = (h + 0x6d2b79f5) | 0
    let t = Math.imul(h ^ (h >>> 15), 1 | h)

    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32
  }
  const out = [...xs]

  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    const swap = out[i]!

    out[i] = out[j]!
    out[j] = swap
  }
  return out
}

/** The `p` quantile by nearest rank. */
const quantile = (xs: readonly number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b)

  return s.length === 0 ? 0 : s[Math.max(0, Math.ceil(p * s.length) - 1)]!
}
const ratio = (n: number, d: number) => (d === 0 ? null : round(n / d, 3))

type Cause = { cause: string; count: number; example: string }

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

type Change = { path: string; added: number; deleted: number; isNew: boolean; isDeleted: boolean }
type Touch = { name: string; kind: string; owner?: string }
type Shape = { path: string; kind: string; touches: Touch[]; words: string[] }
type Read = { shapes: Map<string, Shape>; users: { path: string; hop: number; via: string; uses: number; of: string }[] }
/** One commit as isobar draws it. */
type Drawn = { sha: string; read: Read; ms: number; mapped: number; before: number; after: number; kinds: string[] }

const checkout = (wt: string, sha: string) => run(['git', '-C', wt, 'checkout', '-q', '-f', '--detach', sha])

/** Pass 1: the commit's change read, timed, and drawn as weather with and without the read. */
async function draw(repo: string, wt: string, sha: string, map: { current: unknown }): Promise<Drawn> {
  await checkout(wt, sha)
  const facts = await git.gatherFacts(run, wt)
  const shown = await run(['git', '-C', wt, 'show', '--numstat', '-z', '--format=%h %s', sha])
  const changes: Change[] = git.parseNumstat(shown.stdout)
  const base = { kind: 'commit', label: (shown.stdout.split(/[\0\n]/)[0] ?? '').trim() }
  const refs = { from: `${sha}~1`, to: sha }

  // the warm-up fetches the parent's blobs into the blobless clone; the second call is timed
  await symbols.readChange(run, wt, facts, changes, refs)
  const t = performance.now()
  const read: Read = await symbols.readChange(run, wt, facts, changes, refs)
  const ms = performance.now() - t

  map.current ??= basemap.finishBasemap(repo, facts, basemap.heuristicRegions(basemap.unitsOf(facts)), 'heuristic', 'bench')
  return {
    sha,
    read,
    ms,
    mapped: facts.lines.size,
    before: weather.weatherOf(map.current, facts, base, changes).reach.length,
    after: weather.weatherOf(map.current, facts, base, changes, read).reach.length,
    kinds: changes.filter(c => isSource(c.path)).map(c => read.shapes.get(c.path)?.kind ?? 'file'),
  }
}

/** What pass 2 adds up over a repo's changed files. */
type Judged = {
  files: number
  timedOut: number
  failed: number
  unlocated: { file: string; spec: string }[]
  removedTouches: number
  unverifiable: { count: number; example: string }
  direct: { tp: number; fp: number; fn: number; exact: number }
  withPropagated: { tp: number; fp: number; fn: number; exact: number }
  bothEmpty: number
  falseRows: { cause: string; example: string }[]
  missRows: { cause: string; example: string }[]
  /** misses only the second truth has: files that use a propagated caller and that isobar left out */
  propagatedMissRows: { cause: string; example: string }[]
  /** each compared file's users, truth and users the direct truth lacks */
  perFile: { file: string; isobar: number; truth: number; falses: number }[]
}

const judged = (): Judged => ({
  files: 0, timedOut: 0, failed: 0, unlocated: [], removedTouches: 0, unverifiable: { count: 0, example: '' },
  direct: { tp: 0, fp: 0, fn: 0, exact: 0 }, withPropagated: { tp: 0, fp: 0, fn: 0, exact: 0 }, bothEmpty: 0, falseRows: [], missRows: [], propagatedMissRows: [], perFile: [],
})

function score(into: Judged['direct'], iso: ReadonlySet<string>, truth: ReadonlySet<string>) {
  const tp = [...iso].filter(p => truth.has(p)).length

  into.tp += tp
  into.fp += iso.size - tp
  into.fn += truth.size - tp
  if (tp === iso.size && tp === truth.size) into.exact++
}

/**
 * Pass 2: for each changed file read as `body` or `signature`, the truth's files against
 * isobar's users, and why each disagreement happens.
 */
async function judge(wt: string, truth: Truth, d: Drawn, out: Judged) {
  await checkout(wt, d.sha)
  const facts = await git.gatherFacts(run, wt)
  const g = graph.graphOf(facts.edges)
  const mapped = new Set<string>(facts.lines.keys())
  const linesOf = (p: string) => readFileSync(resolve(wt, p), 'utf8').split('\n')
  const at = (file: string, other: string, word: string) => `${d.sha.slice(0, 8)} ${file} → ${other} ('${word}')`

  truth.commit(d.sha, [...mapped])
  const plans = [...d.read.shapes.values()].filter(s => (s.kind === 'body' || s.kind === 'signature') && !graph.isTest(s.path)).map(shape => {
    const file = shape.path
    const text = linesOf(file)
    // every declaration of the new version: the file read against itself, every line touched
    const present = new Map<string, Touch>(symbols.shapeOf(file, text, text, [], text.map((_, i) => i + 1)).touches.map((t: Touch) => [keyOf(t), t]))
    const direct = shape.touches.filter(t => t.kind !== 'comments' && wordOf(t) !== null)
    const directWords = new Set(direct.map(wordOf) as string[])
    const spec = (t: Touch): Spec => (t.owner === undefined ? { name: t.name } : { name: t.name, owner: t.owner })
    const specsDirect = [...new Map(direct.filter(t => present.has(keyOf(t))).map(t => [keyOf(t), spec(t)])).values()]
    const specsProp = [...present.values()].filter(t => {
      const w = wordOf(t)

      return w !== null && !directWords.has(w) && shape.words.includes(w)
    }).map(spec)
    const reach = new Map<string, { hop: number }>(graph.reachOf(g, [file], 64).map((r: { path: string; hop: number }) => [r.path, r]))

    return { shape, file, present, direct, directWords, specsDirect, specsProp, reach }
  })
  const search = (p: (typeof plans)[number]) => truth.refs(p.file, [...p.specsDirect, ...p.specsProp], [...p.reach.keys()])
  // jedi's workers search in parallel; the language service runs one search at a time
  const started = truth.parallel ? plans.map(search) : []

  for (const [i, { shape, file, present, direct, directWords, specsDirect, specsProp, reach }] of plans.entries()) {
    const t = performance.now()
    const found = await (started[i] ?? search(plans[i]!))
    const searchMs = Math.round(performance.now() - t)

    out.removedTouches += direct.filter(t => !present.has(keyOf(t))).length
    if (TRACE && found.some(f => f.timedOut || f.failed)) console.error(JSON.stringify({ sha: d.sha.slice(0, 8), file, timedOut: [...specsDirect, ...specsProp].filter((_, i) => found[i]!.timedOut).map(keyOf), searchMs }))
    if (found.some(f => f.timedOut || f.failed)) {
      if (found.some(f => f.timedOut)) out.timedOut++
      else out.failed++
      continue
    }
    const missing = [...specsDirect, ...specsProp].filter((_, i) => found[i]!.found === 0)

    if (missing.length > 0) {
      out.unlocated.push(...missing.map(s => ({ file: `${d.sha.slice(0, 8)} ${file}`, spec: keyOf(s) })))
      continue
    }
    const filesOf = (fs: Found[]) => new Set(fs.flatMap(f => f.refs.filter(r => !r.isImport && r.path !== file && mapped.has(r.path)).map(r => r.path)))
    const tDirect = filesOf(found.slice(0, specsDirect.length))
    const tBoth = new Set([...tDirect, ...filesOf(found.slice(specsDirect.length))])
    const users = [...new Set(d.read.users.filter(u => u.of === file && u.uses > 0).map(u => u.path))]
    const iso = new Set(users.filter(p => truth.reads(p)))

    if (TRACE) console.error(JSON.stringify({ sha: d.sha.slice(0, 8), file, kind: shape.kind, words: shape.words, direct: specsDirect.map(keyOf), removed: direct.filter(t => !present.has(keyOf(t))).map(keyOf), propagated: specsProp.map(keyOf), isobar: [...iso], truth: [...tDirect], propagatedTruth: [...tBoth].filter(p => !tDirect.has(p)), searchMs }))
    if (users.length > iso.size && out.unverifiable.count === 0) out.unverifiable.example = `${d.sha.slice(0, 8)} ${file} → ${users.find(p => !iso.has(p))}`
    out.unverifiable.count += users.length - iso.size
    out.files++
    score(out.direct, iso, tDirect)
    score(out.withPropagated, iso, tBoth)
    if (iso.size === 0 && tBoth.size === 0) out.bothEmpty++
    out.perFile.push({ file: `${d.sha.slice(0, 8)} ${file}`, isobar: iso.size, truth: tDirect.size, falses: [...iso].filter(p => !tDirect.has(p)).length })

    const named = (p: string) => linesOf(p).filter(l => symbols.names(l, shape.words))
    const firstWord = (lines: string[]) => shape.words.find(w => lines.some(l => symbols.names(l, [w]))) ?? shape.words[0] ?? ''

    const falses = [...iso].filter(p => !tDirect.has(p))
    const inCodes = await Promise.all(falses.map(p => (tBoth.has(p) ? { named: [], unresolved: [] } : truth.names(file, p, shape.words, [...directWords]))))

    for (const [k, p] of falses.entries()) {
      const lines = named(p)
      const { named: inCode, unresolved } = inCodes[k]!
      const cause = tBoth.has(p)
        ? 'a caller in the same file that isobar propagated to (words, two calls deep)'
        : inCode.length === 0 ? 'names a touched word only in a comment or a string'
        : inCode.every(w => !directWords.has(w)) ? "names only a propagated caller's word, which there means another declaration"
        : reach.get(p)?.hop === 1 && lines.some(isListing) ? 'imports the touched name from the changed file, yet the language server links none of its uses to it'
        : unresolved.length > 0 ? 'names the word as a member of a value the language server cannot type: it cannot say whose it is'
        : 'another declaration with the same name: a common word matched as text'

      out.falseRows.push({ cause, example: at(file, p, unresolved[0] ?? inCode[0] ?? firstWord(lines)) })
    }
    const misses = [...tBoth].filter(p => !iso.has(p))
    const imported = await Promise.all(misses.map(p => !reach.has(p) && truth.imports(p, file)))

    for (const [k, p] of misses.entries()) {
      const lines = reach.has(p) ? named(p) : []
      const cause = !reach.has(p)
        ? imported[k] ? "an import isobar's graph misses" : 'used without importing the changed file: through an instance, a type or a global'
        : lines.length === 0 ? 'referenced under another name (an alias or a computed access), never by a touched word'
        : lines.every(isListing) ? 'named only on import lines (re-exported, or imported and used under another name)'
        : 'in reach and named, yet not a user'
      const rows = tDirect.has(p) ? out.missRows : out.propagatedMissRows

      rows.push({ cause, example: at(file, p, firstWord(lines)) })
    }
  }
}

const views = (j: Judged['direct']) => ({ precision: ratio(j.tp, j.tp + j.fp), recall: ratio(j.tp, j.tp + j.fn), ...j })
const spread = (counts: number[], mapped: number[]) => ({
  medianShare: round(median(counts.map((c, i) => c / mapped[i]!)), 4),
  p90Share: round(quantile(counts.map((c, i) => c / mapped[i]!), 0.9), 4),
  medianFiles: median(counts),
  p90Files: quantile(counts, 0.9),
})
const rows = []
let open: { root: string; wt: string } | null = null

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (open !== null) spawnSync('git', ['-C', open.root, 'worktree', 'remove', '--force', open.wt])
    process.exit(130)
  })
}

for (const repo of picked()) {
  const root = rootOf(repo)
  const load = loadavg()[0] ?? 0
  const t0 = performance.now()
  const log = await logOf(root, WINDOW)
  const eligible = log.map((c, i) => ({ ...c, i })).filter(c => {
    const n = c.files.filter(isSource).length

    return n >= MIN_SOURCES && n <= MAX_SOURCES
  })
  const picks = shuffled(eligible, `uses:${repo.name}`).slice(0, SAMPLE[repo.name] ?? PER_REPO).sort((a, b) => b.i - a.i)
  const wt = mkdtempSync(resolve(tmpdir(), `isobar-uses-${repo.name}-`))
  const added = await run(['git', '-C', root, 'worktree', 'add', '-q', '--detach', '-f', wt, picks[0]!.sha])

  if (added.exitCode !== 0) throw new Error(`git worktree add failed for ${repo.name}`)
  open = { root, wt }
  const truth: Truth = repo.lang === 'py' ? new PyTruth(wt, repo.path ? [repo.path] : [], TIMEOUT_S) : new TsTruth(wt, TIMEOUT_S * 1000)
  const drawn: Drawn[] = []
  const out = judged()
  let t1 = t0

  try {
    const map = { current: undefined }

    for (const c of picks) drawn.push(await draw(repo.name, wt, c.sha, map))
    t1 = performance.now()
    for (const d of drawn) await judge(wt, truth, d, out)
  } finally {
    truth.close()
    await run(['git', '-C', root, 'worktree', 'remove', '--force', wt])
    open = null
  }

  const kinds = drawn.flatMap(d => d.kinds)
  const counts = Object.fromEntries(KINDS.map(k => [k, kinds.filter(x => x === k).length]))
  const mapped = drawn.map(d => d.mapped)
  const row = {
    repo: repo.name,
    window: WINDOW,
    eligible: eligible.length,
    commits: drawn.length,
    span: { newest: drawn[drawn.length - 1]?.sha, oldest: drawn[0]?.sha },
    sourceFiles: kinds.length,
    kinds: Object.fromEntries(KINDS.map(k => [k, ratio(counts[k]!, kinds.length)])),
    kindCounts: counts,
    rain: { mappedFiles: median(mapped), v01: spread(drawn.map(d => d.before), mapped), v02: spread(drawn.map(d => d.after), mapped) },
    users: {
      files: out.files,
      timedOut: out.timedOut,
      failed: out.failed,
      unlocated: out.unlocated.length,
      unlocatedExamples: out.unlocated.slice(0, 5),
      removedTouches: out.removedTouches,
      unverifiable: out.unverifiable,
      bothEmpty: out.bothEmpty,
      direct: views(out.direct),
      withPropagated: views(out.withPropagated),
      /** the changed files with the most users the direct truth lacks */
      worst: [...out.perFile].sort((a, b) => b.falses - a.falses).slice(0, 3),
    },
    falseCauses: tally(out.falseRows),
    missCauses: tally(out.missRows),
    propagatedMissCauses: tally(out.propagatedMissRows),
    readChangeMs: { median: round(median(drawn.map(d => d.ms))), p95: round(quantile(drawn.map(d => d.ms), 0.95)), loadAverage: round(load, 2) },
    seconds: { isobar: round((t1 - t0) / 1000), truth: round((performance.now() - t1) / 1000) },
    perCommit: drawn.map(d => ({ sha: d.sha, sources: d.kinds.length, mapped: d.mapped, v01: d.before, v02: d.after, ms: round(d.ms) })),
  }

  console.log(JSON.stringify({ ...row, perCommit: undefined, falseCauses: row.falseCauses.map(c => `${c.count} ${c.cause}`), missCauses: row.missCauses.map(c => `${c.count} ${c.cause}`), propagatedMissCauses: undefined }))
  rows.push(row)
}

const only = process.argv.includes('--only') ? `-${flag('only', '')}` : ''

save(`uses${only}`, { window: WINDOW, perRepo: PER_REPO, sample: SAMPLE, seedKey: 'uses:<repo>', timeoutSeconds: TIMEOUT_S, rows })
