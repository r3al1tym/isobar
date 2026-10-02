import { describe, expect, test } from 'claude-code/testing'

import { finishBasemap, parseBasemapReply, unitsOf } from '../hooks/engine/basemap'
import { parseScopeReply } from '../hooks/engine/scope'
import { attribute } from '../hooks/engine/session'
import { hunksOf, namesMember, readChange, shapeOf, textsOf } from '../hooks/engine/symbols'
import type { Facts, Run } from '../hooks/engine/types'
import { weatherOf } from '../hooks/engine/weather'
import { FACTS, MODEL_REPLY } from './fixtures'

/** `lines` with line `n` (1-based) replaced. */
const edit = (lines: readonly string[], n: number, text: string) => lines.map((l, i) => (i === n - 1 ? text : l))

describe('declarations', () => {
  const js = [
    "import { x } from './x'",
    '',
    '/** Adds. */',
    'export function add(a: number) {',
    '  return a + x',
    '}',
    '',
    'export const LIMIT = 5',
    '',
    'function helper() {',
    '  return add(1)',
    '}',
    'export function api() {',
    '  return helper()',
    '}',
  ]

  test('a body change names the function; a private one also names the functions here that call it', () => {
    const s = shapeOf('src/m.ts', js, edit(js, 5, '  return a + x + 1'), [5], [5])

    expect(s.kind).toBe('body')
    expect(s.touches).toEqual([{ name: 'add', kind: 'body' }])
    expect(s.words).toEqual(['add'])
    // helper is never exported, so its users are api's
    expect(shapeOf('src/m.ts', js, edit(js, 11, '  return add(2)'), [11], [11]).words).toEqual(['helper', 'api'])
  })

  test('a JS header change is a new signature; a comment, a value and an import each read as what they are', () => {
    expect(shapeOf('src/m.ts', js, edit(js, 4, 'export function add(a: number, b = 0) {'), [4], [4]).kind).toBe('signature')
    expect(shapeOf('src/m.ts', js, edit(js, 3, '/** Adds two numbers. */'), [3], [3]).kind).toBe('comments')
    expect(shapeOf('src/m.ts', js, edit(js, 8, 'export const LIMIT = 6'), [8], [8])).toMatchObject({ kind: 'body', words: ['LIMIT'] })
    expect(shapeOf('src/m.ts', js, edit(js, 1, "import { x, y } from './x'"), [1], [1]).kind).toBe('imports')
    expect(shapeOf('src/m.ts', js, [...js, "console.log('ready')"], [], [16]).kind).toBe('file')
  })

  const py = [
    'import os',
    '',
    'class App:',
    '    """An app."""',
    '',
    '    def __init__(self, name):',
    '        self.name = name',
    '',
    '    def run(self, port):',
    '        """Runs it."""',
    '        return serve(self.name, port)',
    '',
    '',
    '@cache',
    'def serve(name, port):',
    '    return name',
  ]

  test('a Python method reads as its own declaration; a constructor stands for its class', () => {
    expect(shapeOf('pkg/app.py', py, edit(py, 11, '        return serve(self.name, port + 1)'), [11], [11])).toMatchObject({ kind: 'body', touches: [{ name: 'run', kind: 'body', owner: 'App' }], words: ['run'], members: ['run'] })
    expect(shapeOf('pkg/app.py', py, edit(py, 7, '        self.name = name.strip()'), [7], [7])).toMatchObject({ words: ['App'], members: [] })
    expect(shapeOf('pkg/app.py', py, edit(py, 10, '        """Runs the app."""'), [10], [10]).kind).toBe('comments')
  })

  test('a decorator or parameter change is a new signature, and a removed function is one too', () => {
    expect(shapeOf('pkg/app.py', py, edit(py, 14, '@cache(3)'), [14], [14]).kind).toBe('signature')
    expect(shapeOf('pkg/app.py', py, edit(py, 15, 'def serve(name, port, host):'), [15], [15]).kind).toBe('signature')
    expect(shapeOf('pkg/app.py', py, py.slice(0, 12), [13, 14, 15, 16], []).touches.filter(t => t.kind !== 'comments')).toEqual([{ name: 'serve', kind: 'signature' }])
  })

  test('a file it cannot read by declaration is read whole', () => {
    expect(shapeOf('src/main.go', ['package main'], ['package app'], [1], [1]).kind).toBe('file')
    expect(shapeOf('src/new.ts', null, ['export const a = 1'], [], [1]).kind).toBe('file')
  })
})

describe('git output for declarations', () => {
  test('hunks give each side its touched lines, new and deleted files included', () => {
    const diff = [
      'diff --git a/a.ts b/a.ts', '--- a/a.ts', '+++ b/a.ts', '@@ -2 +2,2 @@', '-x', '+y', '+z', '@@ -9,0 +11 @@', '+w',
      'diff --git a/gone.ts b/gone.ts', '--- a/gone.ts', '+++ /dev/null', '@@ -1,2 +0,0 @@', '-a', '-b',
    ].join('\n')

    expect([...hunksOf(diff)]).toEqual([['a.ts', { removed: [2], added: [2, 3, 11] }], ['gone.ts', { removed: [1, 2], added: [] }]])
  })

  test('texts come back line by line, a ref prefix taken off', () => {
    expect([...textsOf('HEAD:a.ts\x001\x00one\nHEAD:a.ts\x003\x00three\r\n', 'HEAD')]).toEqual([['a.ts', ['one', '', 'three']]])
  })
})

describe('users', () => {
  // a.ts exports foo; b.ts imports it; lib/index.ts passes it on to d.ts; c.ts imports only b.ts
  const facts: Facts = {
    root: '/r',
    head: 'h',
    lines: new Map([['a.ts', 3], ['b.ts', 2], ['c.ts', 2], ['d.ts', 2], ['index.ts', 1]]),
    edges: [{ from: 'b.ts', to: 'a.ts' }, { from: 'c.ts', to: 'b.ts' }, { from: 'index.ts', to: 'a.ts' }, { from: 'd.ts', to: 'index.ts' }],
    commits: [],
  }
  const before = ['export function foo(a: number) {', '  return a + 1', '}']
  const after = ['export function foo(a: number) {', '  return a + 2', '}']
  const rows = (lines: string[], prefix = '') => lines.map((t, i) => `${prefix}a.ts\0${i + 1}\0${t}\n`).join('')
  const run: Run = async argv => {
    const args = argv.slice(3).join(' ')
    const stdout = args.includes('diff -U0')
      ? 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -2 +2 @@\n-  return a + 1\n+  return a + 2\n'
      : args.startsWith('grep -z -n -I -e  HEAD')
        ? rows(before, 'HEAD:')
        : args.startsWith('grep -z -n -I -e  --')
          ? rows(after)
          : [
              "b.ts\x001\x00import { foo } from './a'", 'b.ts\x002\x00foo(1)',
              "c.ts\x001\x00const foo = 'its own'", "c.ts\x002\x00log('foo')",
              "d.ts\x001\x00import { foo } from './index'", 'd.ts\x002\x00// foo is passed on', 'd.ts\x003\x00foo(2)',
            ].join('\n')

    return { exitCode: 0, stdout }
  }

  test('a function is used where it is in scope: by its importers and through barrels, never by a name that only looks the same', async () => {
    const read = await readChange(run, '/r', facts, [{ path: 'a.ts', added: 1, deleted: 1, isNew: false, isDeleted: false }], { from: 'HEAD' })

    expect(read.shapes.get('a.ts')?.kind).toBe('body')
    expect(read.users.filter(u => u.uses > 0).map(u => [u.path, u.uses])).toEqual([['b.ts', 1], ['d.ts', 1]])
  })
})

test('a method is used through an object or redefined by a subclass; a bare call is another function', () => {
  expect(namesMember('    rv = self.make_response(rv)', ['make_response'])).toBe(true)
  expect(namesMember('    def make_response(self, rv):', ['make_response'])).toBe(true)
  expect(namesMember('  app?.listen(3000)', ['listen'])).toBe(true)
  expect(namesMember('    return make_response(rv)', ['make_response'])).toBe(false)
})

describe('reach by declaration', () => {
  const map = finishBasemap('demo', FACTS, parseBasemapReply(MODEL_REPLY, unitsOf(FACTS))!, 'model', '2026-10-02T00:00:00Z')
  const base = { kind: 'uncommitted' as const, label: 'uncommitted' }
  const change = [{ path: 'src/util.ts', added: 1, deleted: 1, isNew: false, isDeleted: false }]

  test('a body change rains on the files that use it, never on the rest of its importers', () => {
    const read = {
      shapes: new Map([['src/util.ts', { path: 'src/util.ts', kind: 'body' as const, touches: [{ name: 'util', kind: 'body' as const }], words: ['util'], members: [] }]]),
      users: [{ path: 'src/core.ts', hop: 1, via: 'src/util.ts', uses: 2, of: 'src/util.ts' }],
    }
    const w = weatherOf(map, FACTS, base, change, read)

    expect(w.reach.map(r => r.path)).toEqual(['src/core.ts'])
    expect(w.cells[0]).toMatchObject({ kind: 'body', users: 1, uses: 2 })
    expect(w.offshoots).toEqual([])
  })

  test('a comment-only change stays dry and needs no test', () => {
    const read = { shapes: new Map([['src/util.ts', { path: 'src/util.ts', kind: 'comments' as const, touches: [], words: [], members: [] }]]), users: [] }
    const w = weatherOf(map, FACTS, base, change, read)

    expect(w.reach).toEqual([])
    expect(w.regions.core?.tags).toEqual(['CHANGED +1 −1'])
  })

  test('without a read every importer is reached, as far as three hops', () => {
    expect(weatherOf(map, FACTS, base, change).reach.map(r => r.path)).toEqual(['src/core.ts', 'src/app.ts', 'test/core.test.ts', 'src/far.ts'])
  })

  test("an earlier turn's edit fades behind the latest, and a flagged edit carries UNASKED", () => {
    const two = [...change, { path: 'scripts/tool.ts', added: 2, deleted: 0, isNew: false, isDeleted: false }]
    const w = weatherOf(map, FACTS, base, two, undefined, { turns: new Map([['src/util.ts', 1], ['scripts/tool.ts', 2]]), unasked: new Map([['scripts/tool.ts', 'reformatted the script']]) })

    expect(w.cells.map(c => [c.path, c.isLatest])).toEqual([['src/util.ts', false], ['scripts/tool.ts', true]])
    expect(w.regions.tools?.tags).toContain('UNASKED')
    expect(w.lines.join(' ')).toContain('Unasked: tool.ts, reformatted the script.')
  })
})

describe('the session', () => {
  test('a file first seen predates the session unless its edits named it; moved content belongs to the turn', () => {
    const first = attribute(undefined, new Map([['a.ts', 'h1'], ['b.ts', 'h2']]), 3, new Set(['b.ts']))

    expect([...first.turns]).toEqual([['a.ts', 0], ['b.ts', 3]])
    const next = attribute(first, new Map([['a.ts', 'h1'], ['b.ts', 'h9'], ['c.ts', 'h3']]), 4, new Set())

    expect([...next.turns]).toEqual([['a.ts', 0], ['b.ts', 4], ['c.ts', 4]])
    expect([...attribute(next, new Map([['c.ts', 'h3']]), 5, new Set()).turns]).toEqual([['c.ts', 4]])
  })

  test('the scope reply keeps only the files it was shown, and nothing from a reply that is no JSON', () => {
    const shown = new Set(['a.ts', 'b.ts'])

    expect([...parseScopeReply('Here: {"unasked": [{"path": "b.ts", "why": "renamed a helper."}, {"path": "z.ts", "why": "x"}]}', shown)!]).toEqual([['b.ts', 'renamed a helper']])
    expect(parseScopeReply('{"unasked": []}', shown)?.size).toBe(0)
    expect(parseScopeReply('{"unasked": [{"path": "a.ts", "why": "Changelog entry not requested"}]}', shown)?.get('a.ts')).toBe('changelog entry')
    expect(parseScopeReply('every change was asked for', shown)).toBe(null)
  })
})
