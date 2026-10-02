import { graphOf, type Graph } from './graph'
import type { Basemap, Facts, Layer, Region } from './types'

export const MAX_REGIONS = 20
export const MAX_LAYERS = 6

/** The region a path falls in: the longest matching prefix or exact file. */
export function regionFinder(regions: readonly Region[]): (path: string) => Region | undefined {
  const rules = regions
    .flatMap(r => r.paths.map(p => ({ p: p.replace(/^\.\//, ''), r })))
    .sort((a, b) => b.p.length - a.p.length)

  return path => rules.find(({ p }) => p === '' || path === p || (p.endsWith('/') ? path.startsWith(p) : path.startsWith(`${p}/`)))?.r
}

/** A unit the model groups into regions: one file, or a folder taken whole. */
export type Unit = { path: string; files: number; lines: number; imports: string[] }

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '')
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|py|vue|svelte|go|rs|java|kt|rb|swift|c|cc|cpp|h)$/

/**
 * The repo cut into at most ~`budget` units for the model to read: big code folders are
 * opened to their files, everything else is taken a folder at a time.
 */
export function unitsOf(facts: Facts, budget = 160): Unit[] {
  const files = [...facts.lines.keys()].sort()
  const total = files.reduce((s, f) => s + (facts.lines.get(f) ?? 0), 0) || 1
  const graph = graphOf(facts.edges)
  const units: Unit[] = []

  const visit = (dir: string, members: string[], depth: number) => {
    const lines = members.reduce((s, f) => s + (facts.lines.get(f) ?? 0), 0)
    const code = members.filter(f => CODE.test(f)).length
    const isLeaf = members.length <= 12 || depth >= 3 || lines / total < 0.03 || code / members.length < 0.4

    if (isLeaf && dir !== '') {
      units.push({ path: dir, files: members.length, lines, imports: [] })
      return
    }

    const direct = members.filter(f => dirOf(f) === dir)
    const sub = new Map<string, string[]>()

    for (const f of members) {
      if (dirOf(f) === dir) continue
      const child = dir + f.slice(dir.length).split('/')[0] + '/'

      sub.set(child, [...(sub.get(child) ?? []), f])
    }
    for (const f of direct) {
      const imports = (graph.out.get(f) ?? []).map(t => t.split('/').pop() ?? t).slice(0, 4)

      units.push({ path: f, files: 1, lines: facts.lines.get(f) ?? 0, imports })
    }
    for (const [child, list] of [...sub].sort()) visit(child, list, depth + 1)
  }

  visit('', files, 0)

  // Over budget: merge sibling units into their parent folder, smallest and least code-like first,
  // so the main source folder keeps its files listed one by one the longest.
  const parentOf = (u: Unit) => dirOf(u.path.endsWith('/') ? u.path.slice(0, -1) : u.path)

  while (units.length > budget) {
    const groups = new Map<string, Unit[]>()

    for (const u of units) if (parentOf(u) !== '') groups.set(parentOf(u), [...(groups.get(parentOf(u)) ?? []), u])
    const score = (list: Unit[]) => list.reduce((s, u) => s + u.lines * (u.files === 1 && CODE.test(u.path) ? 4 : 1), 0)
    const pick = [...groups].filter(([, l]) => l.length >= 2).sort((a, b) => score(a[1]) - score(b[1]) || a[0].localeCompare(b[0]))[0]

    if (pick === undefined) break
    const [dir, list] = pick

    for (const u of list) units.splice(units.indexOf(u), 1)
    units.push({ path: dir, files: list.reduce((s, u) => s + u.files, 0), lines: list.reduce((s, u) => s + u.lines, 0), imports: [] })
  }

  return units.sort((a, b) => a.path.localeCompare(b.path))
}

/** The question the model answers to name the basemap. */
export function basemapPrompt(repo: string, units: readonly Unit[]): string {
  const rows = units.map(u => `${u.path}  (${u.files} file${u.files === 1 ? '' : 's'}, ${u.lines} lines)${u.imports.length ? `  imports: ${u.imports.join(', ')}` : ''}`)

  return [
    `You are drawing the fixed basemap of the codebase "${repo}": a treemap of its high-level capabilities that an engineer will learn by shape and see on every change.`,
    '',
    'Group the units below into at most 20 capability regions, arranged in 3 to 6 layer bands ordered top to bottom from where work enters the system to its foundations, with tests, tooling and docs in the last band.',
    'Rules:',
    '- Name each region by what it does for the product (2-3 words, e.g. "Request routing", "Billing", "Search index"), never by a folder name alone. Blurb: 3-6 plain words.',
    '- Every unit belongs to exactly one region. Copy unit paths into "paths" exactly as listed. Never write a folder that is not itself a listed unit: where a folder\'s files are listed one by one, assign each file by its role, so the main source folder is split across several regions.',
    `- Balance: no region holds more than a quarter of the ${units.reduce((s, u) => s + u.lines, 0)} lines.`,
    '- Put units that import each other in the same region or the same band.',
    '- Each band holds 2 to 5 regions. Layer names are 1-2 words; layer blurbs 3-5 words.',
    'Answer with JSON only, no prose:',
    '{"layers":[{"id":"intake","name":"Intake","blurb":"how work enters"}],"regions":[{"id":"request-routing","name":"Request routing","blurb":"matches each request to a handler","layer":"intake","paths":["src/router.ts"]}]}',
    '',
    'Units:',
    ...rows,
  ].join('\n')
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'region'
const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.trim().replace(/\s+/g, ' ').slice(0, n) : '')

/** The model's answer as layers and regions, or null when it is not usable. */
export function parseBasemapReply(text: string, units?: readonly Unit[]): { layers: Layer[]; regions: Region[] } | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')

  if (start < 0 || end <= start) return null
  let raw: unknown

  try {
    raw = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  const obj = raw as { layers?: unknown[]; regions?: unknown[] }

  if (!Array.isArray(obj.layers) || !Array.isArray(obj.regions)) return null
  const layers: Layer[] = obj.layers.slice(0, MAX_LAYERS).map(l => {
    const o = l as Record<string, unknown>

    return { id: slug(clip(o.id, 40) || clip(o.name, 40)), name: clip(o.name, 22), blurb: clip(o.blurb, 40) }
  })
  const ids = new Set(layers.map(l => l.id))
  // a unit, or a file inside a folder unit: both name real code outright
  const isUnit = (p: string) => units === undefined || units.some(u => u.path === p || (u.path.endsWith('/') && p.startsWith(u.path) && !p.endsWith('/')))
  const asked = obj.regions.slice(0, MAX_REGIONS).map(r => {
    const o = r as Record<string, unknown>

    return { o, named: Array.isArray(o.paths) ? o.paths.filter((p): p is string => typeof p === 'string') : [] }
  })
  // A unit named outright belongs to that region; a folder that is not a unit only takes the units nobody named.
  const claimed = new Set(asked.flatMap(a => a.named.filter(isUnit)))
  const regions: Region[] = asked.flatMap(({ o, named }) => {
    const paths = named.flatMap(p => {
      if (isUnit(p)) return [p]
      const prefix = p.endsWith('/') ? p : `${p}/`

      return (units ?? []).filter(u => u.path.startsWith(prefix) && !claimed.has(u.path)).map(u => u.path)
    })
    const layer = slug(clip(o.layer, 40))

    if (paths.length === 0 || !ids.has(layer)) return []
    return [{ id: slug(clip(o.id, 40) || clip(o.name, 40)), name: clip(o.name, 24), blurb: clip(o.blurb, 48), layer, paths, weight: 1 }]
  })

  return regions.length >= 2 ? { layers: layers.filter(l => regions.some(r => r.layer === l.id)), regions } : null
}

const title = (s: string) => s.replace(/^\./, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'Root'
const isDoc = (p: string) => /\.(md|mdx|txt|rst|html)$/.test(p) || /(^|\/)docs?\//.test(p)
const isTestPath = (p: string) => /(^|\/)(test|tests|__tests__|spec)\b/.test(p) || /\.(test|spec)\./.test(p)

/** A basemap from folders alone, for when no model is reachable. */
export function heuristicRegions(units: readonly Unit[]): { layers: Layer[]; regions: Region[] } {
  const total = units.reduce((s, u) => s + u.lines, 0) || 1
  const top = (p: string) => (p.includes('/') ? p.split('/')[0] + '/' : '')
  const groups = new Map<string, Unit[]>()

  for (const u of units) groups.set(top(u.path), [...(groups.get(top(u.path)) ?? []), u])
  for (const [key, list] of [...groups]) {
    const lines = list.reduce((s, u) => s + u.lines, 0)

    if (key === '' || lines / total < 0.3 || list.length < 3) continue
    groups.delete(key)
    for (const u of list) {
      const rest = u.path.slice(key.length)
      const sub = rest.includes('/') ? key + rest.split('/')[0] + '/' : key

      groups.set(sub, [...(groups.get(sub) ?? []), u])
    }
  }

  let ranked = [...groups].sort((a, b) => b[1].reduce((s, u) => s + u.lines, 0) - a[1].reduce((s, u) => s + u.lines, 0))

  if (ranked.length > MAX_REGIONS) {
    const rest = ranked.slice(MAX_REGIONS - 1).flatMap(([, l]) => l)

    ranked = [...ranked.slice(0, MAX_REGIONS - 1), ['*', rest]]
  }

  const kindOf = (list: Unit[]) => {
    if (list.every(u => isTestPath(u.path))) return 'checks'
    if (list.filter(u => isDoc(u.path)).length > list.length / 2) return 'docs'
    if (list.some(u => CODE.test(u.path) || u.files > 1)) return 'source'
    return 'tooling'
  }
  const regions: Region[] = ranked.map(([key, list]) => {
    const name = key === '*' ? 'Everything else' : key === '' ? 'Root files' : title(key.split('/').filter(Boolean).pop() ?? key)

    return { id: slug(key === '*' ? 'everything-else' : key || 'root'), name, blurb: `${list.length} parts`, layer: kindOf(list), paths: list.map(u => u.path), weight: 1 }
  })
  const layers: Layer[] = [
    { id: 'source', name: 'Source', blurb: 'the running code' },
    { id: 'tooling', name: 'Tooling', blurb: 'config and scripts' },
    { id: 'checks', name: 'Checks', blurb: 'tests that hold it' },
    { id: 'docs', name: 'Docs', blurb: 'what is written down' },
  ].filter(l => regions.some(r => r.layer === l.id))

  return { layers, regions }
}

/**
 * Gives every tracked file a region: by its imports' regions, else its folder's. A map being drawn
 * gathers what is left in "Everything else"; a kept map never grows a region, so the frame stays
 * as learned, and a new file at the root joins the region holding most of the root's other files.
 */
export function completeRegions(regions: Region[], layers: Layer[], facts: Facts, graph: Graph, isKept = false): Region[] {
  const find = regionFinder(regions)
  const out = regions.map(r => ({ ...r, paths: [...r.paths] }))
  const byId = new Map(out.map(r => [r.id, r]))
  const orphans = [...facts.lines.keys()].filter(f => find(f) === undefined).sort()

  for (const file of orphans) {
    const votes = new Map<string, number>()

    for (const n of [...(graph.out.get(file) ?? []), ...(graph.in.get(file) ?? [])]) {
      const r = find(n)

      if (r !== undefined) votes.set(r.id, (votes.get(r.id) ?? 0) + 1)
    }
    let target: string | undefined = [...votes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0]

    for (let dir = dirOf(file); target === undefined && dir !== ''; dir = dirOf(dir.slice(0, -1))) {
      const probe = [...facts.lines.keys()].find(f => f.startsWith(dir) && find(f) !== undefined)

      if (probe !== undefined) target = find(probe)?.id
    }
    if (target === undefined && isKept) {
      const roots = new Map<string, number>()

      for (const f of facts.lines.keys()) {
        const r = f.includes('/') || f === file ? undefined : find(f)

        if (r !== undefined) roots.set(r.id, (roots.get(r.id) ?? 0) + 1)
      }
      const heaviest = [...out].filter(r => r.layer === layers[layers.length - 1]?.id).sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id))[0]

      target = [...roots].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? heaviest?.id ?? out[0]?.id
    }
    if (target === undefined) {
      if (!byId.has('everything-else')) {
        const last = layers[layers.length - 1]?.id ?? out[0]?.layer ?? 'source'
        const extra: Region = { id: 'everything-else', name: 'Everything else', blurb: 'files outside the map', layer: last, paths: [], weight: 1 }

        out.push(extra)
        byId.set(extra.id, extra)
      }
      target = 'everything-else'
    }
    byId.get(target)?.paths.push(file)
  }

  return out
}

/** Static consequence weight, 1 to 10: lines of code, times how much outside the region depends on it. */
export function weigh(regions: readonly Region[], facts: Facts, graph: Graph): Region[] {
  const find = regionFinder(regions)
  const raw = regions.map(region => {
    const members = [...facts.lines.keys()].filter(f => find(f) === region)
    const lines = members.reduce((s, f) => s + (facts.lines.get(f) ?? 0), 0)
    const outside = new Set<string>()

    for (const m of members) for (const imp of graph.in.get(m) ?? []) if (find(imp) !== region) outside.add(imp)
    return Math.sqrt(lines) * (1 + Math.log(1 + outside.size))
  })
  const max = Math.max(1, ...raw)

  return regions.map((r, i) => ({ ...r, weight: Math.max(1, Math.min(10, Math.round(1 + 9 * Math.pow((raw[i] ?? 0) / max, 0.8)))) }))
}

/** How strongly two regions are tied: imports between them, plus files that change together. */
export function couplingOf(regions: readonly Region[], facts: Facts): (a: string, b: string) => number {
  const find = regionFinder(regions)
  const tie = new Map<string, number>()
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)
  const bump = (a: string | undefined, b: string | undefined, by: number) => {
    if (a === undefined || b === undefined || a === b) return
    tie.set(key(a, b), (tie.get(key(a, b)) ?? 0) + by)
  }

  for (const { from, to } of facts.edges) bump(find(from)?.id, find(to)?.id, 1)
  for (const commit of facts.commits) {
    const ids = [...new Set(commit.map(f => find(f)?.id).filter((x): x is string => x !== undefined))]

    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) bump(ids[i], ids[j], 1 / ids.length)
  }

  return (a, b) => tie.get(key(a, b)) ?? 0
}

/**
 * Orders cells so distance means coupling: the first band is chained greedily by its
 * strongest ties, and each later band sits under the cells it is most tied to.
 */
export function arrange(layers: readonly Layer[], regions: readonly Region[], tie: (a: string, b: string) => number): Region[] {
  const placed: { r: Region; x: number }[] = []
  const out: Region[] = []

  for (const layer of layers) {
    const band = regions.filter(r => r.layer === layer.id).sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id))
    let ordered: Region[]

    if (placed.length === 0) {
      ordered = band.length ? [band[0] as Region] : []
      const left = band.slice(1)

      while (left.length > 0) {
        const ends = [ordered[0] as Region, ordered[ordered.length - 1] as Region]
        let pick = 0
        let side = 1
        let best = -1

        left.forEach((r, i) => ends.forEach((e, s) => {
          const t = tie(r.id, e.id)

          if (t > best) [best, pick, side] = [t, i, s]
        }))
        const [r] = left.splice(pick, 1)

        if (r !== undefined) side === 0 ? ordered.unshift(r) : ordered.push(r)
      }
    } else {
      const center = (r: Region, i: number) => {
        let sum = 0
        let mass = 0

        for (const p of placed) {
          const t = tie(r.id, p.r.id)

          sum += t * p.x
          mass += t
        }
        return mass > 0 ? sum / mass : (i + 0.5) / band.length
      }
      ordered = band.map((r, i) => ({ r, c: center(r, i) })).sort((a, b) => a.c - b.c || a.r.id.localeCompare(b.r.id)).map(o => o.r)
    }

    const total = ordered.reduce((s, r) => s + r.weight, 0) || 1
    let x = 0

    for (const r of ordered) {
      placed.push({ r, x: (x + r.weight / 2) / total })
      x += r.weight
      out.push(r)
    }
  }

  return out
}

/** The finished basemap: every file placed, weighed, and arranged so neighbours are tied. */
export function finishBasemap(
  repo: string,
  facts: Facts,
  named: { layers: Layer[]; regions: Region[] },
  source: Basemap['source'],
  builtAt: string,
): Basemap {
  const graph = graphOf(facts.edges)
  const complete = completeRegions(named.regions, named.layers, facts, graph)
  const layers = named.layers.filter(l => complete.some(r => r.layer === l.id))
  const weighed = weigh(complete, facts, graph)
  const regions = arrange(layers, weighed, couplingOf(weighed, facts))

  return { version: 1, repo, head: facts.head, builtAt, source, layers, regions }
}
