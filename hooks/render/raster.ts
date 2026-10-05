/**
 * The cell grid every terminal drawing is made of, and its packing for the `Raster`
 * element: `columns * rows` little-endian u32 triplets `[codePoint, fg, bg]`, base64.
 */

export type Cell = { glyph: string; fg: number; bg: number }

export type Grid = { cols: number; rows: number; cells: Cell[] }

export const rgb = (r: number, g: number, b: number): number =>
  ((clamp255(r) << 16) | (clamp255(g) << 8) | clamp255(b)) >>> 0

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)))

export const channels = (c: number): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255]

/** Perceived brightness, 0 to 255. */
export const luma = (c: number): number => {
  const [r, g, b] = channels(c)

  return 0.299 * r + 0.587 * g + 0.114 * b
}

export function gridOf(cols: number, rows: number, bg: number): Grid {
  return { cols, rows, cells: Array.from({ length: cols * rows }, () => ({ glyph: ' ', fg: bg, bg })) }
}

export function put(grid: Grid, x: number, y: number, cell: Partial<Cell>) {
  if (x < 0 || y < 0 || x >= grid.cols || y >= grid.rows) return
  const at = grid.cells[y * grid.cols + x]

  if (at !== undefined) Object.assign(at, cell)
}

export function cellAt(grid: Grid, x: number, y: number): Cell | undefined {
  return x < 0 || y < 0 || x >= grid.cols || y >= grid.rows ? undefined : grid.cells[y * grid.cols + x]
}

/**
 * Writes `text` from (x, y) in `fg`, keeping each cell's background unless `bg` is given. The text
 * is composed first (NFC), so a letter and its accent take one cell as one code point.
 */
export function write(grid: Grid, x: number, y: number, text: string, fg: number, bg?: number) {
  let i = 0

  for (const ch of text.normalize('NFC')) {
    const at = cellAt(grid, x + i, y)

    if (at !== undefined) {
      at.glyph = ch
      at.fg = fg
      if (bg !== undefined) at.bg = bg
    }
    i++
  }
}

/**
 * Code points that take no cell of their own or move the text around them: unassigned, format
 * (bidi controls, zero-width spaces), combining marks, line and paragraph separators, and the
 * emoji that draw two cells wide.
 */
const NO_CELL = /[\p{Cn}\p{Cf}\p{Mn}\p{Mc}\p{Me}\p{Zl}\p{Zp}\p{Emoji_Presentation}]/u

/** A printable width-1 BMP code point, else a space. */
export function codePointOf(glyph: string): number {
  const p = glyph.codePointAt(0) ?? 0x20
  const ok =
    p >= 0x20 && p <= 0xffff && p !== 0x7f && !(p >= 0x80 && p < 0xa0) && !(p >= 0xd800 && p <= 0xdfff) &&
    !(p >= 0x1100 && p <= 0x115f) && !(p >= 0x2e80 && p <= 0xa4cf) && !(p >= 0xac00 && p <= 0xd7a3) &&
    !(p >= 0xf900 && p <= 0xfaff) && !(p >= 0xfe30 && p <= 0xfe6f) && !(p >= 0xff00 && p <= 0xff60) && !(p >= 0xffe0 && p <= 0xffe6) &&
    // Hangul jamo that join the syllable before them, and code points a terminal draws two cells wide or in none
    !(p >= 0x1160 && p <= 0x11ff) && !(p >= 0xd7b0 && p <= 0xd7ff) && !(p >= 0xa960 && p <= 0xa97f) && !(p >= 0xfe10 && p <= 0xfe19) &&
    !(p >= 0x2329 && p <= 0x232a) && !(p >= 0x2630 && p <= 0x2637) && !(p >= 0x268a && p <= 0x268f) && p !== 0x0980 && p !== 0x0c80 && p !== 0x0d3a &&
    (p < 0x7f || !NO_CELL.test(String.fromCodePoint(p)))

  return ok ? p : 0x20
}

/**
 * Snaps colours to a coarser step until the grid holds at most `limit` distinct
 * foreground/background pairs: the terminal paints 1024 at once and the rest as their
 * nearest, so the grid decides its own nearest instead.
 */
export function quantize(grid: Grid, limit = 1000): Grid {
  for (let step = 1; step <= 32; step++) {
    const snap = (c: number) => {
      if (step === 1) return c
      const [r, g, b] = channels(c)
      const q = (v: number) => Math.min(255, Math.round(v / step) * step)

      return rgb(q(r), q(g), q(b))
    }
    const cells = grid.cells.map(c => {
      const bg = snap(c.bg)
      const fg = c.glyph === ' ' ? bg : snap(c.fg)

      return { glyph: fg === bg && c.glyph === '▀' ? ' ' : c.glyph, fg, bg }
    })
    const pairs = new Set(cells.map(c => `${c.fg},${c.bg}`))

    if (pairs.size <= limit || step === 32) return { ...grid, cells }
  }
  return grid
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function base64Of(bytes: Uint8Array): string {
  let out = ''

  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0

    out += B64[a >> 2]! + B64[((a & 3) << 4) | (b >> 4)]! + (i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)]! : '=') + (i + 2 < bytes.length ? B64[c & 63]! : '=')
  }
  return out
}

/** The grid as a `Raster`'s `cells` prop. */
export function packGrid(grid: Grid): string {
  const bytes = new Uint8Array(grid.cells.length * 12)
  const view = new DataView(bytes.buffer)

  grid.cells.forEach((c, i) => {
    view.setUint32(i * 12, codePointOf(c.glyph), true)
    view.setUint32(i * 12 + 4, c.fg >>> 0, true)
    view.setUint32(i * 12 + 8, c.bg >>> 0, true)
  })
  return base64Of(bytes)
}
