import type { Basemap } from '../engine/types'
import { reachOfCell, type Cell, type Weather } from '../engine/weather'
import { fieldOf, type Field, type Layers } from './field'
import { layoutOf, type Layout, type Rect } from './layout'
import { cellAt, gridOf, luma, put, quantize, write, type Grid } from './raster'

import { BINS, inksOf, STORM, type Colors, type Inks } from './palette'

export type SheetInput = {
  repo: string
  map: Basemap | null
  files: readonly string[]
  lines: ReadonlyMap<string, number>
  weather: Weather | null
  layers: Layers
  /** Shown in place of the forecast while something is being worked out. */
  status?: string
  /** Warm paper (the default), or the terminal's own near-black. */
  ground?: 'paper' | 'night'
  /** how many colours the terminal paints; 256 prints from xterm's own palette */
  colors?: Colors
}

/** The grid being drawn, carrying the inks it is printed in. */
type Sheet = Grid & { inks: Inks }

/** Greedy word wrap to `width`, at most `max` lines, the last cut with an ellipsis. */
export function wrap(text: string, width: number, max = 2): string[] {
  const out: string[] = []
  let line = ''

  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line === '') line = word
    else if (line.length + 1 + word.length <= width) line += ` ${word}`
    else {
      out.push(line)
      line = word
    }
  }
  if (line !== '') out.push(line)
  if (out.length > max) {
    const kept = out.slice(0, max)

    kept[max - 1] = fit(`${kept[max - 1]} ${out[max]}`, width)
    return kept
  }
  return out.map(l => fit(l, width))
}

export const fit = (s: string, width: number): string => (s.length <= width ? s : width <= 1 ? s.slice(0, width) : `${s.slice(0, width - 1)}…`)

const short = (p: string) => p.split('/').pop() ?? p

/** Each path's shortest tail no other path among `paths` shares: `app.py` alone, `sansio/app.py` beside `flask/app.py`. */
export function labelsOf(paths: Iterable<string>): (path: string) => string {
  const all = [...new Set(paths)]
  const tail = (p: string, n: number) => p.split('/').slice(-n).join('/')
  const out = new Map<string, string>()

  for (const p of all) {
    const depth = p.split('/').length
    let n = 1

    while (n < depth && all.some(q => q !== p && tail(q, n) === tail(p, n))) n++
    out.set(p, tail(p, n))
  }
  return p => out.get(p) ?? short(p)
}

/**
 * The pane as a framed chart: a muted title above, the map inside a hairline frame with
 * ample margins, one centred legend line below. On the map, a region the weather reached
 * is named in ink with its badges, and the files worth opening carry their own notes.
 */
export function sheetOf(input: SheetInput, cols: number, rows: number): Grid {
  const inks = inksOf(input.ground ?? 'paper', input.colors ?? 'truecolor')
  const grid: Sheet = { ...gridOf(cols, rows, inks.paper), inks }
  const map = input.map
  const w = input.weather
  // a title row and a legend row, each with air around it when the pane is tall enough
  const roomy = rows >= 24
  const side = Math.max(2, Math.min(7, Math.round(cols * 0.055)))
  const top = roomy ? 3 : 1
  const frame = { x: side, y: top, w: cols - 2 * side, h: (roomy ? rows - 3 : rows - 1) - top }

  title(grid, input.repo, w, frame)
  if (map === null || frame.w < 24 || frame.h < 8) {
    centred(grid, input.status ?? 'Reading the repository…')
    return quantize(grid)
  }
  border(grid, frame)
  const sheet: Sheet = { ...gridOf(frame.w - 2, frame.h - 2, inks.paper), inks }
  const layout = layoutOf(map, input.files, input.lines, sheet.cols, sheet.rows)
  const field = fieldOf(layout, w, input.layers, `${map.head}:${w?.cells.map(c => c.path).join('|') ?? ''}`)

  paint(sheet, field, 0, 0)
  lines(sheet, layout, 0, 0)
  contours(sheet, field, layout, 0, 0)
  names(sheet, layout, w, input.layers, new Set(field.rings.map(r => r.region)))
  track(sheet, field)
  eyes(sheet, field, 0, 0, sheet.cols, sheet.rows)
  if (w !== null) notes(sheet, layout, field, w, input.layers)
  if (input.status !== undefined) centred(sheet, input.status)
  blit(grid, sheet, frame.x + 1, frame.y + 1)
  legend(grid, input.layers, frame.y + frame.h + (roomy ? 1 : 0))
  return quantize(grid)
}

/** Copies `from` into `to` with its top-left at (x, y). */
function blit(to: Sheet, from: Sheet, x: number, y: number) {
  from.cells.forEach((c, i) => put(to, x + (i % from.cols), y + Math.floor(i / from.cols), { ...c }))
}

/** The map's frame: a rounded hairline the map sits inside. */
function border(grid: Sheet, f: Rect) {
  const fg = grid.inks.frame

  put(grid, f.x, f.y, { glyph: '╭', fg })
  put(grid, f.x + f.w - 1, f.y, { glyph: '╮', fg })
  put(grid, f.x, f.y + f.h - 1, { glyph: '╰', fg })
  put(grid, f.x + f.w - 1, f.y + f.h - 1, { glyph: '╯', fg })
  for (let i = 1; i < f.w - 1; i++) {
    put(grid, f.x + i, f.y, { glyph: '─', fg })
    put(grid, f.x + i, f.y + f.h - 1, { glyph: '─', fg })
  }
  for (let j = 1; j < f.h - 1; j++) {
    put(grid, f.x, f.y + j, { glyph: '│', fg })
    put(grid, f.x + f.w - 1, f.y + j, { glyph: '│', fg })
  }
}

/**
 * The title over the frame: ISOBAR in muted tracked capitals and the repo beside it in
 * faint ones, centred; the last commit's hash at the frame's right edge when that is what
 * the weather is of.
 */
function title(grid: Sheet, repo: string, w: Weather | null, f: Rect) {
  const row = Math.max(0, f.y - 2)
  const track = (s: string) => [...s.toUpperCase()].join(' ')
  const name = track('isobar')
  const place = repo === '' ? '' : `   ${track(repo)}`
  const line = fit(`${name}${place}`, f.w)
  const x = Math.floor((grid.cols - line.length) / 2)

  write(grid, x, row, line, grid.inks.faint)
  write(grid, x, row, line.slice(0, name.length), grid.inks.muted)
  const side = w?.base.kind === 'commit' ? `last commit ${w.base.label.split(' ')[0]}` : w === null ? '' : turnsOf(w.cells)

  if (side !== '' && x + line.length + 3 < f.x + f.w - side.length) write(grid, f.x + f.w - side.length, row, side, grid.inks.faint)
}

/** The session's turns in a few words: how many files the latest turn changed, and how many an earlier one did. */
function turnsOf(cells: readonly Cell[]): string {
  if (!cells.some(c => c.turn !== undefined && c.turn > 0)) return ''
  const now = cells.filter(c => c.isLatest).length
  const before = cells.length - now

  return before === 0 ? `${now} this turn` : `${now} this turn · ${before} earlier`
}

/** One centred line under the frame: each layer's key, its mark and its name; a layer switched off fades. */
function legend(grid: Sheet, layers: Layers, row: number) {
  const g = grid.inks
  const items = [
    { key: '1', mark: '●', fg: g.radar[BINS - 2]!, name: 'change', on: layers.code },
    { key: '2', mark: '■', fg: g.radar[6]!, name: 'reach', on: layers.impact },
    { key: '3', mark: '■', fg: g.radar[STORM + 2]!, name: 'risk', on: layers.risk },
    { key: '4', mark: '◌', fg: g.history, name: 'history', on: layers.history },
  ]
  const width = items.reduce((n, it) => n + it.key.length + it.name.length + 4, 0) + 3 * (items.length - 1)

  if (row >= grid.rows || width > grid.cols - 2) return
  let x = Math.floor((grid.cols - width) / 2)

  for (const it of items) {
    write(grid, x, row, it.key, g.faint)
    write(grid, x + 2, row, it.mark, it.on ? it.fg : g.nameDry)
    write(grid, x + 4, row, it.name, it.on ? g.muted : g.nameDry)
    x += it.key.length + it.name.length + 4 + 3
  }
}

/** A status in the middle of the pane. */
function centred(grid: Sheet, status: string) {
  const width = Math.max(10, Math.min(56, grid.cols - 6))
  const block = wrap(status, width, 3)
  const top = Math.floor((grid.rows - block.length) / 2)

  block.forEach((line, i) => text(grid, Math.floor((grid.cols - line.length) / 2), top + i, line, grid.inks.muted))
}

/** Half-block cells: the top pixel is the glyph, the bottom the background; every colour from the palette. */
function paint(grid: Sheet, field: Field, x0: number, y0: number) {
  const px = (x: number, y: number) => {
    const i = y * field.w + x

    return grid.inks.radar[field.level[i] ?? 0] ?? grid.inks.paper
  }

  for (let r = 0; r < field.h / 2; r++) {
    for (let c = 0; c < field.w; c++) {
      const top = px(c, r * 2)
      const bottom = px(c, r * 2 + 1)

      put(grid, x0 + c, y0 + r, top === bottom ? { glyph: ' ', fg: bottom, bg: bottom } : { glyph: '▀', fg: top, bg: bottom })
    }
  }
}

/** What text and lines sit on in a painted cell: the stronger of its two pixels, a palette colour either way. */
function groundOf(grid: Sheet, x: number, y: number): number {
  const at = cellAt(grid, x, y)

  if (at === undefined) return grid.inks.paper
  if (at.glyph !== '▀') return at.bg

  return binOf(grid, at.fg) >= binOf(grid, at.bg) ? at.fg : at.bg
}

const binOf = (grid: Sheet, color: number) => Math.max(0, grid.inks.radar.indexOf(color))

/** Hairlines between cells, multiplied into the weather so they darken it instead of sitting on it. */
function lines(grid: Sheet, layout: Layout, x0: number, y0: number) {
  const covered = new Uint8Array(layout.cols * layout.rows)

  for (const { rect } of layout.cells) for (let r = rect.y; r < rect.y + rect.h; r++) for (let c = rect.x; c < rect.x + rect.w; c++) covered[r * layout.cols + c] = 1
  const isLine = (c: number, r: number) => c >= 0 && r >= 0 && c < layout.cols && r < layout.rows && covered[r * layout.cols + c] === 0

  for (let r = 0; r < layout.rows; r++) {
    for (let c = 0; c < layout.cols; c++) {
      if (!isLine(c, r)) continue
      const up = isLine(c, r - 1)
      const down = isLine(c, r + 1)
      const lf = isLine(c - 1, r) || c === 0
      const rt = isLine(c + 1, r) || c === layout.cols - 1
      const glyph = BOX[(up ? 8 : 0) | (down ? 4 : 0) | (lf ? 2 : 0) | (rt ? 1 : 0)] ?? '·'
      const ground = groundOf(grid, x0 + c, y0 + r)

      put(grid, x0 + c, y0 + r, { glyph, fg: grid.inks.line[binOf(grid, ground)] ?? grid.inks.line[0], bg: ground })
    }
  }
}

const HAIRLINES = new Set('─│┌┐└┘┬┴├┤┼')

/** Ground a note may take: open weather, or a hairline it breaks. */
const isOpen = (grid: Sheet, x: number, y: number) => isWeather(grid, x, y) || HAIRLINES.has(cellAt(grid, x, y)?.glyph ?? '')

// up, down, left, right → the box-drawing glyph
const BOX: Record<number, string> = {
  0: '·', 1: '─', 2: '─', 3: '─', 4: '│', 8: '│', 12: '│',
  5: '┌', 6: '┐', 9: '└', 10: '┘', 7: '┬', 11: '┴', 13: '├', 14: '┤', 15: '┼',
}

/**
 * Each region's name in lowercase at its corner, its badges after it: in ink where the
 * weather landed (on two lines when one is too narrow), and as a faint inscription on dry
 * ground, so the map stays readable without competing with it.
 */
function names(grid: Sheet, layout: Layout, weather: Weather | null, layers: Layers, ringed: ReadonlySet<string>) {
  const g = grid.inks

  for (const { region, rect } of layout.cells) {
    const wx = weather?.regions[region.id]
    const isChanged = (wx?.files ?? 0) > 0
    const isWet = isChanged || (layers.impact && (wx?.reached ?? 0) > 0) || ringed.has(region.id)
    const name = region.name.toLowerCase()
    const room = rect.w - 2

    if (room < 4) continue
    if (!isWet) {
      // a dry name is shown whole or not at all
      // (where rain from a neighbour crosses it, each letter takes that bin's hairline ink, as faint against it)
      if (name.length <= room) {
        for (let i = 0; i < name.length; i++) {
          const ground = groundOf(grid, rect.x + 1 + i, rect.y)
          const bin = binOf(grid, ground)

          put(grid, rect.x + 1 + i, rect.y, { glyph: name[i], fg: bin === 0 ? g.nameDry : g.line[bin] ?? g.nameDry, bg: ground })
        }
      }
      continue
    }
    const lines = wrap(name, room, rect.h >= 6 ? 2 : 1)

    lines.forEach((line, k) => text(grid, rect.x + 1, rect.y + k, line, isChanged ? g.ink : g.muted))
    // EXPECTED names the region a ring is drawn in, so badge and ring always come together
    const badges = (wx?.tags ?? [])
      .filter(t => t !== 'EXPECTED' || ringed.has(region.id))
      .map(t => ({ text: ` ${t} `, chip: t.startsWith('CHANGED') ? g.changed : t === 'EXPECTED' ? g.expected : t === 'UNASKED' ? g.unasked : g.untested }))
    const last = lines[lines.length - 1] ?? ''
    // after the name on its last line when they fit, else on the line below, wrapping as room allows;
    // a badge wider than the region is left out, so a narrow region still shows the ones that fit
    let x = rect.x + 1 + last.length + 2
    let y = rect.y + lines.length - 1

    for (const b of badges) {
      if (b.text.length > room) continue
      if (x + b.text.length > rect.x + 1 + room) {
        x = rect.x + 1
        y++
      }
      if (y >= rect.y + rect.h) break
      write(grid, x, y, b.text, b.chip.fg, b.chip.bg)
      x += b.text.length + 1
    }
    // what the change does here, in the gist's words, under the name and its badges: three lines at most,
    // and a row of the region kept clear below it
    const left = rect.y + rect.h - 2 - y
    const what = isChanged && wx?.what !== undefined && left >= 1 ? wrap(wx.what, room, Math.min(3, left)) : []

    block(grid, rect.x + 1, y + 1, what, g.muted)
  }
}

/**
 * Text over the weather: one ink for the whole run, chosen by the ground under it, never a
 * glow. On light rain the ink steps one shade darker; on the storm it turns to paper.
 */
function text(grid: Sheet, x: number, y: number, s: string, fg: number, under?: number) {
  const chars = [...s]
  const grounds = chars.map((_, i) => groundOf(grid, x + i, y))
  // `under` is the ground of a whole block the run belongs to, so its lines share one ink
  const mean = under ?? grounds.reduce((sum, g) => sum + luma(g), 0) / Math.max(1, grounds.length)
  const g = grid.inks
  // on rain each ink steps one further from the ground, red inks to their rain red, so a note never
  // sinks into its own colour; on the storm every ink turns to the storm's own
  const stepped = fg === g.faint ? g.muted : fg === g.muted ? g.ink : fg === g.red || fg === g.history ? g.redOnRain : fg
  const onStorm = g.isNight ? mean > 150 : mean < 140
  // muted ink holds 3:1 on paper's lighter rain, so it steps only once the rain deepens past it
  const onRain = g.isNight ? mean > 60 : mean < (fg === g.muted ? 195 : 215)
  const ink = onStorm ? g.onStorm : onRain ? stepped : fg

  chars.forEach((ch, i) => put(grid, x + i, y, { glyph: ch, fg: ink, bg: grounds[i] }))
}

/** Lines of text set as one run: one ink for all of them, chosen by the ground under the whole block. */
function block(grid: Sheet, x: number, y: number, lines: readonly string[], fg: number) {
  const cells = lines.flatMap((l, k) => [...l].map((_, i) => groundOf(grid, x + i, y + k)))
  const mean = cells.reduce((sum, g) => sum + luma(g), 0) / Math.max(1, cells.length)

  lines.forEach((l, k) => text(grid, x, y + k, l, fg, mean))
}

// braille dot bits by [column][row] inside a cell (2 × 4 dots)
const BRAILLE = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
]

/**
 * History's forecast: two dashed contours around each file history expected, drawn in
 * braille so they read as fine ink lines over the blocky radar, never as rain.
 */
function contours(grid: Sheet, field: Field, layout: Layout, x0: number, y0: number) {
  const bits = new Map<number, number>()

  for (const ring of field.rings) {
    for (const scale of [1]) {
      const rx = 5.5 * scale
      const ry = 2.6 * scale
      const steps = Math.ceil(2 * Math.PI * rx * 8)

      for (let s = 0; s < steps; s++) {
        const a = (s / steps) * Math.PI * 2

        if (Math.floor((a * rx) / 1.1) % 3 === 2) continue
        const cx = ring.x + Math.cos(a) * rx
        const cy = ring.y / 2 + Math.sin(a) * ry
        const col = Math.floor(cx)
        const row = Math.floor(cy)

        if (col < 0 || row < 0 || col >= layout.cols || row >= layout.rows) continue
        const sub = BRAILLE[Math.min(1, Math.floor((cx - col) * 2))]![Math.min(3, Math.floor((cy - row) * 4))]!
        const k = row * layout.cols + col

        bits.set(k, (bits.get(k) ?? 0) | sub)
      }
    }
  }
  for (const [k, b] of bits) {
    const x = x0 + (k % layout.cols)
    const y = y0 + Math.floor(k / layout.cols)
    const ground = groundOf(grid, x, y)

    put(grid, x, y, { glyph: String.fromCharCode(0x2800 + b), fg: binOf(grid, ground) >= STORM ? grid.inks.onStorm : grid.inks.history, bg: ground })
  }
}

/** The offshoot's track: a dotted line of red ink across the map, one dot a stop, on whatever ground it crosses. */
function track(grid: Sheet, field: Field) {
  for (const d of field.track) {
    const x = Math.round(d.x)
    const y = Math.floor(d.y / 2)

    // a dot may cross a hairline, never a word or a mark
    if (isOpen(grid, x, y)) put(grid, x, y, { glyph: '•', fg: binOf(grid, groundOf(grid, x, y)) >= STORM ? grid.inks.onStorm : grid.inks.red, bg: groundOf(grid, x, y) })
  }
}

/**
 * Each edit's eye: a deep-red dot set on the storm at the file's point, stepped aside onto open
 * weather when a label sits there; an earlier turn's edit gets a small dot.
 */
function eyes(grid: Sheet, field: Field, x0: number, y0: number, w: number, h: number) {
  const isOpen = (x: number, y: number) => x >= x0 && y >= y0 && x < x0 + w && y < y0 + h && isWeather(grid, x, y)

  for (const e of field.eyes) {
    const x = x0 + Math.floor(e.x)
    const y = y0 + Math.floor(e.y / 2)
    const spot = NEAR.map(([dx, dy]) => [x + dx, y + dy] as const).find(([sx, sy]) => isOpen(sx, sy))

    if (spot === undefined) continue
    const ground = groundOf(grid, spot[0], spot[1])
    const fg = e.isLatest || binOf(grid, ground) >= STORM ? grid.inks.eye : grid.inks.ink

    put(grid, spot[0], spot[1], { glyph: e.isLatest ? '●' : '•', fg, bg: ground })
  }
}

/** Open weather: a half block, or a flat cell the paint left (its ink matches its ground, which no letter's or line's does). */
function isWeather(grid: Sheet, x: number, y: number): boolean {
  const at = cellAt(grid, x, y)

  return at !== undefined && (at.glyph === '▀' || (at.glyph === ' ' && at.fg === at.bg))
}

/** Offsets from an eye's own cell, nearest first: a row is about two columns tall. */
const NEAR = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [1, 1], [-1, 1], [1, -1], [-1, -1], [3, 0], [-3, 0], [0, 2], [2, 1], [-2, 1], [0, -2]] as const

/**
 * A note on each file worth opening, in the ink of what marks it: the two riskiest edits
 * with their line counts beside their eyes, the farthest file at the end of the track, and
 * each file history expected beside its ring.
 */
function notes(grid: Sheet, layout: Layout, field: Field, weather: Weather, layers: Layers) {
  const cellOf = (region: string) => layout.cells.find(c => c.region.id === region)?.rect ?? { x: 0, y: 0, w: layout.cols, h: layout.rows }
  const changed = new Map(weather.cells.map(c => [c.path, c]))
  const isUnasked = (path: string) => Number(changed.get(path)?.unasked !== undefined)
  // a file is named by as much of its path as tells it from the others on the pane
  const label = labelsOf([...weather.cells.map(c => c.path), ...weather.offshoots.slice(0, 1).map(o => o.path), ...field.rings.map(r => r.path)])

  // the edits nobody asked for come first, then the riskiest of the latest turn
  for (const e of [...field.eyes].sort((a, b) => isUnasked(b.path) - isUnasked(a.path)).slice(0, 2)) {
    const c = changed.get(e.path)

    if (c !== undefined) noteNear(grid, noteOf(grid, c, label), Math.floor(e.x) + 2, Math.floor(e.y / 2), cellOf(c.region), 12, true)
  }
  if (layers.impact) {
    for (const o of weather.offshoots.slice(0, 1)) {
      const p = layout.points.get(o.path)

      if (p !== undefined) noteNear(grid, [{ text: `${label(o.path)} · ${o.hop} ${o.hop === 1 ? 'hop' : 'hops'}`, fg: grid.inks.red }], Math.round(p.x) + 2, Math.floor(p.y / 2), cellOf(o.region), 4, true)
    }
  }
  for (const r of field.rings) noteNear(grid, [{ text: label(r.path), fg: grid.inks.history }], Math.round(r.x) - 4, Math.floor(r.y / 2) + 3, cellOf(r.region), 10, false)
}

/**
 * An edit's note: the file and what it touched; how it reaches the files that use it, in red
 * when it reaches some and no test moved with it; and why nobody asked for it, when the scope
 * check says so. The region's badges carry the line counts.
 */
function noteOf(grid: Sheet, c: Cell, label: (path: string) => string = short): { text: string; fg: number }[] {
  const g = grid.inks
  const named = [...new Set(c.touches.filter(t => t.kind !== 'comments').map(t => t.name))]
  const what = named.length === 0 ? '' : named.length === 1 ? ` · ${named[0]}` : ` · ${named[0]} +${named.length - 1}`
  const lines = [{ text: c.isDeleted ? `${label(c.path)} deleted` : `${label(c.path)}${what}`, fg: g.ink }]
  const reach = reachOfCell(c)
  const how = c.isTest
    ? ''
    : c.isNew
      ? 'new file'
      : c.kind === 'comments'
        ? 'comments only'
        : c.kind === 'imports'
          ? 'imports only'
          : c.kind === 'signature'
            ? `new signature · ${reach}`
            : c.kind === 'body'
              ? `new behaviour · ${reach}`
              : c.dependents > 0
                ? reach
                : ''
  const isReaching = (c.users ?? c.dependents) > 0 && c.kind !== 'comments' && c.kind !== 'imports'

  if (how !== '') lines.push({ text: how, fg: isReaching && !c.isTested ? g.red : g.muted })
  if (c.unasked !== undefined) lines.push({ text: `unasked: ${c.unasked}`, fg: g.ink })
  return lines
}

/**
 * Sets a note's lines, left-aligned, on the best open ground starting near (`from`, `at`):
 * clear of every word and mark (a hairline gives way), then dry (`wet` weighs a bin of rain), then near, and
 * inside its own region's `cell`, with no word on the rows above and below. A note that is not
 * `must` is left out rather than crowd another or sit on the storm.
 */
function noteNear(grid: Sheet, raw: { text: string; fg: number }[], from: number, at: number, cell: Rect, wet: number, must: boolean) {
  const block = raw.map(l => ({ ...l, text: fit(l.text, Math.min(38, grid.cols - 2)) }))
  const width = Math.max(...block.map(l => l.text.length))
  const hi = grid.cols - 1 - width
  // leaving its own region costs a little, so a note stays home unless home is crowded
  const outside = (col: number, row: number) => (col > cell.x && col + width < cell.x + cell.w && row >= cell.y && row + block.length <= cell.y + cell.h ? 0 : 6)
  let best: { row: number; col: number; cost: number } | null = null

  // its own region first, and a few rows either side when the region is all storm
  for (let row = Math.max(0, cell.y - 4); row + block.length <= Math.min(grid.rows, cell.y + cell.h + 4); row++) {
    for (const dx of [0, -3, 3, -6, 6, -9, 9, -12, 12]) {
      const col = Math.max(1, Math.min(hi, from + dx))
      let damp = 0
      let taken = 0
      let crowd = 0

      // two open cells keep a note off any word on its row, so the two never read as one phrase
      block.forEach((l, k) => {
        for (let i = -2; i <= l.text.length + 1; i++) {
          if (!isOpen(grid, col + i, row + k)) taken++
          else if (i >= 0 && i < l.text.length) damp = Math.max(damp, binOf(grid, groundOf(grid, col + i, row + k)))
        }
        for (const i of [-5, -4, -3, l.text.length + 2, l.text.length + 3, l.text.length + 4]) if (!isOpen(grid, col + i, row + k) && cellAt(grid, col + i, row + k) !== undefined) crowd++
      })
      // a word on the row above or below crowds the note: it reads as one block of text
      for (const k of [-1, block.length]) for (let i = 0; i < width; i++) if (!isOpen(grid, col + i, row + k) && cellAt(grid, col + i, row + k) !== undefined) crowd++
      const cost = taken * 100 + damp * wet + crowd * 4 + outside(col, row) + Math.abs(row - at) * 3 + Math.abs(col - from) / 3

      if (!must && damp >= STORM) continue

      if (best === null || cost < best.cost) best = { row, col, cost }
    }
  }
  if (best !== null && (must || best.cost < 100)) block.forEach((l, k) => text(grid, best.col, best.row + k, l.text, l.fg))
}
