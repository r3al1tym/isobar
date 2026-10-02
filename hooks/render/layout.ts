import { regionFinder } from '../engine/basemap'
import type { Basemap, Region } from '../engine/types'

/** A rectangle in terminal cells. */
export type Rect = { x: number; y: number; w: number; h: number }

export type CellBox = { region: Region; rect: Rect }
export type BandBox = { layer: string; name: string; blurb: string; y: number; h: number }

/** The treemap at one size: bands top to bottom, cells inside them, and each file's point. */
export type Layout = {
  cols: number
  rows: number
  bands: BandBox[]
  cells: CellBox[]
  /** file → its point in half-block pixels (x in columns, y in half rows) */
  points: Map<string, { x: number; y: number }>
}

const MIN_BAND_ROWS = 4
const MIN_CELL_COLS = 11

/** Whole numbers proportional to `weights`, summing to `total`, each at least `min`. */
export function apportion(weights: readonly number[], total: number, min: number): number[] {
  const n = weights.length

  if (n === 0) return []
  const free = Math.max(0, total - min * n)
  const sum = weights.reduce((s, w) => s + w, 0) || 1
  const exact = weights.map(w => (w / sum) * free)
  const out = exact.map(e => min + Math.floor(e))
  let left = total - out.reduce((s, x) => s + x, 0)
  const order = exact.map((e, i) => ({ i, r: e - Math.floor(e) })).sort((a, b) => b.r - a.r || a.i - b.i)

  for (let k = 0; left > 0 && n > 0; k++, left--) out[order[k % n]!.i]!++
  return out
}

/** Splits `list` into two runs of near-equal weight, keeping order. */
function halves(list: readonly Region[]): [Region[], Region[]] {
  const total = list.reduce((s, r) => s + r.weight, 0)
  let acc = 0
  let cut = 1

  for (let i = 0; i < list.length - 1; i++) {
    acc += list[i]!.weight
    cut = i + 1
    if (acc >= total / 2) break
  }
  return [list.slice(0, cut), list.slice(cut)]
}

/** Lays one strip of cells across `w` columns at row `y`, one hairline column between neighbours. */
function strip(list: readonly Region[], x: number, y: number, w: number, h: number, out: CellBox[]) {
  const widths = apportion(list.map(r => r.weight), w - (list.length - 1), 1)
  let at = x

  list.forEach((region, i) => {
    out.push({ region, rect: { x: at, y, w: widths[i]!, h } })
    at += widths[i]! + 1
  })
}

/** The basemap laid into `cols` × `rows` cells (hairlines included). Same input, same picture. */
export function layoutOf(map: Basemap, files: readonly string[], lines: ReadonlyMap<string, number>, cols: number, rows: number): Layout {
  const bandsOf = map.layers.map(l => ({ layer: l, regions: map.regions.filter(r => r.layer === l.id) })).filter(b => b.regions.length > 0)
  const heights = apportion(
    bandsOf.map(b => b.regions.reduce((s, r) => s + r.weight, 0)),
    rows - (bandsOf.length - 1),
    MIN_BAND_ROWS,
  )
  const bands: BandBox[] = []
  const cells: CellBox[] = []
  let y = 0

  bandsOf.forEach((b, i) => {
    const h = heights[i]!
    const fits = b.regions.length * MIN_CELL_COLS + (b.regions.length - 1) <= cols

    bands.push({ layer: b.layer.id, name: b.layer.name, blurb: b.layer.blurb, y, h })
    if (fits || b.regions.length < 2 || h < 2 * MIN_BAND_ROWS + 1) strip(b.regions, 0, y, cols, h, cells)
    else {
      const [top, bottom] = halves(b.regions)
      const [h1, h2] = apportion([top.reduce((s, r) => s + r.weight, 0), bottom.reduce((s, r) => s + r.weight, 0)], h - 1, MIN_BAND_ROWS)

      strip(top, 0, y, cols, h1!, cells)
      strip(bottom, 0, y + h1! + 1, cols, h2!, cells)
    }
    y += h + 1
  })

  return { cols, rows, bands, cells, points: pointsOf(map, cells, files, lines) }
}

/**
 * Each file's point inside its cell: the cell split recursively by sorted path and line
 * weight, so a folder's files sit together and a file keeps its spot from change to change.
 */
function pointsOf(map: Basemap, cells: readonly CellBox[], files: readonly string[], lines: ReadonlyMap<string, number>) {
  const find = regionFinder(map.regions)
  const members = new Map<string, string[]>()
  const points = new Map<string, { x: number; y: number }>()

  for (const f of [...files].sort()) {
    const r = find(f)

    if (r !== undefined) members.set(r.id, [...(members.get(r.id) ?? []), f])
  }
  for (const { region, rect } of cells) {
    // the label sits in the top rows; files settle below it
    const top = Math.min(rect.h - 1, 2)
    const box = { x: rect.x + 0.5, y: (rect.y + top) * 2 + 0.5, w: Math.max(1, rect.w - 1), h: Math.max(1, (rect.h - top) * 2 - 1) }

    split(members.get(region.id) ?? [], box, lines, points)
  }
  return points
}

function split(list: readonly string[], box: Rect, lines: ReadonlyMap<string, number>, out: Map<string, { x: number; y: number }>) {
  if (list.length === 0) return
  if (list.length === 1) {
    out.set(list[0]!, { x: box.x + box.w / 2, y: box.y + box.h / 2 })
    return
  }
  const weight = (f: string) => Math.sqrt(1 + (lines.get(f) ?? 0))
  const total = list.reduce((s, f) => s + weight(f), 0)
  let acc = 0
  let cut = 1

  for (let i = 0; i < list.length - 1; i++) {
    acc += weight(list[i]!)
    cut = i + 1
    if (acc >= total / 2) break
  }
  const share = list.slice(0, cut).reduce((s, f) => s + weight(f), 0) / total

  if (box.w >= box.h) {
    split(list.slice(0, cut), { ...box, w: box.w * share }, lines, out)
    split(list.slice(cut), { ...box, x: box.x + box.w * share, w: box.w * (1 - share) }, lines, out)
  } else {
    split(list.slice(0, cut), { ...box, h: box.h * share }, lines, out)
    split(list.slice(cut), { ...box, y: box.y + box.h * share, h: box.h * (1 - share) }, lines, out)
  }
}
