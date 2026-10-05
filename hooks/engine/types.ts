/** What a host command answers, its output whole: the engine's `$.process.spawn`, or Node's in the preview script. */
export type RunResult = { exitCode: number; stdout: string }

/** Runs a command by argv with no shell. */
export type Run = (argv: readonly string[]) => Promise<RunResult>

/** One import: `from` imports `to`, both repo-relative paths. */
export type Edge = { from: string; to: string }

/** A layer band of the basemap, top to bottom. */
export type Layer = { id: string; name: string; blurb: string }

/** One capability cell of the basemap. */
export type Region = {
  id: string
  name: string
  blurb: string
  layer: string
  /** Path prefixes ("src/curator/") or exact files ("src/app.ts"); longest match wins. */
  paths: string[]
  /** Static consequence weight, 1 to 10: the cell's area. */
  weight: number
}

/**
 * The fixed map of the codebase. Built once and kept; only `/isobar map` rebuilds it,
 * so its shape becomes muscle memory.
 */
export type Basemap = {
  version: 1
  repo: string
  head: string
  builtAt: string
  source: 'model' | 'heuristic' | 'repo-file'
  layers: Layer[]
  regions: Region[]
}

/** One changed file. */
export type Change = {
  path: string
  added: number
  deleted: number
  isNew: boolean
  isDeleted: boolean
}

/** What the weather is measured against: the uncommitted edits, the last commit, or nothing in a repository with no commits yet. */
export type Base = { kind: 'uncommitted' | 'commit' | 'none'; label: string }

/** The repository facts a basemap and the weather are computed from. */
export type Facts = {
  root: string
  head: string
  /** Tracked text files and their line counts. */
  lines: Map<string, number>
  edges: Edge[]
  /** Recent commits, each the files it touched (bulk commits dropped). */
  commits: string[][]
}
