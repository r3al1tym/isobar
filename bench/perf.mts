/**
 * Speed, per repo: gatherFacts, readChange (the HEAD commit read declaration by declaration,
 * and its users found), weatherOf for it over a heuristic basemap, and sheetOf at 96×56, each
 * the median of 5 runs after a warm-up. With `--model`, also
 * one model-drawn basemap end to end for vite and django, asked the way preview.ts asks.
 *
 *   tsx bench/perf.mts [--only vite,django] [--model]
 */
import { execFile } from 'node:child_process'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { cpus, loadavg, release, tmpdir, totalmem } from 'node:os'
import { resolve } from 'node:path'
import { basemap, field, git, picked, RESULTS, rootOf, round, run, save, sheet, symbols, timed, weather } from './isobar.mts'

const MODEL_MAPS = new Set(['vite', 'django'])
const withModel = process.argv.includes('--model')

/** `claude -p` fed the prompt on stdin, as preview.ts's `ask`; the mod itself gives up at 240 s. */
const ask = (prompt: string): Promise<string> =>
  new Promise(done => {
    const child = execFile('claude', ['-p', '--model', 'opus'], { cwd: tmpdir(), maxBuffer: 16 << 20, timeout: 600_000 }, (_e, out) => done(String(out)))

    child.stdin?.end(prompt)
  })

async function machine() {
  const os = readFileSync('/etc/os-release', 'utf8').match(/^PRETTY_NAME="?([^"\n]*)/m)?.[1] ?? ''
  const v = async (argv: string[]) => (await run(argv)).stdout.trim()

  return {
    cpu: cpus()[0]?.model ?? '',
    cores: cpus().length,
    memoryGb: round(totalmem() / 2 ** 30, 0),
    os: `${os}, Linux ${release()}`,
    node: process.version,
    git: await v(['git', '--version']),
    claude: await v(['claude', '--version']),
    /** 1-minute load average when the timings started: other work on the machine shows up here */
    loadAverage: round(startLoad, 2),
  }
}

const startLoad = loadavg()[0] ?? 0
const rows = []
/** What `claude -p` costs before any basemap work: three one-word replies. */
const baseline = withModel ? await timed(async () => {
  await ask('Reply with the word ok.')
}, 3) : null

for (const repo of picked()) {
  const root = rootOf(repo)
  const paths = (await run(['git', '-C', root, 'ls-files', '-z'])).stdout.split('\0').filter(Boolean)
  // `git grep -c` lists only files with a line in them, so empty files never reach the map
  const empty = paths.filter(p => statSync(resolve(root, p), { throwIfNoEntry: false })?.size === 0).length
  const facts = await timed(() => git.gatherFacts(run, root))
  const f = facts.value
  const units = basemap.unitsOf(f)
  const heuristic = await timed(() => basemap.finishBasemap(repo.name, f, basemap.heuristicRegions(basemap.unitsOf(f)), 'heuristic', 'bench'))
  const map = heuristic.value
  const shown = await run(['git', '-C', root, 'show', '--numstat', '-z', '--format=%h %s', 'HEAD'])
  const base = { kind: 'commit', label: shown.stdout.split(/[\0\n]/)[0] ?? '' }
  const changes = git.parseNumstat(shown.stdout)
  const read = await timed(() => symbols.readChange(run, root, f, changes, { from: 'HEAD~1', to: 'HEAD' }))
  const w = await timed(() => weather.weatherOf(map, f, base, changes, read.value))
  const input = { repo: repo.name, map, files: [...f.lines.keys()], lines: f.lines, weather: w.value, layers: field.ALL_LAYERS, ground: 'paper', colors: 'truecolor' }
  const s = await timed(() => sheet.sheetOf(input, 96, 56))
  let model = null

  if (withModel && MODEL_MAPS.has(repo.name)) {
    const prompt = basemap.basemapPrompt(repo.name, units)
    const t = performance.now()
    const reply = await ask(prompt)
    const named = basemap.parseBasemapReply(reply, units)
    const done = named === null ? null : basemap.finishBasemap(repo.name, f, named, 'model', 'bench')
    const seconds = round((performance.now() - t) / 1000)

    writeFileSync(resolve(RESULTS, `model-map-${repo.name}.txt`), reply)
    model = { seconds, accepted: named !== null, regions: done?.regions.length ?? 0, layers: done?.layers.length ?? 0, units: units.length, promptChars: prompt.length, replyChars: reply.length }
  }

  const row = {
    repo: repo.name,
    trackedFiles: paths.length,
    textFiles: f.lines.size,
    emptyFiles: empty,
    edges: f.edges.length,
    commits: f.commits.length,
    headChange: { label: base.label, files: changes.length },
    factsMs: facts.ms,
    heuristicMapMs: heuristic.ms,
    readMs: read.ms,
    weatherMs: w.ms,
    sheetMs: s.ms,
    runs: { facts: facts.runs, heuristicMap: heuristic.runs, read: read.runs, weather: w.runs, sheet: s.runs },
    model,
  }

  console.log(JSON.stringify({ ...row, runs: undefined }))
  rows.push(row)
}

save(withModel ? 'perf-model' : 'perf', { machine: await machine(), cliBaselineSeconds: baseline && round(baseline.ms / 1000), rows })
