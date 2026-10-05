/**
 * Draws the pane outside Claude Code, for fast iteration: the same engine and sheet the
 * mod runs, with Node's child_process standing in for `$.process.spawn`, rendered to PNG.
 *
 *   tsx scripts/preview.ts --repo ../vite --cols 96 --rows 56 [--commit <sha>] [--build model|heuristic]
 *     [--map out/map.json] [--layers code,impact,risk,history] [--ground paper|night] [--colors truecolor|256] [--out out/preview]
 *     [--read off] [--earlier a.py,b.py] [--unasked path=why,path=why] [--gist model|region=what,region=what] [--small sonnet]
 *     [--scope model --ask "<the request>"] [--created new.py,other.py]
 *
 * `--read off` draws reach file-wide, as v0.1 did; `--earlier` draws those files as an earlier
 * turn's edits; `--unasked` flags files as the scope check would; `--gist model` asks the small
 * model for each changed region's caption, as the mod does, and `--gist region=what` sets them;
 * `--scope model` runs the scope check on the small model against `--ask`, as the mod does after a turn;
 * `--created` names untracked files the session wrote, which the mod counts as part of the change.
 *
 * The map is read as the mod reads it: the repository's own `.isobar/map.json` when there is one,
 * else `--map` or `out/<repo>-map.json`, else drawn with `claude -p --model opus` and kept there.
 * `--build model` draws it again, `--build heuristic` makes a folder map with no model call; a new
 * build is written only to `--map` or `out/<repo>-map.json`, never into the repository.
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'

import { basemapPrompt, completeRegions, finishBasemap, heuristicRegions, parseBasemapReply, sanitizeBasemap, unitsOf } from '../hooks/engine/basemap'
import { gistLines, gistPrompt, parseGistReply } from '../hooks/engine/gist'
import { excerptOf, parseScopeReply, scopePrompt } from '../hooks/engine/scope'
import { currentChange, gatherFacts, parseNumstat, refsOf, repoRoot } from '../hooks/engine/git'
import { graphOf } from '../hooks/engine/graph'
import type { Basemap, Run } from '../hooks/engine/types'
import { readChange } from '../hooks/engine/symbols'
import { weatherOf } from '../hooks/engine/weather'
import { DEFAULT_LAYERS, type Layers } from '../hooks/render/field'
import { shown256 } from '../hooks/render/palette'
import { sheetOf } from '../hooks/render/sheet'

const args = new Map<string, string>()

for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ''), process.argv[i + 1] ?? '')

/** The layers by the names the sheet keys them: the pane calls them change, reach, risk and history. */
const LAYER_NAMES = ['code', 'impact', 'risk', 'history']
const unknownLayers = (args.get('layers') ?? '').split(',').filter(k => k !== '' && !LAYER_NAMES.includes(k))

if (unknownLayers.length > 0) {
  console.error(`--layers takes ${LAYER_NAMES.join(', ')} (the pane's change, reach, risk and history), not ${unknownLayers.join(', ')}`)
  process.exit(1)
}

const run: Run = argv =>
  new Promise(done => {
    execFile(argv[0]!, argv.slice(1), { maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => done({ exitCode: err ? ((err as { code?: number }).code ?? 1) : 0, stdout: String(stdout) }))
  })

const ask = (prompt: string, model = args.get('model') ?? 'opus'): Promise<string> =>
  new Promise(done => {
    const child = execFile('claude', ['-p', '--model', model], { maxBuffer: 16 * 1024 * 1024, timeout: 240_000 }, (_e, out) => done(String(out)))

    child.stdin?.end(prompt)
  })

const repo = resolve((args.get('repo') ?? '.').replace(/^~/, process.env.HOME ?? ''))
const root = (await repoRoot(run, repo)) ?? repo
const cols = Number(args.get('cols') ?? 96)
const rows = Number(args.get('rows') ?? 56)
const out = resolve(args.get('out') ?? 'out/preview')
const mapPath = resolve(args.get('map') ?? `out/${basename(root)}-map.json`)

mkdirSync(dirname(out), { recursive: true })
mkdirSync(dirname(mapPath), { recursive: true })

const t0 = Date.now()
const facts = await gatherFacts(run, root)
const t1 = Date.now()
const sharedPath = resolve(root, '.isobar', 'map.json')
const shared = !args.has('map') && !args.has('build') && existsSync(sharedPath) ? sanitizeBasemap(readJson(sharedPath)) : null
let map: Basemap

if (shared === null && existsSync(sharedPath) && !args.has('map') && !args.has('build')) console.error(`${sharedPath} is not a valid map; drawing without it`)
if (shared !== null) map = { ...shared, source: 'repo-file', regions: completeRegions(shared.regions, shared.layers, facts, graphOf(facts.edges), true) }
else if (existsSync(mapPath) && !args.has('build')) map = JSON.parse(readFileSync(mapPath, 'utf8')) as Basemap
else {
  const units = unitsOf(facts)
  const isHeuristic = args.get('build') === 'heuristic'
  const named = isHeuristic ? heuristicRegions(units) : parseBasemapReply(await ask(basemapPrompt(basename(root), units)), units)

  // a model that gave no usable answer writes nothing, so a folders-only map is never committed by mistake
  if (named === null) {
    console.error('the model gave no usable map (is `claude -p` signed in?); nothing written. `--build heuristic` draws folders without it')
    process.exit(1)
  }
  map = finishBasemap(basename(root), facts, named, isHeuristic ? 'heuristic' : 'model', new Date().toISOString())
  writeFileSync(mapPath, JSON.stringify(map, null, 2))
}

const commit = args.get('commit')
const head = await refsOf(run, root)
const change = commit
  ? await (async () => {
      const r = await run(['git', '-C', root, 'show', '--numstat', '-z', '--format=%h %s', commit])

      return { base: { kind: 'commit' as const, label: r.stdout.split(/[\0\n]/)[0] ?? '' }, changes: parseNumstat(r.stdout) }
    })()
  : await currentChange(run, root, (args.get('created') ?? '').split(',').filter(Boolean), { refs: head })
const refs = commit ? { from: `${commit}~1`, to: commit } : change.base.kind === 'uncommitted' ? { from: head.head } : { from: head.parent, to: head.head }
const read = args.get('read') === 'off' ? undefined : await readChange(run, root, facts, change.changes, refs)
const earlier = new Set((args.get('earlier') ?? '').split(',').filter(Boolean))
const turns = args.has('earlier') ? new Map(change.changes.map(c => [c.path, earlier.has(c.path) ? 1 : 2])) : undefined
const unasked = args.has('unasked') ? new Map((args.get('unasked') ?? '').split(',').map(kv => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)] as [string, string])) : undefined
const session: { turns?: Map<string, number>; unasked?: Map<string, string>; gists?: Map<string, string> } = { ...(turns === undefined ? {} : { turns }), ...(unasked === undefined ? {} : { unasked }) }
let weather = weatherOf(map, facts, change.base, change.changes, read, session)
const range = [refs.from, ...(refs.to === undefined ? [] : [refs.to])]
const small = args.get('small') ?? 'sonnet'

if (args.get('scope') === 'model') {
  const cells = weather.cells.filter(c => c.isLatest)
  const excerpts = await excerptOf(run, root, cells.filter(c => !c.isNew).map(c => c.path), range, undefined, cells.filter(c => c.isNew).map(c => c.path))
  const flags = parseScopeReply(await ask(scopePrompt([args.get('ask') ?? ''].filter(Boolean), cells, excerpts), small), new Set(cells.map(c => c.path)))

  console.log(JSON.stringify({ unasked: [...(flags ?? [])] }))
  if (flags !== null) session.unasked = flags
  weather = weatherOf(map, facts, change.base, change.changes, read, session)
}
const gist = args.get('gist')

if (gist !== undefined) {
  const cells = weather.cells
  const gists =
    gist === 'model'
      ? parseGistReply(
          await ask(gistPrompt(map, cells, await excerptOf(run, root, cells.filter(c => !c.isNew).map(c => c.path), range, gistLines(cells.length), cells.filter(c => c.isNew).map(c => c.path))), small),
          new Set(cells.map(c => c.region)),
        )
      : new Map(gist.split(',').map(kv => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)] as [string, string]))

  console.log(JSON.stringify({ gists: [...(gists ?? [])] }))
  if (gists !== null) session.gists = gists
  weather = weatherOf(map, facts, change.base, change.changes, read, session)
}
const t2 = Date.now()
const layers: Layers = args.has('layers')
  ? { code: false, impact: false, risk: false, history: false, ...Object.fromEntries((args.get('layers') ?? '').split(',').map(k => [k, true])) }
  : DEFAULT_LAYERS
const colors = args.get('colors') === '256' ? '256' : 'truecolor'
const grid = sheetOf({ repo: basename(root), map, files: [...facts.lines.keys()], lines: facts.lines, weather, layers, ground: args.get('ground') === 'night' ? 'night' : 'paper', colors }, cols, rows)
const t3 = Date.now()

// a 256-colour preview shows what that terminal paints, off the 4-bit grid
const shown = colors === '256' ? { ...grid, cells: grid.cells.map(c => ({ ...c, fg: shown256(c.fg), bg: shown256(c.bg) })) } : grid

writeFileSync(`${out}.json`, JSON.stringify(shown))
console.log(JSON.stringify({ facts: t1 - t0, weather: t2 - t1, sheet: t3 - t2, files: facts.lines.size, edges: facts.edges.length, regions: map.regions.length, source: map.source, pairs: new Set(grid.cells.map(c => `${c.fg},${c.bg}`)).size, headline: weather.headline, lines: weather.lines, expected: weather.expected.slice(0, 4), offshoots: weather.offshoots.slice(0, 3).map(o => o.chain.join(' > ')), cells: weather.cells.map(c => `${c.path} ${c.kind} users=${c.users} uses=${c.uses} dependents=${c.dependents}`), reach: weather.reach.length }, null, 2))
execFile('python3', [resolve(import.meta.dirname, 'render.py'), `${out}.json`, `${out}.png`, colors === '256' ? '0' : '1'], (e, so, se) => {
  console.log(e ? se : so.trim())
  // no PNG is a failed preview (render.py needs Python 3 and Pillow)
  if (e) process.exitCode = 1
})

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}
