/**
 * History accuracy, the EXPECTED badge, backtested. For each of the latest 300 non-merge
 * commits touching 2 to 40 files, half its files (seeded shuffle) are given and half hidden;
 * expectedOf, fed the 400 non-merge commits before it, flags its top 3 as weather.ts does.
 * Asked again with every file given, anything it flags is a false alarm.
 *
 *   tsx bench/history.mts [--only vite] [--seeds 1,2,3] [--lift 4] [--share 0.6] [--save history]
 */
import { git, graph, picked, rootOf, round, run, save } from './isobar.mts'

const COMMITS = 300
const HISTORY = 400
const MIN_FILES = 2
const TOP = 3
const flag = (name: string, fallback: string) => {
  const at = process.argv.indexOf(`--${name}`)

  return at < 0 ? fallback : process.argv[at + 1] ?? fallback
}
const SEEDS = flag('seeds', '1,2,3').split(',').map(Number)
/** The share and lift weather.ts asks of an expected file. */
const MIN_SHARE = Number(flag('share', '0.6'))
const MIN_LIFT = Number(flag('lift', '4'))

/** Non-merge commits, newest first, each its sha and the files it touched (empty and bulk ones kept). */
async function logOf(root: string, n: number) {
  const r = await run(['git', '-C', root, 'log', '-n', String(n), '--no-merges', '--name-only', '--format=%x1e%H'])

  return r.stdout.split('\x1e').slice(1).map(block => {
    const [sha = '', ...files] = block.split('\n').map(s => s.trim()).filter(Boolean)

    return { sha, files }
  })
}

/** A seeded shuffle: FNV-1a of the key seeds mulberry32. */
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

const flagsOf = (history: string[][], given: string[]): string[] =>
  graph.expectedOf(history, given, () => true, MIN_SHARE, 3, MIN_LIFT).slice(0, TOP).map((e: { path: string }) => e.path)
const mean = (xs: number[]) => round(xs.reduce((s, x) => s + x, 0) / xs.length, 3)
const rows = []

for (const repo of picked()) {
  const root = rootOf(repo)
  const log = await logOf(root, 4000)
  const picks = log.map((c, i) => ({ ...c, i })).filter(c => c.files.length >= MIN_FILES && c.files.length <= git.BULK_COMMIT).slice(0, COMMITS)
  const cases = picks
    .filter(c => c.i + HISTORY < log.length)
    .map(c => ({ ...c, history: log.slice(c.i + 1, c.i + 1 + HISTORY).map(h => h.files).filter(f => f.length > 0 && f.length <= git.BULK_COMMIT) }))
  const alarms = cases.map(c => flagsOf(c.history, c.files))
  const complete = alarms.filter(a => a.length > 0).length
  const alarmFiles = Object.entries(alarms.flat().reduce<Record<string, number>>((m, f) => ({ ...m, [f]: (m[f] ?? 0) + 1 }), {}))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([path, times]) => ({ path, times }))
  const seeds = SEEDS.map(seed => {
    let flagged = 0
    let flags = 0
    let hits = 0
    let hidden = 0

    for (const c of cases) {
      const order = shuffled(c.files, `${seed}:${c.sha}`)
      const cut = Math.max(1, Math.floor(order.length / 2))
      const left = new Set(order.slice(cut))
      const got = flagsOf(c.history, order.slice(0, cut))

      if (got.length > 0) flagged++
      flags += got.length
      hits += got.filter(f => left.has(f)).length
      hidden += left.size
    }
    return { seed, coverage: round(flagged / cases.length, 3), precision: round(hits / Math.max(1, flags), 3), recall: round(hits / hidden, 3), flags, hits, hidden }
  })
  const row = {
    repo: repo.name,
    commits: cases.length,
    span: { newest: cases[0]?.sha, oldest: cases[cases.length - 1]?.sha },
    filesPerCommit: round(cases.reduce((s, c) => s + c.files.length, 0) / cases.length),
    coverage: mean(seeds.map(s => s.coverage)),
    precision: mean(seeds.map(s => s.precision)),
    recall: mean(seeds.map(s => s.recall)),
    falseAlarms: round(complete / cases.length, 3),
    alarmFiles,
    seeds,
  }

  console.log(JSON.stringify({ ...row, seeds: undefined }))
  rows.push(row)
}

save(flag('save', 'history'), { commits: COMMITS, history: HISTORY, top: TOP, minShare: MIN_SHARE, minTogether: 3, minLift: MIN_LIFT, seeds: SEEDS, rows })
