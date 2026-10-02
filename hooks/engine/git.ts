import { edgesOf, IMPORTABLE, joinedPython, jsRulesOf, type Row } from './imports'
import type { Base, Change, Facts, Run } from './types'

const JS_PATHSPEC = ['*.ts', '*.tsx', '*.js', '*.jsx', '*.mjs', '*.cjs', '*.mts', '*.cts', '*.vue', '*.svelte']
const JS_PATTERN = `from[[:space:]]*['"]|require\\([[:space:]]*['"]|import[[:space:]]*\\(?[[:space:]]*['"]`
const PY_PATTERN = '^[[:space:]]*(from[[:space:]]+[.A-Za-z_]|import[[:space:]]+[A-Za-z_])'
/** A line that may continue a Python import over several lines: names, each maybe `as` another, ending in `,` or `)`. */
const PY_NAMES = '^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*([[:space:]]+as[[:space:]]+[A-Za-z_][A-Za-z0-9_]*)?([[:space:]]*,[[:space:]]*[A-Za-z_][A-Za-z0-9_]*([[:space:]]+as[[:space:]]+[A-Za-z_][A-Za-z0-9_]*)?)*[[:space:]]*,?[[:space:]]*[,)][[:space:]]*(#.*)?$'
/** The files a bare JS/TS specifier resolves through, filtered by name in `jsRulesOf`. */
const CONFIG_PATHSPEC = ['*tsconfig*.json', '*jsconfig*.json', '*package.json', '*pnpm-workspace.yaml']
/** Git's id for an empty file, in SHA-1 and in SHA-256 repositories. */
const EMPTY_BLOB = new Set(['e69de29bb2d1d6434b8b29ae775ad8c2e48c5391', '473a0f4c3be8a93681a267e3b1e9a7dcda1185436fe141f7749120a303721813'])

/** Commits touching more files than this are bulk moves and say nothing about coupling. */
export const BULK_COMMIT = 40

const git = (run: Run, root: string, ...args: string[]) => run(['git', '-C', root, ...args])

export async function repoRoot(run: Run, cwd: string): Promise<string | null> {
  const r = await run(['git', '-C', cwd, 'rev-parse', '--show-toplevel'])

  return r.exitCode === 0 ? r.stdout.trim() : null
}

/** `path\0count\n` rows of `git grep -z -c`. */
export function parseCounts(stdout: string): Map<string, number> {
  const out = new Map<string, number>()

  for (const row of stdout.split('\n')) {
    const at = row.indexOf('\0')

    if (at > 0) out.set(row.slice(0, at), Number(row.slice(at + 1)) || 0)
  }

  return out
}

/** `path\0line\0text\n` rows of `git grep -z -n`. */
export function parseHits(stdout: string): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = []

  for (const row of stdout.split('\n')) {
    const a = row.indexOf('\0')
    const b = a < 0 ? -1 : row.indexOf('\0', a + 1)

    if (b > 0) out.push({ path: row.slice(0, a), text: row.slice(b + 1) })
  }

  return out
}

/** Commits separated by \x1e, one file per line; bulk commits dropped. */
export function parseLog(stdout: string): string[][] {
  return stdout
    .split('\x1e')
    .map(block => block.split('\n').map(s => s.trim()).filter(Boolean))
    .filter(files => files.length > 0 && files.length <= BULK_COMMIT)
}

/** `path\0line\0text\n` rows of `git grep -z -n`, line numbers kept. */
export function parseRows(stdout: string): Row[] {
  const out: Row[] = []

  for (const row of stdout.split('\n')) {
    const a = row.indexOf('\0')
    const b = a < 0 ? -1 : row.indexOf('\0', a + 1)

    if (b > 0) out.push({ path: row.slice(0, a), line: Number(row.slice(a + 1, b)), text: row.slice(b + 1) })
  }
  return out
}

/** Empty tracked files an import can name, from `git ls-files -z -s` rows; `git grep -c` never lists them. */
export function parseEmpty(stdout: string): string[] {
  const out: string[] = []

  for (const row of stdout.split('\0')) {
    const m = /^\d+ ([0-9a-f]+) \d\t(.+)$/s.exec(row)

    if (m !== null && EMPTY_BLOB.has(m[1] ?? '') && IMPORTABLE.some(e => m[2]?.endsWith(e))) out.push(m[2] ?? '')
  }
  return out
}

/**
 * Every import line of the repo, a Python import over several lines joined into its first,
 * and the text of each tracked tsconfig, jsconfig, package.json and pnpm-workspace.yaml, in three git calls.
 */
export async function importSources(run: Run, root: string): Promise<{ hits: Row[]; configs: Map<string, string> }> {
  const [js, py, configs] = await Promise.all([
    git(run, root, 'grep', '-z', '-n', '-I', '-E', '-e', JS_PATTERN, '--', ...JS_PATHSPEC),
    git(run, root, 'grep', '-z', '-n', '-I', '-E', '-e', `${PY_PATTERN}|${PY_NAMES}`, '--', '*.py'),
    git(run, root, 'grep', '-z', '-I', '-e', '', '--', ...CONFIG_PATHSPEC),
  ])
  const texts = new Map<string, string[]>()

  for (const row of configs.stdout.split('\n')) {
    const at = row.indexOf('\0')

    if (at < 1) continue
    const path = row.slice(0, at)
    const lines = texts.get(path) ?? []

    lines.push(row.slice(at + 1))
    texts.set(path, lines)
  }
  return {
    hits: [...parseRows(js.stdout), ...joinedPython(parseRows(py.stdout))],
    configs: new Map([...texts].map(([path, lines]) => [path, lines.join('\n')])),
  }
}

/** Every fact the basemap and the weather read, in seven git calls. */
export async function gatherFacts(run: Run, root: string, commits = 400): Promise<Facts> {
  const [head, counts, index, sources, log] = await Promise.all([
    git(run, root, 'rev-parse', 'HEAD'),
    git(run, root, 'grep', '-z', '-c', '-I', '-e', ''),
    git(run, root, 'ls-files', '-z', '-s'),
    importSources(run, root),
    git(run, root, 'log', '-n', String(commits), '--no-merges', '--name-only', '--format=%x1e'),
  ])
  const counted = parseCounts(counts.stdout)
  const empty = parseEmpty(index.stdout).filter(p => !counted.has(p))
  // kept in git's path order, as `git grep` lists them
  const lines = empty.length === 0 ? counted : new Map([...counted, ...empty.map(p => [p, 0] as const)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  const files = new Set(lines.keys())
  const edges = edgesOf(sources.hits, files, jsRulesOf(sources.configs))

  return { root, head: head.stdout.trim(), lines, edges, commits: parseLog(log.stdout) }
}

/** `git diff --numstat -z` rows: `a\td\tpath\0`, or `a\td\t\0old\0new\0` for a rename. */
export function parseNumstat(stdout: string): Change[] {
  const parts = stdout.split('\0')
  const out: Change[] = []

  for (let i = 0; i < parts.length; i++) {
    const m = /^\n*(-|\d+)\t(-|\d+)\t(.*)$/.exec(parts[i] ?? '')

    if (m === null) continue
    let path = m[3] ?? ''

    if (path === '') {
      path = parts[i + 2] ?? ''
      i += 2
    }
    if (path !== '') out.push({ path, added: Number(m[1]) || 0, deleted: Number(m[2]) || 0, isNew: false, isDeleted: false })
  }

  return out
}

/**
 * The change the weather shows: uncommitted edits to tracked files plus the untracked
 * files named in `created` (what this session wrote). With none, the last commit.
 */
export async function currentChange(run: Run, root: string, created: readonly string[] = []): Promise<{ base: Base; changes: Change[] }> {
  const [diff, deleted, untracked] = await Promise.all([
    git(run, root, 'diff', '--numstat', '-z', 'HEAD'),
    git(run, root, 'diff', '--name-only', '-z', '--diff-filter=D', 'HEAD'),
    git(run, root, 'ls-files', '-z', '--others', '--exclude-standard'),
  ])
  const gone = new Set(deleted.stdout.split('\0').filter(Boolean))
  const changes = parseNumstat(diff.stdout).map(c => ({ ...c, isDeleted: gone.has(c.path) }))
  const wanted = new Set(created)
  const fresh = untracked.stdout.split('\0').filter(p => p !== '' && wanted.has(p))

  if (fresh.length > 0) {
    const counted = parseCounts((await git(run, root, 'grep', '-z', '-c', '-I', '--untracked', '-e', '', '--', ...fresh)).stdout)

    for (const path of fresh) changes.push({ path, added: counted.get(path) ?? 0, deleted: 0, isNew: true, isDeleted: false })
  }
  if (changes.length > 0) return { base: { kind: 'uncommitted', label: 'uncommitted' }, changes }

  const last = await git(run, root, 'show', '--numstat', '-z', '--format=%h %s', 'HEAD')
  const subject = last.stdout.split(/[\0\n]/)[0] ?? ''

  return { base: { kind: 'commit', label: subject.trim() }, changes: parseNumstat(last.stdout) }
}
