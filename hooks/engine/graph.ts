import type { Edge } from './types'

export type Graph = {
  /** file → the files it imports */
  out: Map<string, string[]>
  /** file → the files that import it */
  in: Map<string, string[]>
}

export function graphOf(edges: readonly Edge[]): Graph {
  const out = new Map<string, string[]>()
  const into = new Map<string, string[]>()
  const push = (m: Map<string, string[]>, k: string, v: string) => {
    const list = m.get(k)

    if (list === undefined) m.set(k, [v])
    else list.push(v)
  }

  for (const { from, to } of edges) {
    push(out, from, to)
    push(into, to, from)
  }
  for (const list of [...out.values(), ...into.values()]) list.sort()

  return { out, in: into }
}

const TEST_PATH = /(^|\/)(test|tests|__tests__|spec|specs)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]+\.py$|_test\.py$/

export const isTest = (path: string): boolean => TEST_PATH.test(path)

/** One file the change reaches: `hop` imports away, through `via` (the file it imports). */
export type Reach = { path: string; hop: number; via: string }

/** Breadth-first over importers from the changed files, up to `maxHops`, nearest hop first. */
export function reachOf(graph: Graph, changed: readonly string[], maxHops = 3): Reach[] {
  const seen = new Set(changed)
  const out: Reach[] = []
  let frontier = [...changed].sort()

  for (let hop = 1; hop <= maxHops && frontier.length > 0; hop++) {
    const next: string[] = []

    for (const file of frontier) {
      for (const importer of graph.in.get(file) ?? []) {
        if (seen.has(importer)) continue
        seen.add(importer)
        out.push({ path: importer, hop, via: file })
        next.push(importer)
      }
    }
    frontier = next.sort()
  }

  return out
}

/** How many files depend on `path`, at any distance. */
export function dependentsOf(graph: Graph, path: string, cap = 10_000): number {
  return reachOf(graph, [path], cap).length
}

/** The chain of files from a reached file back to the changed file it came from. */
export function chainOf(reach: readonly Reach[], path: string): string[] {
  const by = new Map(reach.map(r => [r.path, r]))
  const chain = [path]
  let at = by.get(path)

  while (at !== undefined && chain.length < 12) {
    chain.push(at.via)
    at = by.get(at.via)
  }

  return chain.reverse()
}

/** A file history says changes with this change, left out of it: `lift` times as often as it changes at all. */
export type Expected = { path: string; with: string; together: number; of: number; lift: number }

/**
 * Absence of expected change: files that changed in at least `minShare` of the commits
 * touching a changed file (and at least `minTogether` times) but sit outside this change.
 * `minLift` keeps only files that change with it at least that many times more often than
 * they change overall, so a file that changes in every commit (a changelog, a lockfile, the
 * app's root) never rings.
 */
export function expectedOf(
  commits: readonly string[][],
  changed: readonly string[],
  exists: (path: string) => boolean,
  minShare = 0.5,
  minTogether = 3,
  minLift = 1,
): Expected[] {
  const inChange = new Set(changed)
  const best = new Map<string, Expected>()
  const everywhere = new Map<string, number>()

  for (const commit of commits) for (const file of commit) everywhere.set(file, (everywhere.get(file) ?? 0) + 1)
  for (const file of changed) {
    const touching = commits.filter(c => c.includes(file))

    if (touching.length < minTogether) continue
    const counts = new Map<string, number>()

    for (const commit of touching) for (const other of commit) if (other !== file) counts.set(other, (counts.get(other) ?? 0) + 1)
    for (const [other, together] of counts) {
      const lift = together / touching.length / ((everywhere.get(other) ?? together) / commits.length)

      if (inChange.has(other) || together < minTogether || together / touching.length < minShare || lift < minLift || !exists(other)) continue
      const prior = best.get(other)

      if (prior === undefined || together / touching.length > prior.together / prior.of) {
        best.set(other, { path: other, with: file, together, of: touching.length, lift })
      }
    }
  }

  return [...best.values()].sort((a, b) => b.together / b.of - a.together / a.of || b.lift - a.lift || a.path.localeCompare(b.path))
}
