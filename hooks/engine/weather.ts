import { folderRegion, regionFinder } from './basemap'
import { chainOf, dependentsOf, expectedOf, graphOf, isTest, reachOf, type Expected, type Reach } from './graph'
import { names, type ChangeRead, type Kind, type Touch } from './symbols'
import type { Base, Basemap, Change, Facts } from './types'

/** A changed file as the storm reads it. */
export type Cell = Change & {
  region: string
  dependents: number
  risk: number
  isTested: boolean
  isTest: boolean
  /** how the edit touches what other files use; `file` when it is read file-wide */
  kind: Kind
  touches: Touch[]
  /** files that name what it touched, and the lines where they do; null when read file-wide */
  users: number | null
  uses: number
  /** the session turn that last changed it, 0 before the session; absent outside a session */
  turn?: number
  /** whether it changed in the session's latest turn that changed anything (always, outside a session) */
  isLatest: boolean
  /** why the scope check says nobody asked for it */
  unasked?: string
}

/** A file the change reaches: `uses` lines name what changed there, null when the edit is read file-wide; `of` is that edit. */
export type ReachRow = Reach & { region: string; uses: number | null; of: string }

/**
 * What a session adds to a change: when each file last changed, what the scope check flagged, and
 * the gist's caption for each region the change sits in.
 */
export type Session = { turns?: ReadonlyMap<string, number>; unasked?: ReadonlyMap<string, string>; gists?: ReadonlyMap<string, string> }

/** Rings need a file to change with these this many times more often than it changes at all (bench/history.mts). */
export const MIN_LIFT = 4

/** A reach that leaves the regions the change sits in: the offshoot. */
export type Offshoot = { path: string; region: string; hop: number; chain: string[] }

/** The reach into one region: how many files, how near, and the import chain to its nearest file. */
export type Arm = { region: string; count: number; hop: number; chain: string[] }

/** One region's share of the weather. */
export type RegionWeather = {
  /** 0 to 1 per layer */
  change: number
  impact: number
  risk: number
  history: number
  added: number
  deleted: number
  files: number
  reached: number
  tags: string[]
  /** what the change does here, in the gist's few words */
  what?: string
}

export type Weather = {
  base: Base
  cells: Cell[]
  reach: ReachRow[]
  offshoots: Offshoot[]
  arms: Arm[]
  expected: (Expected & { region: string })[]
  regions: Record<string, RegionWeather>
  headline: string
  lines: string[]
}

const short = (p: string) => {
  const parts = p.split('/')
  const base = parts.pop() ?? p

  return /^index\.|^__init__\.py$|^mod\.rs$/.test(base) && parts.length > 0 ? `${parts.pop()}/${base}` : base
}
const clamp = (x: number) => Math.max(0, Math.min(1, x))
const SOURCE = /\.(py|[cm]?[jt]sx?|vue|svelte|go|rs|java|kt|kts|swift|rb|php|cs|fs|c|cc|cpp|cxx|h|hh|hpp|m|mm|scala|ex|exs|erl|clj|dart|lua|zig|sh)$/
/** Source code: a file whose edit could owe a test. */
const isSource = (path: string) => SOURCE.test(path)
/** How many files an edit reaches: its users when read by declaration, its dependents when read whole. */
const spreadOf = (c: Cell) => c.users ?? c.dependents

/** An edit's reach in words: "9 uses in 4 files", or "68 files depend on it" for an edit read whole. */
export function reachOfCell(c: Cell): string {
  if (c.users === null) return `${plural(c.dependents, 'file')} ${c.dependents === 1 ? 'depends' : 'depend'} on it`
  return c.users === 0 ? 'no uses elsewhere' : `${plural(c.uses, 'use')} in ${plural(c.users, 'file')}`
}
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * The weather of `change` over `map`: what it touched, how far it reaches, what history expected.
 * With `read`, an edit rains only on the files that use what it touched; without, on every importer.
 */
export function weatherOf(map: Basemap, facts: Facts, base: Base, changes: readonly Change[], read?: ChangeRead, session: Session = {}): Weather {
  const graph = graphOf(facts.edges)
  const find = regionFinder(map.regions)
  // a file no rule maps (one the session just created) joins the region its folder's files are in
  const regionOf = (p: string) => (find(p) ?? folderRegion(find, facts.lines.keys(), p))?.id ?? map.regions[map.regions.length - 1]?.id ?? ''
  const fileCount = Math.max(2, facts.lines.size)
  const changedPaths = changes.map(c => c.path)
  const inChange = new Set(changedPaths)
  const changedTests = changes.filter(c => isTest(c.path)).map(c => c.path)
  const testedBy = new Set(changedTests.flatMap(t => [t, ...chainTargets(graph.out, t, 2)]))
  // a test written against an edit names it: the declarations the edit touched, or a name it brought
  // into its file (a config key, a new helper), on the lines the change added to the test
  const testLines = changedTests.map(t => (read?.added.get(t) ?? []).join('\n')).filter(t => t !== '')
  const isNamedByTest = (path: string) => {
    const touched = (read?.shapes.get(path)?.touches ?? []).map(t => t.name).filter(n => n.length >= 4 && !/^__\w+__$/.test(n))
    const words = [...new Set([...touched, ...(read?.coined.get(path) ?? [])])]

    return words.length > 0 && testLines.some(t => names(t, words))
  }
  const turns = changes.map(c => session.turns?.get(c.path)).filter((t): t is number => t !== undefined)
  const latest = turns.length === 0 ? undefined : Math.max(...turns)

  // each edit's own reach: its users when the edit was read declaration by declaration, else its importers
  const rowsOf = new Map<string, ReachRow[]>()

  for (const c of changes) {
    const kind = read?.shapes.get(c.path)?.kind ?? 'file'
    const rows: ReachRow[] =
      isTest(c.path) || kind === 'comments' || kind === 'imports'
        ? []
        : kind === 'file'
          ? reachOf(graph, [c.path], 3).map(r => ({ ...r, region: regionOf(r.path), uses: null, of: c.path }))
          : (read?.users ?? []).filter(u => u.of === c.path).map(u => ({ path: u.path, hop: u.hop, via: u.via, region: regionOf(u.path), uses: u.uses, of: c.path }))

    rowsOf.set(c.path, rows.filter(r => !inChange.has(r.path)))
  }

  const cells: Cell[] = changes.map(c => {
    const shape = read?.shapes.get(c.path)
    const kind = shape?.kind ?? 'file'
    const rows = rowsOf.get(c.path) ?? []
    const dependents = dependentsOf(graph, c.path)
    const users = kind === 'file' ? null : rows.filter(r => (r.uses ?? 0) > 0).length
    const test = isTest(c.path)
    const stem = short(c.path).replace(/\.[^.]+$/, '')
    const isTested = test || testedBy.has(c.path) || changedTests.some(t => short(t).includes(stem)) || isNamedByTest(c.path)
    const size = clamp(Math.log2(1 + c.added + c.deleted) / Math.log2(1 + 400))
    // how far it spreads: its users when read by declaration, every dependent when read whole
    const spread = kind === 'comments' || kind === 'imports' ? 0 : users ?? dependents
    const reachShare = clamp(Math.log2(1 + spread) / Math.log2(fileCount))
    const quiet = kind === 'comments' || kind === 'imports' ? 0.4 : 1
    const risk = test ? 0.15 + 0.2 * size : clamp((0.2 + 0.35 * size + 0.45 * reachShare) * (isTested ? 0.85 : 1.15) * quiet)
    const turn = session.turns?.get(c.path)
    const unasked = session.unasked?.get(c.path)

    return {
      ...c,
      region: regionOf(c.path),
      dependents,
      risk,
      isTested,
      isTest: test,
      kind,
      touches: shape?.touches ?? [],
      users,
      uses: rows.reduce((n, r) => n + (r.uses ?? 0), 0),
      ...(turn === undefined ? {} : { turn }),
      isLatest: latest === undefined || turn === latest,
      ...(unasked === undefined ? {} : { unasked }),
    }
  })

  // the nearest reach of any edit wins a file, so each file is reached once
  const nearest = new Map<string, ReachRow>()

  for (const rows of rowsOf.values()) for (const r of rows) if ((nearest.get(r.path)?.hop ?? Infinity) > r.hop) nearest.set(r.path, r)
  const reachRows = [...nearest.values()].sort((a, b) => a.hop - b.hop || a.path.localeCompare(b.path))
  const touched = new Set(cells.map(c => c.region))
  const offshoots = farthest(reachRows, touched)
  const arms = armsOf(reachRows)
  const expected = expectedOf(facts.commits, changedPaths, p => facts.lines.has(p), 0.6, 3, MIN_LIFT).slice(0, 3).map(e => ({ ...e, region: regionOf(e.path) }))

  const regions: Record<string, RegionWeather> = {}
  const at = (id: string) => (regions[id] ??= { change: 0, impact: 0, risk: 0, history: 0, added: 0, deleted: 0, files: 0, reached: 0, tags: [] })

  for (const c of cells) {
    const w = at(c.region)

    w.files++
    w.added += c.added
    w.deleted += c.deleted
    w.change = clamp(w.change + 0.35 + 0.65 * clamp(Math.log2(1 + c.added + c.deleted) / Math.log2(1 + 400)))
    w.risk = Math.max(w.risk, c.risk)
  }
  for (const r of reachRows) {
    const w = at(r.region)

    w.reached++
    w.impact = clamp(w.impact + ([0, 0.32, 0.18, 0.1][Math.min(3, r.hop)] ?? 0))
  }
  for (const e of expected) at(e.region).history = Math.max(at(e.region).history, e.together / e.of)
  // a test is owed to source code whose edit changes what it does; docs, config and comments owe none
  const owesTest = (c: Cell) => !c.isTest && !c.isTested && !c.isDeleted && isSource(c.path) && c.kind !== 'comments' && c.kind !== 'imports'

  for (const [id, w] of Object.entries(regions)) {
    const here = cells.filter(c => c.region === id)

    if (w.files > 0) w.tags.push(`CHANGED +${w.added} −${w.deleted}`)
    if (here.some(owesTest)) w.tags.push('NO TESTS')
    if (here.some(c => c.unasked !== undefined)) w.tags.push('UNASKED')
    if (w.files === 0 && w.history > 0) w.tags.push('EXPECTED')
    const what = w.files > 0 ? session.gists?.get(id) : undefined

    if (what !== undefined) w.what = what
  }

  const { headline, lines } = forecast(map, cells, reachRows, offshoots, expected)

  return { base, cells, reach: reachRows, offshoots, arms, expected, regions, headline, lines }
}

function chainTargets(out: Map<string, string[]>, from: string, hops: number): string[] {
  const seen = new Set<string>()
  let frontier = [from]

  for (let h = 0; h < hops; h++) {
    const next: string[] = []

    for (const f of frontier) {
      for (const t of out.get(f) ?? []) {
        if (seen.has(t)) continue
        seen.add(t)
        next.push(t)
      }
    }
    frontier = next
  }
  return [...seen]
}

/** One arm per reached region, along the chain to its nearest reached file. */
function armsOf(reach: readonly ReachRow[]): Arm[] {
  const by = new Map<string, ReachRow[]>()

  for (const r of reach) by.set(r.region, [...(by.get(r.region) ?? []), r])
  return [...by]
    .map(([region, list]) => {
      const near = [...list].sort((a, b) => a.hop - b.hop || a.path.localeCompare(b.path))[0] as Reach

      return { region, count: list.length, hop: near.hop, chain: chainOf(reach, near.path) }
    })
    .sort((a, b) => b.count - a.count || a.region.localeCompare(b.region))
}

/** The farthest reach into each region the change does not sit in, deepest first. */
function farthest(reach: readonly ReachRow[], touched: ReadonlySet<string>): Offshoot[] {
  const best = new Map<string, ReachRow>()

  for (const r of reach) {
    if (touched.has(r.region)) continue
    const prior = best.get(r.region)

    if (prior === undefined || r.hop > prior.hop || (r.hop === prior.hop && r.path < prior.path)) best.set(r.region, r)
  }
  return [...best.values()]
    .sort((a, b) => b.hop - a.hop || a.path.localeCompare(b.path))
    .map(r => ({ path: r.path, region: r.region, hop: r.hop, chain: chainOf(reach, r.path) }))
}

/** The forecast in words: one headline, then at most three plain lines, all from the data. */
function forecast(
  map: Basemap,
  cells: readonly Cell[],
  reach: readonly ReachRow[],
  offshoots: readonly Offshoot[],
  expected: readonly (Expected & { region: string })[],
): { headline: string; lines: string[] } {
  const name = (id: string) => map.regions.find(r => r.id === id)?.name ?? id
  const lines: string[] = []

  if (cells.length === 0) return { headline: 'Clear skies. Nothing has changed yet.', lines }

  const byRisk = [...new Set([...cells].sort((a, b) => b.risk - a.risk).map(c => c.region))]
  const named = byRisk.slice(0, 3).map(name)
  const where = named.length === 1 ? named[0] : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`
  const headline = `${plural(cells.length, 'file')} changed in ${where}${byRisk.length > 3 ? `, plus ${plural(byRisk.length - 3, 'more region')}` : ''}.`
  const reachedRegions = new Set(reach.map(r => r.region))

  if (reach.length === 0) lines.push('Contained: nothing imports the changed files.')
  else if (offshoots.length === 0) lines.push(`Reach stays home: ${plural(reach.length, 'file')} ${reach.length === 1 ? 'imports' : 'import'} it, all in the regions it sits in.`)
  else {
    const far = offshoots[0] as Offshoot
    const via = far.chain.length > 2 ? ` via ${far.chain.slice(1, -1).map(short).join(' → ')}` : ''

    lines.push(`Reaches ${plural(reach.length, 'file')} in ${plural(reachedRegions.size, 'region')}; farthest ${name(far.region)}, ${plural(far.hop, 'hop')}${via}.`)
  }

  const untested = cells.filter(c => !c.isTest && !c.isTested && !c.isDeleted && isSource(c.path) && c.kind !== 'comments' && c.kind !== 'imports').sort((a, b) => spreadOf(b) - spreadOf(a))

  if (untested.length > 0) {
    const top = untested[0] as Cell

    lines.push(`${short(top.path)} changed with no test beside it${spreadOf(top) > 0 ? `; ${reachOfCell(top)}` : ''}.`)
  }
  for (const c of cells.filter(c => c.unasked !== undefined).slice(0, 2)) lines.push(`Unasked: ${short(c.path)}, ${c.unasked}.`)
  if (expected.length > 0) {
    const e = expected[0] as Expected

    lines.push(`History expects ${short(e.path)}: it changed with ${short(e.with)} in ${e.together} of ${e.of} commits, and not this time.`)
  }

  return { headline, lines }
}
