import type { Facts } from '../hooks/engine/types'

/** A small repo: util ← core ← app ← far ← tool, a test on core, and history tying util to that test (lift 4). */
export const FACTS: Facts = {
  root: '/work',
  head: 'abc1234',
  lines: new Map([
    ['src/app.ts', 40],
    ['src/core.ts', 120],
    ['src/util.ts', 30],
    ['src/far.ts', 20],
    ['scripts/tool.ts', 15],
    ['test/core.test.ts', 25],
    ['docs/readme.md', 10],
  ]),
  edges: [
    { from: 'src/app.ts', to: 'src/core.ts' },
    { from: 'src/core.ts', to: 'src/util.ts' },
    { from: 'src/far.ts', to: 'src/app.ts' },
    { from: 'scripts/tool.ts', to: 'src/far.ts' },
    { from: 'test/core.test.ts', to: 'src/core.ts' },
  ],
  commits: [
    ['src/util.ts', 'test/core.test.ts'],
    ['src/util.ts', 'test/core.test.ts', 'src/core.ts'],
    ['src/util.ts', 'test/core.test.ts'],
    ['src/util.ts'],
    ['src/app.ts', 'src/far.ts'],
    // unrelated work, so the test changes with util far more often than it changes at all
    ...Array.from({ length: 11 }, (_, i) => [i % 2 === 0 ? 'docs/readme.md' : 'scripts/tool.ts']),
  ],
}

export const MODEL_REPLY = JSON.stringify({
  layers: [
    { id: 'edge', name: 'Edge', blurb: 'where requests arrive' },
    { id: 'core', name: 'Core', blurb: 'the logic' },
    { id: 'support', name: 'Support', blurb: 'tests and tools' },
  ],
  regions: [
    { id: 'edge', name: 'Edge', blurb: 'entry points', layer: 'edge', paths: ['src/app.ts', 'src/far.ts'] },
    { id: 'core', name: 'Core', blurb: 'business rules', layer: 'core', paths: ['src/core.ts', 'src/util.ts'] },
    { id: 'checks', name: 'Checks', blurb: 'unit tests', layer: 'support', paths: ['test/'] },
    { id: 'tools', name: 'Tools', blurb: 'scripts and docs', layer: 'support', paths: ['scripts/', 'docs/'] },
  ],
})

/** util.ts before and after the fixture's edit: a body change to `util`, which core.ts calls. */
export const UTIL_BEFORE = ['export function util(a: number) {', '  return a + 1', '}']
export const UTIL_AFTER = ['export function util(a: number) {', '  return a + 2', '}']

/**
 * How the fixture repo answers: `read` gives the diff and the texts a declaration reader asks for,
 * `hash` util.ts's content, and `isClean` a tree with nothing uncommitted.
 */
export type Repo = { read?: boolean; hash?: string; isClean?: boolean; untracked?: string[] }

/** What git answers for the fixture repo, keyed by the subcommand and its first flags. */
export function gitAnswer(argv: readonly string[], repo: Repo = {}): string {
  // the engine's read-only flag before every git subcommand, and the log's unquoted paths, are no part of the key
  const args = argv.slice(3).join(' ').replace(/^-c diff\.autoRefreshIndex=false /, '').replace(/^-c core\.quotePath=false log/, 'log')
  const files = [...FACTS.lines]
  const rows = (lines: readonly string[], prefix = '') => lines.map((t, i) => `${prefix}src/util.ts\0${i + 1}\0${t}\n`).join('')

  // a second repository beside the fixture's, for edits that leave it
  if (args.startsWith('rev-parse --show-toplevel')) return argv[2]?.startsWith('/other') ? '/other\n' : '/work\n'
  if (args.startsWith('rev-parse HEAD')) return `${FACTS.head}\n`
  if (args.startsWith('grep -z -c -I -e')) return files.map(([p, n]) => `${p}\0${n}\n`).join('')
  if (args.startsWith('grep -z -n -I -E') && args.includes('*.py')) return ''
  if (args.startsWith('grep -z -n -I -E')) {
    const spec: Record<string, string> = {
      'src/app.ts': "import { core } from './core'",
      'src/core.ts': "import { util } from './util'",
      'src/far.ts': "import { app } from './app'",
      'scripts/tool.ts': "import { far } from '../src/far'",
      'test/core.test.ts': "import { core } from '../src/core'",
    }

    return Object.entries(spec).map(([p, t]) => `${p}\x001\x00${t}\n`).join('')
  }
  if (args.startsWith('log')) return FACTS.commits.map(c => `\x1e\n${c.join('\n')}\n`).join('')
  if (args.startsWith('diff --numstat -z --ignore-submodules=dirty HEAD')) return repo.isClean === true ? '' : '5\t1\tsrc/util.ts\0'
  if (args.startsWith('show --numstat -z')) return 'abc1234 last commit\0\n2\t0\tsrc/app.ts\0'
  if (args.startsWith('ls-files -z --others')) return (repo.untracked ?? []).map(p => `${p}\0`).join('')
  if (args.startsWith('hash-object')) return argv.slice(argv.indexOf('--') + 1).map(p => (p === 'src/util.ts' ? repo.hash ?? 'h1' : `h-${p}`)).join('\n') + '\n'
  if (repo.read !== true) return ''
  if (args.startsWith('-c core.quotePath=false diff -U0')) return 'diff --git a/src/util.ts b/src/util.ts\n--- a/src/util.ts\n+++ b/src/util.ts\n@@ -2 +2 @@\n-  return a + 1\n+  return a + 2\n'
  if (args.startsWith('-c core.quotePath=false diff -U1')) return 'diff --git a/src/util.ts b/src/util.ts\n--- a/src/util.ts\n+++ b/src/util.ts\n@@ -1,3 +1,3 @@\n export function util(a: number) {\n-  return a + 1\n+  return a + 2\n }\n'
  if (args.startsWith('grep -z -n -I -e  HEAD --')) return rows(UTIL_BEFORE, 'HEAD:')
  if (args.startsWith('grep -z -n -I -e  --')) return rows(UTIL_AFTER)
  if (args.startsWith('grep -z -n -w -I -F')) return "src/core.ts\x001\x00import { util } from './util'\nsrc/core.ts\x004\x00  return util(1)\n"
  return ''
}
