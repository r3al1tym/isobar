import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { IsobarLayers } from '../types'
import { basemapPrompt, completeRegions, finishBasemap, heuristicRegions, parseBasemapReply, unitsOf } from './engine/basemap'
import { currentChange, gatherFacts, repoRoot } from './engine/git'
import { gistLines, gistPrompt, parseGistReply } from './engine/gist'
import { graphOf } from './engine/graph'
import { excerptOf, parseScopeReply, scopePrompt } from './engine/scope'
import { attribute, hashesOf, type Ledger } from './engine/session'
import { readChange, type ChangeRead } from './engine/symbols'
import type { Basemap, Facts, Run } from './engine/types'
import { weatherOf, type Weather } from './engine/weather'
import { DEFAULT_LAYERS } from './render/field'
import { colorsOf, type Colors } from './render/palette'
import { packGrid } from './render/raster'
import { sheetOf } from './render/sheet'

const PANE = 'isobar'
const tick = atom({ plugin: 'isobar', key: 'tick' } as const, 0)
const layersAtom = atom({ plugin: 'isobar', key: 'layers' } as const, DEFAULT_LAYERS as IsobarLayers)
/** Whether the pane has opened this session: kept by the host, so a reload never reopens a pane the person closed. */
const openedAtom = atom({ plugin: 'isobar', key: 'opened' } as const, false)

/** Tools whose calls can change the working tree. */
const WRITES = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash'])
const LAYER_DIGITS = { '1': 'code', '2': 'impact', '3': 'risk', '4': 'history' } as const

/** What the pane draws from. Rebuilt from git on every reload, so a module variable is enough. */
const sky = {
  cwd: '',
  /** The repository mapped now. */
  root: null as string | null,
  /** The repository the next refresh maps: the last edited file's (a Bash command leaves it be). */
  target: null as string | null,
  /** folder → the repository it sits in, so an edit asks git once per folder */
  roots: new Map<string, string>(),
  repo: '',
  facts: null as Facts | null,
  map: null as Basemap | null,
  weather: null as Weather | null,
  status: undefined as string | undefined,
  /** What the map is printed on, from the `ground` option or else the Claude Code theme. */
  ground: 'paper' as 'paper' | 'night',
  /** How many colours the terminal paints, from the `colors` option or else the environment Claude Code started in. */
  colors: 'truecolor' as Colors,
  /** repository → the untracked files this session wrote there, relative to it */
  created: new Map<string, Set<string>>(),
  /** repository → the files this session's own edits named, relative to it */
  edited: new Map<string, Set<string>>(),
  /** repository → each changed file's content when last seen, and the turn that wrote it */
  ledgers: new Map<string, Ledger>(),
  /** repository → file → what the scope check said of it, and the content it said it of */
  unasked: new Map<string, Map<string, { why: string; hash: string }>>(),
  /** repository → region → the gist's caption for the change there, and the change it was written of */
  gists: new Map<string, Map<string, { what: string; key: string }>>(),
  /** region → the change it carries now, as the gist keys it: each file's content, or the commit */
  gistKeys: new Map<string, string>(),
  /** the changes the gist has been asked of, so a reply that fails is never asked for again in a loop */
  gistAsked: new Set<string>(),
  /** whether the gist runs: after a turn, and on a commit shown while no turn runs */
  isGistOn: true,
  /** the change read declaration by declaration, for the scope check */
  read: undefined as ChangeRead | undefined,
  /** prompts this session has started: the turn the next edit belongs to */
  turn: 0,
  /** a turn is running: the gist waits for it to end, so it reads the turn whole */
  isTurnRunning: false,
  /** a turn ended and the scope check runs once the refresh it awaits is done */
  isScopeDue: false,
  /** the small model the gist and the scope check ask */
  smallModel: 'sonnet',
  isBusy: false,
  isAgain: false,
  timer: null as { cancel: () => void } | null,
}
let drawn: { key: string; cells: string } | null = null

export const register: Register = (on, options) => {
  const panel = options.panel === 'command' ? 'command' : 'auto'
  // empty: the model the session runs on
  const mapModel = typeof options.mapModel === 'string' ? options.mapModel.trim() : ''
  const scope = options.scope === 'on' ? 'on' : 'off'
  sky.isGistOn = options.gist !== 'off'
  sky.smallModel = typeof options.smallModel === 'string' && options.smallModel.trim() !== '' ? options.smallModel.trim() : 'sonnet'
  const ground = options.ground === 'night' || options.ground === 'auto' ? options.ground : 'paper'
  const colors = options.colors === 'truecolor' || options.colors === '256' ? options.colors : 'auto'

  on('session.start', async ($, e, next) => {
    const started = await next(e)

    if (!e.isInteractive) return started
    sky.cwd = e.cwd
    sky.ground = ground === 'auto' ? await groundOfTheme($) : ground
    sky.colors = colors === 'auto' ? await colorsOfTerminal($) : colors
    await $.command.register({ name: 'isobar', description: 'Show where this change reaches, as weather over a map of the codebase', argumentHint: '[map]' })
    void refresh($, mapModel, panel)

    return started
  })

  // a theme switched mid-session reprints the map on the new ground
  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const written = await next(e)

    if (ground === 'auto') {
      sky.ground = typeof e.value === 'string' && e.value.startsWith('light') ? 'paper' : 'night'
      await update($, tick, n => (n ?? 0) + 1)
    }
    return written
  })

  // a prompt starts a turn: edits from here on are its own, and anything changed since belongs to the one before
  on('turn.start', async ($, e, next) => {
    const started = await next(e)

    if (sky.cwd !== '') {
      const before = sky.turn

      sky.turn++
      sky.isTurnRunning = true
      void refresh($, mapModel, panel, false, before)
    }
    return started
  })

  // the main loop's end ends a turn: once the last refresh lands, the gist captions what changed, and on
  // an answer the scope check reads what it changed
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)

    if (e.agentId === undefined && sky.cwd !== '') {
      sky.isTurnRunning = false
      if (scope === 'on' && e.reason === 'answer') sky.isScopeDue = true
      if (scope === 'on' || sky.isGistOn) void refresh($, mapModel, panel)
    }
    return done
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)

    if (!WRITES.has(String(e.tool)) || sky.cwd === '') return result
    const input = e as unknown as Record<string, unknown>
    const raw = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : undefined

    // an edit maps the repository its file sits in; a Bash command keeps the map it has
    if (raw !== undefined) {
      const path = raw.startsWith('/') ? raw : `${sky.cwd}/${raw}`
      const root = await rootOfFile($, path)

      if (root !== null) {
        sky.target = root
        if (String(e.tool) === 'Write') createdIn(root).add(path.slice(root.length + 1))
        setOf(sky.edited, root).add(path.slice(root.length + 1))
      }
    }
    sky.timer?.cancel()
    sky.timer = $.clock.after(500, () => {
      void refresh($, mapModel, panel)
    })

    return result
  })

  on('command.run', { command: 'isobar' }, async ($, e) => {
    const arg = e.args.trim()

    if (arg === 'map') {
      sky.map = null
      void refresh($, mapModel, panel, true)
      return { text: 'Redrawing the basemap of this codebase. The pane updates when it is ready.' }
    }
    // the host knows which panes are open, across reloads; a pane behind another tab comes forward
    const pane = (await $.ui.panes()).find(p => p.id === PANE)

    if (pane?.isShown === true && pane.isPlaced) {
      await $.ui.close({ id: PANE })
      return { text: 'Isobar pane closed.' }
    }
    await openPane($, true)
    return { text: sky.weather?.headline ?? 'Isobar pane opened.' }
  })

  // The keys are hidden buttons: their hotkeys work, Tab never lands on them.
  on('ui.focus', { requestId: PANE }, ($, e, next) => (e.element?.startsWith('key-') ? { deny: 'isobar keys are hotkeys only' } : next(e)))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const version = await read($, tick)
    const layers = await read($, layersAtom)

    if (e.surface !== 'terminal') {
      const { Box, Markdown } = $.ui.resolve(e)
      const w = sky.weather

      const captions = Object.entries(w?.regions ?? {}).flatMap(([id, r]) => (r.what === undefined ? [] : [`- ${sky.map?.regions.find(x => x.id === id)?.name ?? id}: ${r.what}`]))

      return (
        <Box flexDirection="column">
          <Markdown text={[`**${sky.status ?? w?.headline ?? 'Reading the repository…'}**`, ...(captions.length > 0 ? [captions.join('\n')] : []), ...(w?.lines ?? [])].join('\n\n')} />
        </Box>
      )
    }

    const { Box, Button, Raster } = $.ui.resolve(e)
    const cols = Math.max(30, Math.min(512, e.props.bodyColumns))
    const rows = Math.max(12, Math.min(256, e.props.scroll.bodyRows))
    const key = `${version}:${cols}:${rows}:${sky.ground}:${sky.colors}:${layers.code}${layers.impact}${layers.risk}${layers.history}`

    if (drawn?.key !== key) {
      const grid = sheetOf(
        {
          repo: sky.repo || 'isobar',
          map: sky.map,
          files: sky.facts === null ? [] : [...sky.facts.lines.keys()],
          lines: sky.facts?.lines ?? new Map(),
          weather: sky.weather,
          layers,
          status: sky.status,
          ground: sky.ground,
          colors: sky.colors,
        },
        cols,
        rows,
      )

      drawn = { key, cells: packGrid(grid) }
    }

    return (
      <Box flexDirection="column">
        <Raster key="sheet" columns={cols} rows={rows} cells={drawn.cells} />
        <Box display="none">
          <Button key="key-1" hotkey="1" onPress={() => toggleLayer($, '1')}>code</Button>
          <Button key="key-2" hotkey="2" onPress={() => toggleLayer($, '2')}>impact</Button>
          <Button key="key-3" hotkey="3" onPress={() => toggleLayer($, '3')}>risk</Button>
          <Button key="key-4" hotkey="4" onPress={() => toggleLayer($, '4')}>history</Button>
          <Button key="key-p" hotkey="p" onPress={() => probe($)}>probe</Button>
          <Button key="key-m" hotkey="m" onPress={() => redrawMap($, mapModel, panel)}>map</Button>
        </Box>
      </Box>
    )
  })
}

type Dollar = EngineInterface

function setOf(by: Map<string, Set<string>>, root: string): Set<string> {
  const set = by.get(root) ?? new Set<string>()

  by.set(root, set)
  return set
}

const createdIn = (root: string) => setOf(sky.created, root)

/** The repository a file sits in, from git in its folder (or the nearest one that exists); null outside any. */
async function rootOfFile($: Dollar, path: string): Promise<string | null> {
  const run = runOf($)
  let dir = path.slice(0, path.lastIndexOf('/')) || '/'

  for (let i = 0; i < 12; i++) {
    const known = sky.roots.get(dir)

    if (known !== undefined) return known
    const root = await repoRoot(run, dir)

    if (root !== null) {
      sky.roots.set(dir, root)
      return root
    }
    if (dir === '/') return null
    dir = dir.slice(0, dir.lastIndexOf('/')) || '/'
  }
  return null
}

/** Night on a dark theme, paper on a light one: the map takes the ground the transcript beside it sits on. */
async function groundOfTheme($: Dollar): Promise<'paper' | 'night'> {
  try {
    const theme = (await $.config.list()).find(row => row.key === 'theme')?.value

    return typeof theme === 'string' && theme.startsWith('light') ? 'paper' : 'night'
  } catch {
    return 'night'
  }
}

/**
 * How many colours Claude Code paints in this terminal. It sets COLORTERM for itself once it
 * starts, so the environment it started with is read from /proc; where there is none (macOS),
 * tmux and Apple's Terminal are the 256-colour ones.
 */
async function colorsOfTerminal($: Dollar): Promise<Colors> {
  try {
    const started = await $.process.run(['sh', '-c', 'tr "\\0" "\\n" < /proc/$PPID/environ'], { timeoutMs: 5_000 })

    if (started.exitCode === 0 && started.stdout.includes('=')) {
      return colorsOf(Object.fromEntries(started.stdout.split('\n').map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)])))
    }
    return (await $.env.get('TMUX')) || (await $.env.get('TERM_PROGRAM')) === 'Apple_Terminal' ? '256' : 'truecolor'
  } catch {
    return 'truecolor'
  }
}

async function isPaneOpen($: Dollar): Promise<boolean> {
  return (await $.ui.panes()).some(p => p.id === PANE)
}

/** Opens the pane; asked for by the person, it takes the keys so 1–4, p and m work at once (Esc hands them back). */
async function openPane($: Dollar, isAsked = false) {
  await update($, openedAtom, () => true)
  await $.ui.open(isAsked ? { id: PANE, title: 'Isobar', columns: 96, focus: true } : { id: PANE, title: 'Isobar', columns: 96 })
}

async function toggleLayer($: Dollar, digit: keyof typeof LAYER_DIGITS) {
  const layer = LAYER_DIGITS[digit]

  await update($, layersAtom, l => ({ ...(l ?? DEFAULT_LAYERS), [layer]: !(l ?? DEFAULT_LAYERS)[layer] }))
}

/** Hands the farthest reach to the model as the person's own question. */
async function probe($: Dollar) {
  const w = sky.weather
  const far = w?.offshoots[0]

  if (w === null || far === undefined) {
    $.ui.toast('Nothing reaches past the regions this change sits in.')
    return
  }
  const region = sky.map?.regions.find(r => r.id === far.region)?.name ?? far.region

  await $.prompt.submit({
    text: `Check the farthest reach of my current change: ${far.chain.join(' → ')} (${far.hop} hops, into ${region}). Read ${far.path} and the files on that chain and tell me whether the change to ${far.chain[0]} can break it. Run its tests if it has any. Keep the answer short.`,
    asUser: true,
  })
}

async function redrawMap($: Dollar, mapModel: string, panel: string) {
  sky.map = null
  await refresh($, mapModel, panel, true)
}

const runOf =
  ($: Dollar): Run =>
  async argv => {
    const r = await $.process.run(argv, { timeoutMs: 20_000 })

    return { exitCode: r.exitCode, stdout: r.stdout }
  }

/**
 * Reads git, loads or draws the basemap, works out the weather, then redraws. One at a time.
 * Files whose content moved since the last refresh were written in `turn`.
 */
async function refresh($: Dollar, mapModel: string, panel: string, rebuild = false, turn = sky.turn) {
  if (sky.isBusy) {
    sky.isAgain = true
    return
  }
  sky.isBusy = true
  try {
    const run = runOf($)

    const root = sky.target ?? sky.root ?? (await repoRoot(run, sky.cwd))

    // a new repository gets its own map, kept or drawn once, and its own weather
    if (root !== sky.root) {
      sky.root = root
      sky.map = null
      sky.weather = null
    }
    if (sky.root === null) {
      sky.status = 'This folder is not a git repository, so there is no change to map.'
      return
    }
    sky.repo = sky.root.split('/').pop() ?? sky.root
    sky.facts = await gatherFacts(run, sky.root)
    const change = await currentChange(run, sky.root, [...createdIn(sky.root)])
    const isEditing = change.base.kind === 'uncommitted'
    // the session's ledger: which turn wrote each changed file; a clean tree starts an empty one,
    // so whatever changes from here on is this session's
    const hashes = isEditing ? await hashesOf(run, sky.root, change.changes) : new Map<string, string>()
    const ledger = isEditing ? attribute(sky.ledgers.get(sky.root), hashes, turn, setOf(sky.edited, sky.root)) : { hashes: new Map<string, string>(), turns: new Map<string, number>() }

    sky.ledgers.set(sky.root, ledger)

    // The map is drawn once per repository, and only once there is something to show on it.
    if (sky.map === null && !isEditing && !rebuild && !(await isPaneOpen($))) {
      sky.map = await keptMap($, sky.root, sky.facts)
      if (sky.map === null) return
    }
    sky.map ??= await mapFor($, sky.root, sky.facts, mapModel, rebuild)
    sky.status = undefined
    sky.read = await readChange(run, sky.root, sky.facts, change.changes, isEditing ? { from: 'HEAD' } : { from: 'HEAD~1', to: 'HEAD' }).catch(() => undefined)
    // what the scope check said, while the file is as it was when it said it
    const flagged = new Map([...(sky.unasked.get(sky.root) ?? [])].filter(([path, u]) => hashes.get(path) === u.hash).map(([path, u]) => [path, u.why]))

    // the gist's captions, held while the turn that changes them runs
    const held = sky.gists.get(sky.root) ?? new Map<string, { what: string; key: string }>()

    sky.weather = weatherOf(sky.map, sky.facts, change.base, change.changes, sky.read, { ...(isEditing ? { turns: ledger.turns } : {}), unasked: flagged, gists: new Map([...held].map(([id, g]) => [id, g.what])) })
    // each region's change as the gist keys it: its files' contents while editing, the commit once committed
    const cells = sky.weather.cells
    const sha = change.base.label.split(' ')[0] ?? ''

    sky.gistKeys = new Map([...new Set(cells.map(c => c.region))].map(id => [id, isEditing ? cells.filter(c => c.region === id).map(c => `${c.path}:${hashes.get(c.path) ?? ''}`).sort().join('|') : `commit:${sha}`]))
    if (panel === 'auto' && isEditing && !(await read($, openedAtom))) await openPane($)
  } catch (err) {
    sky.status = `Isobar could not read the repository: ${err instanceof Error ? err.message : String(err)}`
  } finally {
    sky.isBusy = false
    await update($, tick, n => (n ?? 0) + 1)
    if (sky.isAgain) {
      sky.isAgain = false
      void refresh($, mapModel, panel)
    } else {
      const isScopeDue = sky.isScopeDue
      const regions = staleGists()

      sky.isScopeDue = false
      if (isScopeDue || regions.length > 0) void readTurn($, mapModel, panel, isScopeDue, regions)
    }
  }
}

/** The regions whose change the gist has not captioned yet; none while a turn runs. */
function staleGists(): string[] {
  const root = sky.root

  if (!sky.isGistOn || sky.isTurnRunning || root === null || sky.weather === null) return []
  const held = sky.gists.get(root)

  return [...sky.gistKeys].filter(([id, key]) => held?.get(id)?.key !== key && !sky.gistAsked.has(`${root}:${id}@${key}`)).map(([id]) => id)
}

/** After a turn: the gist and the scope check read it side by side, and the pane redraws once with both. */
async function readTurn($: Dollar, mapModel: string, panel: string, isScopeDue: boolean, regions: readonly string[]) {
  const [flagged, captioned] = await Promise.all([isScopeDue ? checkScope($) : false, regions.length > 0 ? writeGists($, regions) : false])

  if (flagged || captioned) await refresh($, mapModel, panel)
}

/**
 * The gist: a small model reads the diff of each region the change sits in and captions what it
 * does there in a few words, so the map says what changed as well as where. A caption holds until
 * its region's change changes.
 */
async function writeGists($: Dollar, regions: readonly string[]): Promise<boolean> {
  const root = sky.root
  const w = sky.weather
  const map = sky.map

  if (root === null || w === null || map === null) return false
  const keys = new Map(regions.map(id => [id, sky.gistKeys.get(id) ?? '']))

  for (const [id, key] of keys) sky.gistAsked.add(`${root}:${id}@${key}`)
  const cells = w.cells.filter(c => keys.has(c.region))

  try {
    const excerpts = await excerptOf(runOf($), root, cells.map(c => c.path), w.base.kind === 'commit' ? ['HEAD~1', 'HEAD'] : ['HEAD'], gistLines(cells.length))
    const reply = await $.model.complete({ model: sky.smallModel, prompt: gistPrompt(map, cells, excerpts), maxTokens: 1500, effort: 'low', timeoutMs: 90_000 })
    const gists = reply.isAnswered ? parseGistReply(reply.text, new Set(keys.keys())) : null

    if (gists === null || gists.size === 0) return false
    const held = sky.gists.get(root) ?? new Map<string, { what: string; key: string }>()

    for (const [id, what] of gists) held.set(id, { what, key: keys.get(id) ?? '' })
    sky.gists.set(root, held)
    return true
  } catch {
    // the gist is a caption: when it cannot run, the map stays as it was
    return false
  }
}

/**
 * The scope check: after a turn that changed files, a small model reads the person's requests and
 * the turn's diff and names the changes nobody asked for. A flag holds until the file changes again.
 */
async function checkScope($: Dollar): Promise<boolean> {
  const root = sky.root
  const w = sky.weather
  const ledger = root === null ? undefined : sky.ledgers.get(root)

  if (root === null || w === null || ledger === undefined) return false
  const cells = w.cells.filter(c => c.turn === sky.turn)

  if (cells.length === 0) return false
  try {
    const asks = (await $.session.messages()).filter(m => m.role === 'user' && m.text.trim() !== '' && (m.toolResults?.length ?? 0) === 0).map(m => m.text.trim()).slice(-4)
    const excerpts = await excerptOf(runOf($), root, cells.map(c => c.path))
    const reply = await $.model.complete({ model: sky.smallModel, prompt: scopePrompt(asks, cells, excerpts), maxTokens: 1500, effort: 'low', timeoutMs: 90_000 })
    const flags = reply.isAnswered ? parseScopeReply(reply.text, new Set(cells.map(c => c.path))) : null

    if (flags === null) return false
    const kept = sky.unasked.get(root) ?? new Map<string, { why: string; hash: string }>()

    // the turn's files are judged afresh: a flag the model dropped is dropped
    for (const c of cells) kept.delete(c.path)
    for (const [path, why] of flags) kept.set(path, { why, hash: ledger.hashes.get(path) ?? '' })
    sky.unasked.set(root, kept)
    return true
  } catch {
    // the check is advice: when it cannot run, the map stays as it was
    return false
  }
}

/** The repo's own `.isobar/map.json`, else the one kept from an earlier session; new files placed by their imports. */
async function keptMap($: Dollar, root: string, facts: Facts): Promise<Basemap | null> {
  const graph = graphOf(facts.edges)
  const keep = (map: Basemap): Basemap => ({ ...map, regions: completeRegions(map.regions, map.layers, facts, graph, true) })
  const shared = await readJson($, `${root}/.isobar/map.json`)

  if (isBasemap(shared)) return keep({ ...shared, source: 'repo-file' })
  const kept = await $.store.get(`map:${root}`)

  return isBasemap(kept) ? keep(kept) : null
}

/** The kept map, else a new one drawn once by the model (folders alone if it cannot answer). */
async function mapFor($: Dollar, root: string, facts: Facts, mapModel: string, rebuild: boolean): Promise<Basemap> {
  if (!rebuild) {
    const kept = await keptMap($, root, facts)

    if (kept !== null) return kept
  }

  sky.status = 'Drawing the map of this codebase. This happens once per repository.'
  await update($, tick, n => (n ?? 0) + 1)
  const units = unitsOf(facts)
  // the map is named by the model the session runs on, unless the mapModel setting names another
  const model = mapModel !== '' ? mapModel : await $.session.model().catch(() => 'opus')
  const reply = await $.model.complete({ model, prompt: basemapPrompt(sky.repo, units), maxTokens: 8000, timeoutMs: 240_000 })
  const named = reply.isAnswered ? parseBasemapReply(reply.text, units) : null
  const map = finishBasemap(sky.repo, facts, named ?? heuristicRegions(units), named === null ? 'heuristic' : 'model', new Date(await $.clock.now()).toISOString())

  await $.store.set(`map:${root}`, map)
  return map
}

async function readJson($: Dollar, path: string): Promise<unknown> {
  try {
    return (await $.fs.exists(path)) ? JSON.parse(await $.fs.read(path)) : null
  } catch {
    return null
  }
}

function isBasemap(x: unknown): x is Basemap {
  const m = x as Basemap | null

  return m !== null && typeof m === 'object' && m.version === 1 && Array.isArray(m.regions) && Array.isArray(m.layers) && m.regions.length > 0
}

