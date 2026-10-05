/**
 * Shared setup for the benchmarks: where isobar and the cloned repos live, isobar's own
 * modules, and a `run` that stands in for the mod's git reads through `$.process.spawn`.
 */
import { execFile } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** isobar's root, relative to this folder. Inside isobar's own repo it is '..'. */
export const ISOBAR = '..'

const here = dirname(fileURLToPath(import.meta.url))
const from = (path: string) => resolve(here, ISOBAR, path)
const load = (path: string) => import(pathToFileURL(from(path)).href)

export const git = await load('hooks/engine/git.ts')
export const imports = await load('hooks/engine/imports.ts')
export const graph = await load('hooks/engine/graph.ts')
export const basemap = await load('hooks/engine/basemap.ts')
export const weather = await load('hooks/engine/weather.ts')
export const symbols = await load('hooks/engine/symbols.ts')
export const field = await load('hooks/render/field.ts')
export const sheet = await load('hooks/render/sheet.ts')
export const layout = await load('hooks/render/layout.ts')
/** The TypeScript compiler isobar already depends on. */
export const ts = createRequire(from('package.json'))('typescript')

/**
 * Clones go in `$BENCH_DIR/repos`, results in `$BENCH_DIR/results`. The default sits in the
 * contributor's own cache, made private, since the bench runs the Python it finds there.
 */
export const BENCH = process.env.BENCH_DIR ?? resolve(process.env.XDG_CACHE_HOME ?? resolve(homedir(), '.cache'), 'isobar-bench')
export const RESULTS = resolve(BENCH, 'results')

mkdirSync(BENCH, { recursive: true, mode: 0o700 })

export type Repo = { name: string; url: string; sha: string; lang: 'js' | 'py'; package?: string; path?: string }

export const repos: Repo[] = JSON.parse(readFileSync(resolve(here, 'repos.json'), 'utf8'))
export const rootOf = (repo: Repo) => resolve(BENCH, 'repos', repo.name)

/** `--only a,b` picks repos by name. */
export function picked(): Repo[] {
  const at = process.argv.indexOf('--only')
  const names = at < 0 ? null : new Set((process.argv[at + 1] ?? '').split(','))

  return repos.filter(r => names === null || names.has(r.name))
}

export type Run = (argv: readonly string[]) => Promise<{ exitCode: number; stdout: string }>

export const run: Run = argv =>
  new Promise(done => {
    execFile(argv[0]!, argv.slice(1), { maxBuffer: 256 << 20 }, (err, stdout) =>
      done({ exitCode: err ? ((err as { code?: number }).code ?? 1) : 0, stdout: String(stdout) }))
  })

export const round = (x: number, places = 1) => Math.round(x * 10 ** places) / 10 ** places

export function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1

  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

/** One warm-up call, then the median of `runs` timed calls, in milliseconds. */
export async function timed<T>(fn: () => T | Promise<T>, runs = 5): Promise<{ ms: number; runs: number[]; value: T }> {
  let value = await fn()
  const times: number[] = []

  for (let i = 0; i < runs; i++) {
    const t = performance.now()

    value = await fn()
    times.push(performance.now() - t)
  }
  return { ms: round(median(times)), runs: times.map(t => round(t)), value }
}

/** Writes `results/<name>.json`. */
export function save(name: string, data: unknown) {
  mkdirSync(RESULTS, { recursive: true })
  writeFileSync(resolve(RESULTS, `${name}.json`), JSON.stringify(data, null, 2) + '\n')
}
