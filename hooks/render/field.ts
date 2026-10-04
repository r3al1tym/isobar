import type { Weather } from '../engine/weather'
import type { Layout } from './layout'
import { fbm, hashOf, lattice, mulberry, valueNoise } from './noise'

/** Which weather layers are drawn; each toggles on its own and they add. */
export type Layers = { code: boolean; impact: boolean; risk: boolean; history: boolean }

export const ALL_LAYERS: Layers = { code: true, impact: true, risk: true, history: true }

/**
 * The layers a session starts with. History's rings are off until `4` turns them on: backtested,
 * about half of them name a file the change left out (bench/history.mts).
 */
export const DEFAULT_LAYERS: Layers = { ...ALL_LAYERS, history: false }

/** The weather field in half-block pixels: x in columns, y in half rows, RGB 0..255. */
export type Field = {
  w: number
  h: number
  /** radar bin per pixel, 0 (dry) to 9 (the eye); the palette colours it */
  level: Uint8Array
  /** 1 where the reach's rain sets the pixel's bin rather than a storm: it takes the rain's own hue */
  wet: Uint8Array
  /** where each edit's eye is drawn, as a glyph over the weather */
  eyes: { path: string; x: number; y: number; risk: number; isLatest: boolean }[]
  /** where history expected a change: drawn as dashed braille contours over the weather */
  rings: { path: string; region: string; x: number; y: number; share: number }[]
  /** the offshoot's track: evenly spaced stops from the storm to the farthest file, drawn as ink dots */
  track: { x: number; y: number }[]
}

import { BINS, COOL_TOP, RAIN_TOP, STORM } from './palette'

type Puff = { x: number; y: number; sx: number; sy: number; amp: number }

/** The storm, rain and marks of `weather` over `layout`, as radar bins any ground can colour. */
export function fieldOf(layout: Layout, weather: Weather | null, layers: Layers, seedText: string): Field {
  const w = layout.cols
  const h = layout.rows * 2
  const level = new Uint8Array(w * h)
  const wet = new Uint8Array(w * h)
  const seed = hashOf(seedText)

  if (weather === null) return { w, h, level, wet, eyes: [], rings: [], track: [] }

  const rnd = mulberry(seed)
  const pointOf = placer(layout, seed)
  const storm: Puff[] = []
  const rain: Puff[] = []

  // the riskiest edit of the latest turn is the lead storm and alone reaches the hottest bins;
  // the rest burn a step cooler, and an earlier turn's edits fade to a light shower
  const lead: Puff[] = []
  const latest = weather.cells.filter(c => c.isLatest)
  const riskiest = [...latest].sort((a, b) => b.risk - a.risk)[0]?.path
  const faded = new Set(weather.cells.filter(c => !c.isLatest).map(c => c.path))

  if (layers.risk) {
    // a region carrying many edits pools them into one system: each burns and spreads a little less, so
    // the storm keeps its eyes and bands instead of filling the region flat
    const many = new Map<string, number>()

    for (const c of weather.cells) many.set(c.region, (many.get(c.region) ?? 0) + 1)
    for (const c of weather.cells) {
      const p = pointOf(c.path, c.region)
      const I = faded.has(c.path) ? c.risk * 0.4 : c.risk
      const into = c.path === riskiest ? lead : storm
      const crowd = c.path === riskiest ? 1 : 1 / Math.sqrt(Math.max(1, (many.get(c.region) ?? 1) / 2))
      const S = 0.55 + 0.45 * crowd

      cloud(into, rnd, p.x, p.y, (3 + 10 * I) * S, (2.4 + 7 * I) * S, Math.round(14 * (0.6 + 0.8 * I)), (0.45 + 0.95 * I) * crowd)
      cloud(into, rnd, p.x + 1.5 + 3 * I, p.y - 1 - 1.5 * I, (2 + 5 * I) * S, (1.6 + 3.5 * I) * S, Math.round(6 * (0.5 + I)), (0.14 + 0.22 * I) * crowd)
    }
  }
  if (layers.impact) {
    // a soft rain over each file that uses what changed (or, for an edit read whole, imports it
    // directly), pooling where many sit together; files further out are carried by the arms and
    // the track, so the map stays clear
    const near = weather.reach.filter(r => (r.uses === null ? r.hop === 1 : r.uses > 0))
    const every = Math.max(1, Math.ceil(near.length / 320))
    const crowd = 1 / Math.sqrt(Math.max(1, near.length / 40))
    const soft = [0, 0.5, 0.34, 0.22].map(a => a * crowd)

    near.forEach((r, i) => {
      if (i % every !== 0) return
      const p = pointOf(r.path, r.region)

      cloud(rain, rnd, p.x, p.y, 2.8, 2.3, 3, (soft[Math.min(3, r.hop)] ?? 0.1) * Math.sqrt(every) * (faded.has(r.of) ? 0.45 : 1))
    })
    // one arm per reached region, blown along the import chain from the edit
    // (the offshoot's region is reached by its dotted track instead, so the track crosses dry ground)
    const far = weather.offshoots[0]?.region
    for (const arm of weather.arms.slice(0, 6)) {
      const strength = Math.min(1, Math.log2(1 + arm.count) / Math.log2(41))
      const points = arm.chain.map(f => pointOf(f, regionOfPath(weather, f) ?? arm.region))

      if (arm.region !== far) band(rain, rnd, points, 1.3 + 1.6 * strength, (0.42 + 0.55 * strength) * (arm.hop === 1 ? 1 : arm.hop === 2 ? 0.8 : 0.65), seed)
      const end = points[points.length - 1]

      if (end !== undefined) cloud(rain, rnd, end.x, end.y, 2 + 4 * strength, 1.7 + 3 * strength, Math.round(4 + 6 * strength), 0.5 + 0.7 * strength)
    }
  }
  // one sweep from the edit to the farthest file; the forecast names the hops between
  const track = layers.impact ? weather.offshoots.slice(0, 1).flatMap(o => {
    const ends = [o.chain[0], o.chain[o.chain.length - 1]].filter(f => f !== undefined)

    return trackOf(ends.map(f => pointOf(f, regionOfPath(weather, f) ?? o.region)), seed)
  }) : []

  const leadDensity = new Float32Array(w * h)
  const stormDensity = new Float32Array(w * h)
  const rainDensity = new Float32Array(w * h)
  const warp = warpOf(w, h, seed)

  splat(leadDensity, w, h, lead, warp, 2.2)
  splat(stormDensity, w, h, storm, warp, 2.2)
  splat(rainDensity, w, h, rain, warp, 1.6)
  radar(level, wet, leadDensity, stormDensity, rainDensity, w, h, seed)
  // at most two rings, each on open ground: a ring inside the storm or over another reads as a tangle
  const rings: Field['rings'] = []

  for (const e of layers.history ? weather.expected : []) {
    const p = pointOf(e.path, e.region)
    const isInStorm = (level[Math.round(p.y) * w + Math.round(p.x)] ?? 0) >= STORM
    const isOverRing = rings.some(r => Math.abs(r.x - p.x) < 12 && Math.abs(r.y - p.y) < 11)

    if (rings.length < 2 && !isInStorm && !isOverRing) rings.push({ path: e.path, region: e.region, ...p, share: e.together / e.of })
  }
  const eyes = layers.code
    ? [...weather.cells].sort((a, b) => Number(b.isLatest) - Number(a.isLatest) || b.risk - a.risk).slice(0, 8).map(c => ({ path: c.path, ...pointOf(c.path, c.region), risk: c.risk, isLatest: c.isLatest }))
    : []

  return { w, h, level, wet, eyes, rings, track }
}

/** A file's point; a file the layout has no point for (new, untracked) gets a stable spot in its cell. */
function placer(layout: Layout, seed: number) {
  return (path: string, region: string) => {
    const known = layout.points.get(path)

    if (known !== undefined) return known
    const cell = layout.cells.find(c => c.region.id === region)?.rect ?? { x: 0, y: 0, w: layout.cols, h: layout.rows }
    const k = hashOf(path) ^ seed

    return { x: cell.x + 1 + lattice(k, 1, 3) * Math.max(1, cell.w - 2), y: (cell.y + 1) * 2 + lattice(k, 2, 5) * Math.max(1, cell.h * 2 - 3) }
  }
}

/** A cloud of puffs, dense and hot at the middle, scattering outward: one cell of precipitation. */
function cloud(out: Puff[], rnd: () => number, cx: number, cy: number, sx: number, sy: number, n: number, amp: number) {
  for (let i = 0; i < n; i++) {
    const t = Math.pow(rnd(), 1.6)
    const a = rnd() * Math.PI * 2
    const r = 0.7 + 0.6 * rnd()

    out.push({
      x: cx + Math.cos(a) * sx * t * r,
      y: cy + Math.sin(a) * sy * t * r,
      sx: Math.max(0.9, sx * (0.22 + 0.42 * (1 - t)) * (0.7 + 0.6 * rnd())),
      sy: Math.max(0.8, sy * (0.22 + 0.42 * (1 - t)) * (0.7 + 0.6 * rnd())),
      amp: (amp * (0.55 + 0.9 * (1 - t))) / Math.sqrt(n / 6),
    })
  }
}

function regionOfPath(weather: Weather, path: string): string | undefined {
  return weather.cells.find(c => c.path === path)?.region ?? weather.reach.find(r => r.path === path)?.region
}

/** Points along `chain`, each leg bowed a little, `step` pixels apart. */
function along(chain: readonly { x: number; y: number }[], step: number, seed: number, each: (x: number, y: number, t: number) => void) {
  const legs = chain.length - 1

  for (let k = 0; k < legs; k++) {
    const a = chain[k]!
    const b = chain[k + 1]!
    const dist = Math.hypot(b.x - a.x, b.y - a.y)

    if (dist < 1) continue
    const bow = Math.min(8, dist * 0.18) * (lattice(k, Math.round(a.x + b.y), seed) > 0.5 ? 1 : -1)
    const cx = (a.x + b.x) / 2 - ((b.y - a.y) / dist) * bow
    const cy = (a.y + b.y) / 2 + ((b.x - a.x) / dist) * bow
    const steps = Math.max(2, Math.round(dist / step))

    for (let i = 1; i <= steps; i++) {
      const t = i / (steps + 1)

      each((1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * cx + t * t * b.x, (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * cy + t * t * b.y, (k + t) / legs)
    }
  }
}

/** An arm of rain: overlapping puffs along the chain, thinning as it travels. */
function band(out: Puff[], rnd: () => number, chain: readonly { x: number; y: number }[], width: number, amp: number, seed: number) {
  along(chain, 1.6, seed, (x, y, t) => {
    const s = width * (1 - 0.35 * t) * (0.75 + 0.5 * rnd())

    out.push({ x: x + (rnd() - 0.5) * width, y: y + (rnd() - 0.5) * width, sx: s, sy: s * 0.85, amp: (amp * (1 - 0.45 * t)) / 2 })
  })
}

/** The offshoot's dotted track: even stops along `chain`, from just past the storm to its end. */
function trackOf(chain: readonly { x: number; y: number }[], seed: number): { x: number; y: number }[] {
  const stops: { x: number; y: number }[] = []

  along(chain, 0.25, seed + 1, (x, y) => {
    const last = stops[stops.length - 1]

    // a pixel is half a row, about a column across, so distance in pixels is distance as seen
    if (last === undefined ? Math.hypot(x - chain[0]!.x, y - chain[0]!.y) > 6 : Math.hypot(x - last.x, y - last.y) >= 2.2) stops.push({ x, y })
  })
  return stops
}

/** A turbulent displacement per pixel, -1..1 on each axis, shared by every puff. */
function warpOf(w: number, h: number, seed: number): { x: Float32Array; y: Float32Array } {
  const fx = 9 / w
  const fy = 7 / h
  const x = new Float32Array(w * h)
  const y = new Float32Array(w * h)

  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      x[j * w + i] = (fbm(i * fx, j * fy, seed) - 0.5) * 2
      y[j * w + i] = (fbm(i * fx + 31, j * fy + 17, seed) - 0.5) * 2
    }
  }
  return { x, y }
}

/** Adds each puff's Gaussian to `density`, sampled through the warp so the edges go ragged. */
function splat(density: Float32Array, w: number, h: number, puffs: readonly Puff[], warp: { x: Float32Array; y: Float32Array }, scale: number) {
  for (const p of puffs) {
    const rx = Math.ceil(p.sx * 3 + scale)
    const ry = Math.ceil(p.sy * 3 + scale)

    for (let y = Math.max(0, Math.floor(p.y - ry)); y < Math.min(h, Math.ceil(p.y + ry)); y++) {
      for (let x = Math.max(0, Math.floor(p.x - rx)); x < Math.min(w, Math.ceil(p.x + rx)); x++) {
        const k = y * w + x
        const dx = (x + 0.5 + scale * (warp.x[k] ?? 0) - p.x) / p.sx
        const dy = (y + 0.5 + scale * (warp.y[k] ?? 0) - p.y) / p.sy

        density[k] = (density[k] ?? 0) + p.amp * Math.exp(-0.5 * (dx * dx + dy * dy))
      }
    }
  }
}

/**
 * Density to radar bins, stepped like isobands: a slow noise breathes the edges so no two
 * bands run parallel. Only the lead storm reaches the top bins, the other edits stop below
 * them, and the rain stops below both; the faintest rain is left as dry ground so a wide
 * reach never hazes the map.
 */
function radar(level: Uint8Array, wet: Uint8Array, lead: Float32Array, storm: Float32Array, rain: Float32Array, w: number, h: number, seed: number) {
  const top = BINS - 1
  const binOf = (d: number, k: number, lift = 0.5) => Math.max(0, Math.floor(top * (1 - Math.exp(-k * d)) + lift))

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const l = lead[i] ?? 0
      const s = storm[i] ?? 0
      const r = rain[i] ?? 0

      if (l < 0.05 && s < 0.05 && r < 0.05) continue
      const jitter = 0.82 + 0.36 * valueNoise(x * 0.11, y * 0.16, seed + 5)

      const fire = Math.max(binOf(l * jitter, 0.3), Math.min(COOL_TOP, binOf(s * jitter * 0.55, 0.3)))
      const wash = Math.min(RAIN_TOP, binOf(r * jitter, 0.16, -1.6))

      level[i] = Math.min(top, Math.max(fire, wash))
      // the rain takes its own hue wherever it, and no storm, sets the bin
      wet[i] = wash > fire ? 1 : 0
    }
  }
}
