import type { Change, Run } from './types'

/** What the session has seen of one repository: each changed file's last content, and the turn that wrote it. */
export type Ledger = { hashes: Map<string, string>; turns: Map<string, number> }

/** The hash of a changed path git cannot hash: a submodule, a symlink to a folder or to nothing, a file gone since the diff. */
export const UNHASHABLE = 'unhashable'

/**
 * Each changed file's content hash, read-only (`git hash-object` without `-w`); a deleted file
 * hashes as `deleted`, and a path git cannot hash as UNHASHABLE.
 */
export async function hashesOf(run: Run, root: string, changes: readonly Change[]): Promise<Map<string, string>> {
  const present = changes.filter(c => !c.isDeleted).map(c => c.path)
  const out = new Map(changes.filter(c => c.isDeleted).map(c => [c.path, 'deleted']))
  const hash = (paths: readonly string[]) => run(['git', '-C', root, 'hash-object', '--', ...paths])

  if (present.length === 0) return out
  const r = await hash(present)
  const hashes = r.stdout.split('\n').filter(Boolean)

  // one hash a line, in order
  if (r.exitCode === 0 && hashes.length === present.length) {
    present.forEach((p, i) => out.set(p, hashes[i]!))
    return out
  }
  // one path git cannot hash fails the whole call: hashed one by one, it costs only its own hash
  for (let i = 0; i < present.length; i += 8) {
    const batch = present.slice(i, i + 8)
    const each = await Promise.all(batch.map(p => hash([p])))

    batch.forEach((p, k) => {
      const h = each[k]!.stdout.trim()

      out.set(p, each[k]!.exitCode === 0 && h !== '' ? h : UNHASHABLE)
    })
  }
  return out
}

/**
 * Brings the ledger up to the change: a file whose content moved since the ledger last saw it was
 * written in `turn`; a file seen for the first time was written before the session (turn 0)
 * unless this session's own edits named it (a repository first seen with a clean tree starts an
 * empty ledger, so nothing in it predates the session). Files no longer changed leave the ledger.
 */
export function attribute(ledger: Ledger | undefined, hashes: ReadonlyMap<string, string>, turn: number, edited: ReadonlySet<string>): Ledger {
  const next: Ledger = { hashes: new Map(), turns: new Map() }

  for (const [path, hash] of hashes) {
    const seen = ledger?.hashes.get(path)
    const prior = ledger?.turns.get(path)
    const written = seen === hash && prior !== undefined ? prior : ledger === undefined && !edited.has(path) ? 0 : turn

    next.hashes.set(path, hash)
    next.turns.set(path, written)
  }
  return next
}
