/**
 * Every colour the pane paints. The terminal's Raster paints 4 bits a channel
 * (each channel a multiple of 0x11), so each set is chosen on that grid: a colour
 * off it would be snapped channel by channel and drift in hue. The radar ramps walk
 * that grid in OKLab steps of 0.03 to 0.06, lightness always moving one way, so
 * no band jumps against its neighbour. The change burns in one hue and its reach rains in
 * another, slate blue, so what changed and what it touches read apart at a glance.
 *
 * Where Claude Code paints 256 colours (inside tmux, or where COLORTERM never says
 * truecolor) it moves each colour onto xterm's palette, and the cream paper lands on
 * a yellow. The 256 sets are drawn from that palette itself, each colour one that lands
 * on the same xterm colour whether it is rounded or matched to its nearest, so what
 * they name is what the terminal shows.
 */

/** A badge's ink and its ground. */
export type Chip = { fg: number; bg: number }

/** One printing of the chart: its ground, the radar bins over it, and the inks set on both. */
export type Inks = {
  /** the ground the pane and its map are printed on */
  paper: number
  /** radar bins, 0 = dry ground to BINS - 1 = the storm's core */
  radar: readonly number[]
  /** the hairline over each bin, two bins on, so a line tints the weather under it */
  line: readonly number[]
  /** the reach's rain, bin by bin in its own cooler hue; bin 0 is the same dry ground */
  rain: readonly number[]
  /** the hairline over each bin of rain */
  rainLine: readonly number[]
  /** the frame around the map */
  frame: number
  /** changed regions' names, the edit's note and the legend's words */
  ink: number
  /** reached regions' names, secondary notes and the title */
  muted: number
  /** the title's repo, the legend's keys, a layer switched off */
  faint: number
  /** a dry region's name: an inscription two steps off the ground, a step past its hairlines */
  nameDry: number
  /** the track, its note and the untested-risk line */
  red: number
  /** red ink set on rain, a step further from the ground so it never sinks into its own colour */
  redOnRain: number
  /** history's dashed contours and their notes */
  history: number
  /** an edit's eye: the calm point at the storm's core */
  eye: number
  /** any ink set on the storm itself */
  onStorm: number
  changed: Chip
  untested: Chip
  expected: Chip
  /** an edit the scope check says nobody asked for */
  unasked: Chip
  /** a ground darker than its inks */
  isNight: boolean
}

const paperRadar = [0xffeedd, 0xffddbb, 0xffccaa, 0xffbb99, 0xffaa88, 0xee9977, 0xee8866, 0xdd7755, 0xdd6644, 0xcc5533, 0xbb4433, 0xbb3322, 0xaa3322, 0x993322, 0x992211, 0x881111, 0x771111]
const nightRadar = [0x111111, 0x221111, 0x331111, 0x441111, 0x552211, 0x662211, 0x884422, 0x995522, 0xaa5522, 0xbb6633, 0xcc7733, 0xdd8844, 0xee9955, 0xffaa66, 0xffbb77, 0xffcc88, 0xffddaa]
// the reach's rain: slate blue, a step lighter than the storm bin for bin, so the change stays the loudest thing on the map
const paperRain = [0xffeedd, 0xeeeeff, 0xddeeff, 0xccddee, 0xbbccee, 0xaabbdd, 0x99aacc, 0x8899bb, 0x7788aa, 0x667799, 0x556688, 0x445577, 0x334466, 0x223355, 0x112244, 0x112233, 0x001122]
const nightRain = [0x111111, 0x111122, 0x112233, 0x223344, 0x223355, 0x334466, 0x335577, 0x446688, 0x557799, 0x6688aa, 0x7799bb, 0x88aacc, 0x99bbdd, 0xaaccee, 0xbbddee, 0xccddff, 0xddeeff]

/**
 * Each bin's hairline: two bins on, the dry ground's a neutral step off it. A 256 ramp repeats
 * a colour across bins, so its hairline is the first colour on that shows darker.
 */
const linesOf = (radar: readonly number[], dry: number, shows = (c: number) => c) =>
  radar.map((c, k) => (k === 0 ? dry : (radar.slice(k + 2).find(next => shows(next) !== shows(c)) ?? radar[radar.length - 1]!)))

/** Warm cream paper, apricot rain deepening through terracotta to a deep-red core, sepia inks. */
export const PAPER_INKS: Inks = {
  paper: 0xffeedd,
  radar: paperRadar,
  line: linesOf(paperRadar, 0xeeddcc),
  rain: paperRain,
  rainLine: linesOf(paperRain, 0xeeddcc),
  frame: 0xddccbb,
  ink: 0x332211,
  muted: 0x776655,
  faint: 0xaa9988,
  nameDry: 0xddccbb,
  red: 0xaa3322,
  redOnRain: 0x661111,
  history: 0x993311,
  eye: 0xffeedd,
  onStorm: 0xffeedd,
  changed: { fg: 0xffeedd, bg: 0xcc5533 },
  untested: { fg: 0x776655, bg: 0xeeddcc },
  expected: { fg: 0x774411, bg: 0xffdd99 },
  unasked: { fg: 0xffeedd, bg: 0x332211 },
  isNight: false,
}

/** The terminal's own near-black with the weather burning up through it: the same chart at night. */
export const NIGHT_INKS: Inks = {
  paper: 0x111111,
  radar: nightRadar,
  line: linesOf(nightRadar, 0x222222),
  rain: nightRain,
  rainLine: linesOf(nightRain, 0x222222),
  frame: 0x333333,
  ink: 0xeeddcc,
  muted: 0xaa9988,
  faint: 0x776655,
  nameDry: 0x443333,
  red: 0xff7755,
  redOnRain: 0xffaa88,
  history: 0x997744,
  eye: 0xffffee,
  onStorm: 0x111111,
  changed: { fg: 0x111111, bg: 0xcc6633 },
  untested: { fg: 0xaa9988, bg: 0x333333 },
  expected: { fg: 0xddaa55, bg: 0x443311 },
  unasked: { fg: 0x111111, bg: 0xeeddcc },
  isNight: true,
}

/** How many radar bins every set of inks colours. */
export const BINS = paperRadar.length

/** The first bin of the storm proper: inks set on it turn to `onStorm`. */
export const STORM = 10

/** Bins every edit but the riskiest may reach: the top four belong to the lead storm. */
export const COOL_TOP = 12

/** Bins the reach's rain may reach: the brightest and deepest bins belong to the edit. */
export const RAIN_TOP = 7

/** How many colours the terminal paints: 24-bit, or xterm's 256. */
export type Colors = 'truecolor' | '256'

/** The six levels of each channel in xterm's colour cube. */
const CUBE = [0x00, 0x5f, 0x87, 0xaf, 0xd7, 0xff]

/** The colour xterm colour `i` (16 to 255) shows. */
export function xtermColour(i: number): number {
  if (i >= 232) return 0x010101 * (8 + 10 * (i - 232))
  const k = i - 16

  return (CUBE[Math.floor(k / 36)]! << 16) | (CUBE[Math.floor(k / 6) % 6]! << 8) | CUBE[k % 6]!
}

const distance = (p: number, q: number) => (((p >> 16) & 255) - ((q >> 16) & 255)) ** 2 + (((p >> 8) & 255) - ((q >> 8) & 255)) ** 2 + ((p & 255) - (q & 255)) ** 2

/** The xterm colour nearest `c`: how the Raster paints `c` in 256 colours (0xbb7744 shows as 0xaf875f). */
export function xtermOf(c: number): number {
  let best = 16

  for (let i = 17; i < 256; i++) if (distance(c, xtermColour(i)) < distance(c, xtermColour(best))) best = i
  return best
}

/**
 * The xterm colour Claude Code's own text takes for `c` in 256 colours: each channel rounds to
 * one of six even steps of 0x33 (0xbb7744 shows as 0xd7875f), an even grey to the grey ramp.
 */
export function roundedXtermOf(c: number): number {
  const [r, g, b] = [(c >> 16) & 255, (c >> 8) & 255, c & 255]

  if (r === g && g === b) return r < 8 ? 16 : r > 248 ? 231 : Math.round(((r - 8) / 247) * 24) + 232
  return 16 + 36 * Math.round(r / 51) + 6 * Math.round(g / 51) + Math.round(b / 51)
}

/** What a 256-colour terminal shows for `c` in the Raster. */
export const shown256 = (c: number): number => xtermColour(xtermOf(c))

// every 4-bit colour that lands on one xterm colour both ways, by that colour, the nearest to it first
const LANDINGS = new Map<number, number[]>()

for (let n = 0; n < 4096; n++) {
  const c = 0x11 * (((n >> 8) << 16) | (((n >> 4) & 15) << 8) | (n & 15))
  const i = xtermOf(c)

  if (roundedXtermOf(c) === i) LANDINGS.set(i, [...(LANDINGS.get(i) ?? []), c])
}
for (const [i, cs] of LANDINGS) cs.sort((p, q) => distance(p, xtermColour(i)) - distance(q, xtermColour(i)))

/**
 * A 4-bit colour the terminal paints as xterm colour `i`; the `nth` gives another of them, so
 * a ramp can repeat a colour across bins under names the sheet still tells apart.
 */
function xterm(i: number, nth = 0): number {
  const cs = LANDINGS.get(i)

  if (cs === undefined || cs[nth] === undefined) throw new Error(`no 4-bit colour lands on xterm ${i} (${nth})`)
  return cs[nth]!
}

/** A ramp of xterm colours, each repeat under its next name. */
const rampOf = (indices: readonly number[]) => indices.map((i, k) => xterm(i, indices.slice(0, k).filter(j => j === i).length))

/** White paper, apricot rain deepening through terracotta to a deep-red core: the paper chart in xterm's colours. */
const paperRadar256 = rampOf([231, 223, 223, 216, 216, 173, 173, 173, 167, 167, 167, 88, 88, 88, 88, 52, 52])
/** Near-black with the weather burning up through red and amber: the night chart in xterm's colours. */
const nightRadar256 = rampOf([233, 52, 52, 52, 88, 88, 88, 131, 131, 173, 173, 180, 180, 216, 216, 223, 223])
/** The reach's slate rain in xterm's colours, on each ground. */
const paperRain256 = rampOf([231, 189, 189, 153, 153, 146, 110, 110, 67, 67, 61, 61, 24, 24, 17, 17, 17])
const nightRain256 = rampOf([233, 19, 19, 24, 24, 24, 60, 61, 61, 67, 67, 104, 110, 110, 146, 153, 189])

export const PAPER_INKS_256: Inks = {
  paper: paperRadar256[0]!,
  radar: paperRadar256,
  line: linesOf(paperRadar256, xterm(253), shown256),
  rain: paperRain256,
  rainLine: linesOf(paperRain256, xterm(253), shown256),
  frame: xterm(253),
  ink: xterm(236),
  muted: xterm(243),
  faint: xterm(248),
  nameDry: xterm(253),
  red: xterm(124),
  redOnRain: xterm(52),
  history: xterm(130),
  eye: xterm(231),
  onStorm: xterm(231),
  changed: { fg: xterm(231), bg: xterm(167) },
  untested: { fg: xterm(243), bg: xterm(253) },
  expected: { fg: xterm(94), bg: xterm(222) },
  unasked: { fg: xterm(231), bg: xterm(236) },
  isNight: false,
}

export const NIGHT_INKS_256: Inks = {
  paper: nightRadar256[0]!,
  radar: nightRadar256,
  line: linesOf(nightRadar256, xterm(235), shown256),
  rain: nightRain256,
  rainLine: linesOf(nightRain256, xterm(235), shown256),
  frame: xterm(236),
  ink: xterm(253),
  muted: xterm(248),
  faint: xterm(243),
  nameDry: xterm(238),
  red: xterm(209),
  redOnRain: xterm(216),
  history: xterm(137),
  eye: xterm(231),
  onStorm: xterm(233),
  changed: { fg: xterm(233), bg: xterm(173) },
  untested: { fg: xterm(248), bg: xterm(236) },
  expected: { fg: xterm(179), bg: xterm(236) },
  unasked: { fg: xterm(233), bg: xterm(253) },
  isNight: true,
}

/** The inks for a ground on a terminal that paints `colors`. */
export const inksOf = (ground: 'paper' | 'night', colors: Colors): Inks =>
  colors === '256' ? (ground === 'night' ? NIGHT_INKS_256 : PAPER_INKS_256) : ground === 'night' ? NIGHT_INKS : PAPER_INKS

/**
 * How many colours Claude Code paints for a terminal's environment, decided as it decides:
 * 256 inside tmux; 24-bit where COLORTERM is truecolor or the terminal is kitty, Ghostty or
 * iTerm; 256 everywhere else.
 */
export function colorsOf(env: Readonly<Record<string, string | undefined>>): Colors {
  if (env.TMUX) return '256'
  return env.COLORTERM === 'truecolor' || env.TERM === 'xterm-kitty' || env.TERM === 'xterm-ghostty' || env.TERM_PROGRAM === 'iTerm.app' ? 'truecolor' : '256'
}
