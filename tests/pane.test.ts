import type { On, RenderInput } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { PAPER_INKS, PAPER_INKS_256 } from '../hooks/render/palette'
import { codePointOf, packGrid } from '../hooks/render/raster'
import { gitAnswer, MODEL_REPLY, type Repo } from './fixtures'

const PLUGIN = 'isobar'

const PANE: RenderInput<'Pane'> = {
  component: 'Pane',
  surface: 'terminal',
  requestId: 'isobar',
  viewport: { columns: 200, rows: 60, isFullscreen: true },
  props: { title: 'Isobar', isFocused: true, bodyColumns: 92, placement: 'dock', scroll: { offset: 0, bodyRows: 56 }, view: {} },
}

/** `/isobar` typed in the composer of a full-screen terminal. */
const TOGGLE = { command: 'isobar', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } } as const

/**
 * The engine beneath the plugin: git from the fixture repo, a model that names the map, and a record of what was asked.
 * `started` is the environment Claude Code started in, as /proc gives it; absent, there is no /proc to read.
 * `repo` is how the fixture repo answers git; `scope` what the scope check's model replies, `gist` what the gist's does.
 * `files` are what the file system holds, `links` where a path really lands, and `isMapAnswered` whether the map's model answers.
 */
function world(on: On, started = '', repo: Repo = {}, scope = '{"unasked": []}', gist = '{"regions": []}') {
  const seen = { argvs: [] as (readonly string[])[], runs: [] as (readonly string[])[], files: new Map<string, string>(), links: new Map<string, string>(), isMapAnswered: true, opened: [] as string[], prompts: [] as string[], commands: [] as string[], models: 0, scoped: [] as string[], gists: [] as string[], mapModels: [] as string[], stored: new Map<string, unknown>(), open: new Set<string>() }

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.render', () => ({ type: 'Text', children: [''] }))
  on('process.run', ($, e) => (seen.runs.push(e.argv), { value: { exitCode: 0, stdout: e.argv[0] === 'sh' ? started : gitAnswer(e.argv, repo), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  // git runs as a spawned child, its output streamed whole
  on('process.spawn', async function* ($, e) {
    seen.argvs.push(e.argv)
    const stdout = gitAnswer(e.argv, repo)

    if (stdout !== '') yield { stream: 'stdout' as const, text: stdout }
    return { value: { code: 0, signal: null } }
  })
  on('model.complete', ($, e) => {
    const isScope = e.prompt.includes("coding agent's edits")
    const isGist = e.prompt.includes('captions on a map of a codebase')

    if (isScope) seen.scoped.push(e.prompt)
    else if (isGist) seen.gists.push(e.prompt)
    else {
      seen.models++
      seen.mapModels.push(e.model)
    }
    return { value: { isAnswered: isScope || isGist || seen.isMapAnswered, text: isScope ? scope : isGist ? gist : MODEL_REPLY, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never
  })
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.messages', () => ({ value: [{ role: 'user', text: 'Make util add two instead of one', toolUses: [] }] }) as never)
  on('fs.exists', ($, e) => ({ value: seen.files.has(e.path) }))
  on('fs.read', ($, e) => ({ value: seen.files.get(e.path) ?? '' }))
  on('fs.stat', ($, e) => ({ value: { kind: 'file', size: 0, mtimeMs: 0, isLink: seen.links.has(e.path), realPath: seen.links.get(e.path) ?? e.path } }))
  on('store.get', ($, e) => ({ value: seen.stored.get(e.key) }))
  on('store.set', ($, e) => {
    seen.stored.set(e.key, e.value)
    return { value: undefined }
  })
  on('command.register', ($, e) => {
    seen.commands.push(e.name)
    return { value: { command: e.name } } as never
  })
  on('ui.open', ($, e) => {
    seen.opened.push(e.id)
    seen.open.add(e.id)
    return { value: { isPlaced: true } } as never
  })
  on('ui.close', ($, e) => {
    seen.open.delete(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: [...seen.open].map(id => ({ id, title: 'Isobar', isShown: true, isFocused: false, isPlaced: true })) }) as never)
  on('prompt.submit', ($, e) => {
    seen.prompts.push(e.text)
    return { text: e.text } as never
  })
  return seen
}

/** Lets the refresh the session started run to its end: it awaits only engine calls, so microtasks suffice. */
async function settle() {
  for (let i = 0; i < 2000; i++) await Promise.resolve()
}

/** The Raster's glyphs, row by row, so a test can read the sheet. */
function textOf(cells: string, cols: number): string[] {
  const bin = atob(cells)
  const rows: string[] = []
  let row = ''

  for (let i = 0; i < bin.length; i += 12) {
    const cp = bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8)

    row += String.fromCharCode(cp)
    if (row.length === cols) {
      rows.push(row)
      row = ''
    }
  }
  return rows
}

/** Every colour the Raster's cells paint, foreground and background. */
function colorsOfCells(cells: string): Set<number> {
  const bin = atob(cells)
  const word = (i: number) => (bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8) | (bin.charCodeAt(i + 2) << 16) | (bin.charCodeAt(i + 3) << 24)) >>> 0
  const colors = new Set<number>()

  for (let i = 0; i < bin.length; i += 12) colors.add(word(i + 4)).add(word(i + 8))
  return colors
}

describe('the pane', () => {
  test('the first edit opens the pane on a sheet that names the change and its far reach', async ($, on) => {
    const seen = world(on)

    mock.clock(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await settle()

    expect(seen.commands).toEqual(['isobar'])
    expect(seen.models).toBe(1)
    expect(seen.opened).toEqual(['isobar'])

    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE })
    const raster = await ui.find({ type: 'Raster' })

    expect(raster?.props.columns).toBe(92)
    expect(raster?.props.rows).toBe(56)
    const sheet = textOf(String(raster?.props.cells), 92).join('\n')

    // a title over the frame, badges on the regions, notes on the files, a legend under it
    expect(sheet).toContain('I S O B A R')
    expect(sheet).toContain('CHANGED +5 −1')
    expect(sheet).toContain('NO TESTS')
    expect(sheet).toContain('5 files depend on it')
    expect(sheet).toContain('far.ts · 3 hops')
    expect(sheet).toContain('1 ● change')
    expect(colorsOfCells(String(raster?.props.cells))).toContain(PAPER_INKS.paper)

    await ui.press({ key: 'key-1' })
    const after = textOf(String((await ui.find({ type: 'Raster' }))?.props.cells), 92).join('\n')

    expect(after).not.toContain('5 files depend on it')
    await ui.press({ key: 'key-p' })
    // every path and name the question carries is quoted as data
    expect(seen.prompts[0]).toContain('"src/util.ts" → "src/core.ts" → "src/app.ts" → "src/far.ts" (3 hops, into "Edge")')
    await ui.unmount()
  })

  test('an edit in another repository maps that one; a Bash command keeps it', async ($, on) => {
    const seen = world(on)

    on('tool.call', () => ({ result: 'done' }) as never)
    const clock = mock.clock(on)

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await settle()
    expect(seen.stored.has('map:/work')).toBe(true)

    await $.tool.call({ tool: 'Edit', file_path: '/other/src/util.ts', old_string: 'a', new_string: 'b' } as never)
    await clock.advance(600)
    await settle()
    expect(seen.stored.has('map:/other')).toBe(true)
    expect(seen.models).toBe(2)

    await $.tool.call({ tool: 'Bash', command: 'git status' } as never)
    await clock.advance(600)
    await settle()
    expect(seen.models).toBe(2)

    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE })

    expect(textOf(String((await ui.find({ type: 'Raster' }))?.props.cells), 92).join('\n')).toContain('O T H E R')
    await ui.unmount()
  })

  test('a terminal Claude Code paints in 256 colours gets the map in xterm\'s own colours', async ($, on) => {
    // Claude Code started without COLORTERM, so it paints 256
    const seen = world(on, 'TERM=xterm-256color\nTERM_PROGRAM=WezTerm\n')

    mock.clock(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await settle()
    expect(seen.opened).toEqual(['isobar'])
    // only the four variables the choice reads leave the shell
    expect(seen.runs.find(a => a[0] === 'sh')?.[2]).toContain('grep -E "^(COLORTERM|TERM|TERM_PROGRAM|TMUX)="')

    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE })

    expect(colorsOfCells(String((await ui.find({ type: 'Raster' }))?.props.cells))).toContain(PAPER_INKS_256.paper)
    await ui.unmount()
  })

  test('the map is drawn once and kept: a second session reads it back without the model', async ($, on) => {
    const seen = world(on)

    mock.clock(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await settle()
    expect(seen.stored.has('map:/work')).toBe(true)
  })

  test('/isobar closes the shown pane and opens it again, reading what is open from the host', async ($, on) => {
    const seen = world(on)

    mock.clock(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await settle()
    expect(seen.open.has('isobar')).toBe(true)

    expect((await $.command.run(TOGGLE)).text).toBe('Isobar pane closed.')
    expect(seen.open.has('isobar')).toBe(false)
    expect((await $.command.run(TOGGLE)).text).toContain('1 file changed in Core.')
    expect(seen.open.has('isobar')).toBe(true)
  })

  test('every surface takes the drawing', async ($, on) => {
    world(on)
    mock.clock(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await settle()

    for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
      const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE, surface })

      expect(ui.surface).toBe(surface)
      await ui.unmount()
    }
    for (const bodyColumns of [40, 70, 140]) {
      const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE, props: { ...PANE.props, bodyColumns, scroll: { offset: 0, bodyRows: 30 } } })

      expect((await ui.find({ type: 'Raster' }))?.props.columns).toBe(bodyColumns)
      await ui.unmount()
    }
  })

  test('the map is named by the model the session runs on', async ($, on) => {
    const seen = world(on)

    mock.clock(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await settle()
    expect(seen.mapModels).toEqual(['claude-sonnet-5-5'])
  })

  test('read by declaration, a body change names what it touched and rains only on its users', async ($, on) => {
    world(on, '', { read: true })
    mock.clock(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await settle()

    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE })
    const sheet = textOf(String((await ui.find({ type: 'Raster' }))?.props.cells), 92).join('\n')

    expect(sheet).toContain('util.ts · util')
    expect(sheet).toContain('new behaviour · 1 use in 1 file')
    expect(sheet).not.toContain('far.ts · 3 hops')
    await ui.unmount()
  })

  test('with the scope check on, a turn that changes a file nobody asked for marks it UNASKED', { options: { scope: 'on' } }, async ($, on) => {
    const repo: Repo = { read: true, hash: 'before' }
    const seen = world(on, '', repo, '{"unasked": [{"path": "src/util.ts", "why": "changed util"}]}')

    on('tool.call', () => ({ result: 'done' }) as never)
    const clock = mock.clock(on)

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await settle()
    await $.turn.start({ text: 'Rename the docs folder', turnId: 't1' })
    await settle()
    repo.hash = 'after'
    await $.tool.call({ tool: 'Edit', file_path: '/work/src/util.ts', old_string: 'a', new_string: 'b' } as never)
    await clock.advance(600)
    await settle()
    await $.turn.complete({ answer: 'Done.', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
    await settle()

    expect(seen.scoped.length).toBe(1)
    expect(seen.scoped[0]).toContain('Make util add two instead of one')
    expect(seen.scoped[0]).toContain('src/util.ts (+5 −1; body util)')
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE })
    const sheet = textOf(String((await ui.find({ type: 'Raster' }))?.props.cells), 92).join('\n')

    expect(sheet).toContain('UNASKED')
    expect(sheet).toContain('unasked: changed util')
    expect(sheet).toContain('1 this turn')
    await ui.unmount()
  })

  test('on a tree that was clean when the session began, a file a shell command wrote belongs to its turn', async ($, on) => {
    const repo: Repo = { isClean: true }

    world(on, '', repo)
    on('tool.call', () => ({ result: 'done' }) as never)
    const clock = mock.clock(on)

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await settle()
    await $.turn.start({ text: 'Make util add two', turnId: 't1' })
    await settle()
    repo.isClean = false
    await $.tool.call({ tool: 'Bash', command: "sed -i 's/1/2/' src/util.ts" } as never)
    await clock.advance(600)
    await settle()

    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE })

    expect(textOf(String((await ui.find({ type: 'Raster' }))?.props.cells), 92).join('\n')).toContain('1 this turn')
    await ui.unmount()
  })

  test('the gist captions each changed region under its name from the diff, once per change, never with the requests', async ($, on) => {
    const repo: Repo = { read: true, hash: 'before' }
    const seen = world(on, '', repo, undefined, '{"regions": [{"id": "core", "what": "Adds two instead of one."}]}')

    on('tool.call', () => ({ result: 'done' }) as never)
    const clock = mock.clock(on)

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await settle()
    // the tree was dirty when the session began: with no turn running, the gist captions it at once
    expect(seen.gists.length).toBe(1)
    expect(seen.gists[0]).toContain('<region id="core"')
    expect(seen.gists[0]).not.toContain('Make util add two instead of one')
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE })

    expect(textOf(String((await ui.find({ type: 'Raster' }))?.props.cells), 92).join('\n')).toContain('adds two instead of one')
    await ui.unmount()

    // a turn that edits the region waits for its end, then asks once more of the new change
    await $.turn.start({ text: 'Make util add three', turnId: 't1' })
    await settle()
    repo.hash = 'after'
    await $.tool.call({ tool: 'Edit', file_path: '/work/src/util.ts', old_string: 'a', new_string: 'b' } as never)
    await clock.advance(600)
    await settle()
    expect(seen.gists.length).toBe(1)
    await $.turn.complete({ answer: 'Done.', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
    await settle()
    expect(seen.gists.length).toBe(2)
  })

  test('with the gist and the scope check off, no turn asks a model', { options: { gist: 'off' } }, async ($, on) => {
    const seen = world(on, '', { read: true })

    mock.clock(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await settle()
    await $.turn.start({ text: 'Make util add two', turnId: 't1' })
    await $.turn.complete({ answer: 'Done.', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
    await settle()
    expect(seen.scoped).toEqual([])
    expect(seen.gists).toEqual([])
  })

  test('every git call leaves the index alone, and the log names paths unquoted', async ($, on) => {
    const seen = world(on, '', { read: true }, undefined, '{"regions": [{"id": "core", "what": "adds two"}]}')

    mock.clock(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await settle()
    const gits = seen.argvs.filter(a => a[0] === 'git' && a[3] === '-c')
    const diffs = seen.argvs.filter(a => a[0] === 'git' && a.includes('diff'))

    expect(diffs.length).toBeGreaterThan(2)
    for (const argv of diffs) expect(argv.slice(3, 5)).toEqual(['-c', 'diff.autoRefreshIndex=false'])
    expect(gits.find(a => a.includes('log'))).toContain('core.quotePath=false')
    // the gist's caption redraws the pane once more
    await settle()
  })

  test('a model that cannot name the map leaves a folder map for this session only, and says so', async ($, on) => {
    const seen = world(on)

    seen.isMapAnswered = false
    mock.clock(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await settle()
    expect(seen.models).toBe(1)
    expect(seen.stored.has('map:/work')).toBe(false)
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE })

    expect(textOf(String((await ui.find({ type: 'Raster' }))?.props.cells), 92).join('\n')).toContain('folders only · /isobar map retries')
    await ui.unmount()
  })

  test("a repository's own map is read as data: its names clipped and stripped of control characters", async ($, on) => {
    const seen = world(on)
    const shared = JSON.parse(MODEL_REPLY) as { layers: { id: string }[]; regions: { name: string; layer: string }[] }

    shared.regions[1]!.name = 'Core\u202e[evil](https://example.com) and a very long name past the clip'
    seen.files.set('/work/.isobar/map.json', JSON.stringify({ version: 1, repo: 'work', head: 'abc', builtAt: '', source: 'model', ...shared }))
    mock.clock(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await settle()
    expect(seen.models).toBe(0)
    // the name is drawn clipped to 24 characters, the bidi control gone
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE })
    const sheet = textOf(String((await ui.find({ type: 'Raster' }))?.props.cells), 92).join('\n')

    expect(sheet).toContain('core[evil](https://examp ')
    expect(sheet).not.toContain('past the clip')
    await ui.unmount()
  })

  test('a shared map that is no map is set aside: the map is drawn, and the pane says why', async ($, on) => {
    const seen = world(on)

    seen.files.set('/work/.isobar/map.json', JSON.stringify({ version: 1, layers: [{ id: 'a' }], regions: [{ id: 'x', layer: 'a' }] }))
    mock.clock(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await settle()
    expect(seen.models).toBe(1)
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE })

    expect(textOf(String((await ui.find({ type: 'Raster' }))?.props.cells), 92).join('\n')).toContain('ignoring .isobar/map.json: not a valid map')
    await ui.unmount()
  })

  test('/isobar map asked while a refresh runs redraws the map once that refresh is done', async ($, on) => {
    const seen = world(on)

    mock.clock(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await settle()
    expect(seen.models).toBe(1)
    await $.turn.start({ text: 'Make util add two', turnId: 't1' })
    // the turn's refresh is running: the redraw waits for it, then runs
    expect((await $.command.run({ ...TOGGLE, args: 'map' })).text).toContain('Redrawing the basemap')
    await settle()
    expect(seen.models).toBe(2)
  })

  test('a file a shell command creates joins the change; one untracked before the session never does', async ($, on) => {
    const repo: Repo = { untracked: ['notes.txt'] }

    world(on, '', repo)
    on('tool.call', () => ({ result: 'done' }) as never)
    const clock = mock.clock(on)

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await settle()
    await $.turn.start({ text: 'Scaffold a helper', turnId: 't1' })
    repo.untracked = ['notes.txt', 'src/helper.ts']
    await $.tool.call({ tool: 'Bash', command: 'touch src/helper.ts' } as never)
    await clock.advance(600)
    await settle()
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE })
    const sheet = textOf(String((await ui.find({ type: 'Raster' }))?.props.cells), 92).join('\n')

    expect(sheet).toContain('CHANGED')
    expect((await $.command.run(TOGGLE)).text).toBe('Isobar pane closed.')
    expect((await $.command.run(TOGGLE)).text).toContain('2 files changed')
    await ui.unmount()
  })

  test("a file written through a symlinked checkout counts as the session's, by where it really lands", async ($, on) => {
    const repo: Repo = { isClean: true, untracked: ['src/new.ts'] }
    const seen = world(on, '', repo)

    on('tool.call', () => ({ result: 'done' }) as never)
    seen.links.set('/mnt/checkout/src/new.ts', '/work/src/new.ts')
    const clock = mock.clock(on)

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await settle()
    await $.turn.start({ text: 'Add a module', turnId: 't1' })
    await $.tool.call({ tool: 'Write', file_path: '/mnt/checkout/src/new.ts', content: 'export const a = 1' } as never)
    await clock.advance(600)
    await settle()
    // the file joined the change, so the pane opened on it
    expect((await $.command.run(TOGGLE)).text).toBe('Isobar pane closed.')
    expect((await $.command.run(TOGGLE)).text).toContain('1 file changed')
  })

  test('the scope check reads the turn that ended, even when the next prompt starts while its refresh runs', { options: { scope: 'on' } }, async ($, on) => {
    const repo: Repo = { read: true, hash: 'before' }
    const seen = world(on, '', repo, '{"unasked": []}')

    on('tool.call', () => ({ result: 'done' }) as never)
    const clock = mock.clock(on)

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await settle()
    await $.turn.start({ text: 'Make util add two', turnId: 't1' })
    await settle()
    repo.hash = 'after'
    await $.tool.call({ tool: 'Edit', file_path: '/work/src/util.ts', old_string: 'a', new_string: 'b' } as never)
    await clock.advance(600)
    await settle()
    await $.turn.complete({ answer: 'Done.', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
    await $.turn.start({ text: 'Now add a test', turnId: 't2' })
    await settle()
    expect(seen.scoped.length).toBe(1)
    expect(seen.scoped[0]).toContain('src/util.ts')
    // the check's answer redraws the pane once more
    await settle()
  })

  test('a pane too small for the map says so instead of cutting it', async ($, on) => {
    world(on)
    mock.clock(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await settle()
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE, props: { ...PANE.props, bodyColumns: 26, scroll: { offset: 0, bodyRows: 9 } } })
    const raster = await ui.find({ type: 'Raster' })

    expect([raster?.props.columns, raster?.props.rows]).toEqual([26, 9])
    expect(textOf(String(raster?.props.cells), 26).join(' ').replace(/\s+/g, ' ')).toContain('Widen or heighten the pane')
    await ui.unmount()
  })

  test('off the terminal, names and captions are plain text: a link in a caption stays words', async ($, on) => {
    world(on, '', { read: true }, undefined, '{"regions": [{"id": "core", "what": "[see](https://example.com)"}]}')
    mock.clock(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await settle()

    for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
      const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE, surface })

      expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
      expect(JSON.stringify(await ui.find({ type: 'Box' }))).toContain('Core: [see](https://example.com)')
      await ui.unmount()
    }
  })

  test('every BMP code point the sheet lets through is one the terminal Raster draws', async ($, on) => {
    const cells = Array.from({ length: 0x10000 }, (_, p) => ({ glyph: String.fromCharCode(p), fg: 0, bg: 0xffffff }))

    on('ui.render', { component: 'Pane', requestId: 'bmp' }, () => ({ type: 'Raster', props: { key: 'bmp', columns: 256, rows: 256, cells: packGrid({ cols: 256, rows: 256, cells }) } }) as never)
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE, requestId: 'bmp' })

    expect((await ui.find({ type: 'Raster' }))?.props.columns).toBe(256)
    expect(codePointOf('\u202e')).toBe(0x20)
    await ui.unmount()
  })

  test('a headless session does no work', async ($, on) => {
    const seen = world(on)

    await $.session.start({ surface: null, isInteractive: false, cwd: '/work' })
    expect(seen.commands).toEqual([])
    expect(seen.opened).toEqual([])
  })
})
