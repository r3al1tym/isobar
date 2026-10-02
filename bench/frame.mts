/**
 * Is the frame consistent? Basemaps drawn by the model for flask, vite and excalidraw: three
 * at the pinned commit and one a year earlier. Measures how much redraws agree (adjusted Rand
 * index over every file's region), how a year-old map kept and completed at the pinned commit
 * agrees with fresh ones, whether a kept map's layout moves, and whether regions keep their
 * places when the pane is resized.
 *
 *   tsx bench/frame.mts [--only flask] [--model opus] [--draws 3] [--reuse]
 *
 * Draws go through `claude -p --model <model>` (default opus) and are kept in
 * `$BENCH_DIR/results/maps/`; `--reuse` reads them back instead of drawing again. The year-old
 * checkout is a detached worktree under `$BENCH_DIR/old/`.
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { basemap, BENCH, git, graph, layout, picked, RESULTS, rootOf, round, run, save } from './isobar.mts'

type Rect = { x: number; y: number; w: number; h: number }
type Map_ = { regions: { id: string }[]; layers: unknown[] } & Record<string, unknown>

const flag = (name: string, fallback: string) => {
  const at = process.argv.indexOf(`--${name}`)

  return at < 0 ? fallback : process.argv[at + 1] ?? fallback
}
const MODEL = flag('model', 'opus')
const DRAWS = Number(flag('draws', '3'))
const REUSE = process.argv.includes('--reuse')
const MAPS = resolve(RESULTS, 'maps')
const choose2 = (n: number) => (n * (n - 1)) / 2

/** The adjusted Rand index of two labelings of the same items: 1 is the same partition, 0 is chance. */
function ari(a: readonly string[], b: readonly string[]): number {
  const both = new Map<string, number>()
  const ra = new Map<string, number>()
  const rb = new Map<string, number>()

  a.forEach((x, i) => {
    both.set(`${x}\n${b[i]}`, (both.get(`${x}\n${b[i]}`) ?? 0) + 1)
    ra.set(x, (ra.get(x) ?? 0) + 1)
    rb.set(b[i]!, (rb.get(b[i]!) ?? 0) + 1)
  })
  const index = [...both.values()].reduce((s, n) => s + choose2(n), 0)
  const sa = [...ra.values()].reduce((s, n) => s + choose2(n), 0)
  const sb = [...rb.values()].reduce((s, n) => s + choose2(n), 0)
  const expected = (sa * sb) / choose2(a.length)

  return (index - expected) / ((sa + sb) / 2 - expected)
}

const ask = (prompt: string) =>
  new Promise<string>(done => {
    const child = execFile('claude', ['-p', '--model', MODEL], { maxBuffer: 1 << 24, timeout: 300_000 }, (_e, out) => done(String(out)))

    child.stdin?.end(prompt)
  })

/** A model-drawn map of `root`, kept as `name`; read back with --reuse. */
async function drawn(name: string, repo: string, root: string): Promise<Map_ | null> {
  const path = resolve(MAPS, `${name}.json`)

  if (REUSE && existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'))
  const facts = await git.gatherFacts(run, root)
  const units = basemap.unitsOf(facts)
  const named = basemap.parseBasemapReply(await ask(basemap.basemapPrompt(repo, units)), units)

  if (named === null) return null
  const map = basemap.finishBasemap(repo, facts, named, 'model', new Date().toISOString())

  writeFileSync(path, JSON.stringify(map, null, 2))
  return map
}

/** The pinned commit's ancestor a year older, checked out once as a detached worktree. */
async function yearOld(name: string, root: string): Promise<string> {
  const dir = resolve(BENCH, 'old', name)

  if (existsSync(dir)) return dir
  const when = Number((await run(['git', '-C', root, 'log', '-1', '--format=%ct', 'HEAD'])).stdout.trim())
  const sha = (await run(['git', '-C', root, 'rev-list', '-1', '--first-parent', `--before=${when - 365 * 86_400}`, 'HEAD'])).stdout.trim()

  mkdirSync(resolve(BENCH, 'old'), { recursive: true })
  await run(['git', '-C', root, 'worktree', 'add', '--detach', dir, sha])
  return dir
}

/** Each file's region under `map`, completed for `facts` the way a drawn map (or, `isKept`, a kept one) is. */
function labelsOf(map: Map_, facts: Awaited<ReturnType<typeof git.gatherFacts>>, files: readonly string[], isKept = false) {
  const regions = basemap.completeRegions(map.regions, map.layers, facts, graph.graphOf(facts.edges), isKept)
  const find = basemap.regionFinder(regions)

  return { regions, labels: files.map(f => find(f)?.id ?? '?') }
}

const rectsOf = (map: Map_, facts: Awaited<ReturnType<typeof git.gatherFacts>>, cols: number, rows: number) =>
  new Map<string, Rect>(layout.layoutOf(map, [...facts.lines.keys()], facts.lines, cols, rows).cells.map((c: { region: { id: string }; rect: Rect }) => [c.region.id, c.rect]))

const iouOf = (p: Rect, q: Rect | undefined) => {
  if (q === undefined) return 0
  const ix = Math.max(0, Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x))
  const iy = Math.max(0, Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y))

  return (ix * iy) / (p.w * p.h + q.w * q.h - ix * iy)
}

/** The share of region pairs that keep their left-right and above-below order when the pane is resized. */
function orderKept(a: Map<string, Rect>, [ac, ar]: number[], b: Map<string, Rect>, [bc, br]: number[]): number {
  const centre = (m: Map<string, Rect>, id: string, c: number, r: number) => [(m.get(id)!.x + m.get(id)!.w / 2) / c, (m.get(id)!.y + m.get(id)!.h / 2) / r] as const
  const ids = [...a.keys()].filter(id => b.has(id))
  const sign = (x: number) => Math.sign(round(x, 3))
  let same = 0
  let all = 0

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const [p, q, s, t] = [centre(a, ids[i]!, ac!, ar!), centre(a, ids[j]!, ac!, ar!), centre(b, ids[i]!, bc!, br!), centre(b, ids[j]!, bc!, br!)]

      all++
      if (sign(p[0] - q[0]) === sign(s[0] - t[0]) && sign(p[1] - q[1]) === sign(s[1] - t[1])) same++
    }
  }
  return same / Math.max(1, all)
}

mkdirSync(MAPS, { recursive: true })
const rows = []

for (const repo of picked().filter(r => ['flask', 'vite', 'excalidraw'].includes(r.name))) {
  const root = rootOf(repo)
  const old = await yearOld(repo.name, root)
  const [heads, past] = await Promise.all([
    Promise.all(Array.from({ length: DRAWS }, (_, k) => drawn(`${repo.name}-${k + 1}`, repo.name, root))),
    drawn(`${repo.name}-year-old`, repo.name, old),
  ])
  const maps = heads.filter((m): m is Map_ => m !== null)
  const facts = await git.gatherFacts(run, root)
  const files = [...facts.lines.keys()].sort()
  const L = maps.map(m => labelsOf(m, facts, files).labels)
  const redraw = L.flatMap((a, i) => L.slice(i + 1).map(b => round(ari(a, b), 2)))
  const row: Record<string, unknown> = { repo: repo.name, files: files.length, regions: maps.map(m => m.regions.length), unparsed: DRAWS - maps.length, redrawARI: redraw }

  if (past !== null) {
    const oldFacts = await git.gatherFacts(run, old)
    const kept = labelsOf(past, facts, files, true)
    const before = rectsOf(past, oldFacts, 92, 56)
    const after = rectsOf({ ...past, regions: kept.regions }, facts, 92, 56)

    row.yearOld = {
      files: `${oldFacts.lines.size} → ${files.length}`,
      newFiles: files.filter(f => !oldFacts.lines.has(f)).length,
      grewRegions: kept.regions.length - past.regions.length,
      keptVsFreshARI: L.map(l => round(ari(kept.labels, l), 2)),
      layoutIoU: round([...before].reduce((s, [id, p]) => s + iouOf(p, after.get(id)), 0) / Math.max(1, before.size), 2),
    }
  }
  if (maps[0] !== undefined) {
    const base = rectsOf(maps[0], facts, 92, 56)

    row.resize = Object.fromEntries([[92, 40], [120, 56], [70, 56], [140, 70]].map(size => [size.join('x'), round(orderKept(base, [92, 56], rectsOf(maps[0]!, facts, size[0]!, size[1]!), size), 2)]))
  }
  console.log(JSON.stringify(row))
  rows.push(row)
}
save('frame', { model: MODEL, draws: DRAWS, rows })
