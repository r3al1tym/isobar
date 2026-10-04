import { describe, expect, test } from 'claude-code/testing'

import { completeRegions, finishBasemap, folderRegion, parseBasemapReply, regionFinder, unitsOf } from '../hooks/engine/basemap'
import { gatherFacts, parseCounts, parseEmpty, parseHits, parseLog, parseNumstat } from '../hooks/engine/git'
import { chainOf, expectedOf, graphOf, reachOf } from '../hooks/engine/graph'
import { edgesOf, joinedPython, jsRulesOf, normalize, parseJsonc, resolveJs, resolvePython } from '../hooks/engine/imports'
import { weatherOf } from '../hooks/engine/weather'
import { ALL_LAYERS } from '../hooks/render/field'
import { layoutOf } from '../hooks/render/layout'
import { colorsOf, NIGHT_INKS_256, PAPER_INKS, PAPER_INKS_256, roundedXtermOf, shown256, STORM, xtermOf } from '../hooks/render/palette'
import { codePointOf } from '../hooks/render/raster'
import { sheetOf, wrap } from '../hooks/render/sheet'
import { FACTS, MODEL_REPLY } from './fixtures'

describe('imports', () => {
  const files = new Set(['src/a.ts', 'src/b.tsx', 'src/lib/index.ts', 'pkg/mod.py', 'pkg/sub/__init__.py', 'pkg/sib.py'])

  test('relative specifiers resolve to repo files, packages do not', () => {
    expect(resolveJs('src/a.ts', './b', files)).toBe('src/b.tsx')
    expect(resolveJs('src/a.ts', './b.js', files)).toBe('src/b.tsx')
    expect(resolveJs('src/a.ts', './lib', files)).toBe('src/lib/index.ts')
    expect(resolveJs('src/a.ts', 'react', files)).toBe(null)
    expect(resolveJs('src/a.ts', '../../x', files)).toBe(null)
    expect(normalize('a/b/../c/./d')).toBe('a/c/d')
  })

  test('python imports resolve absolute, relative and sibling modules', () => {
    expect(resolvePython('pkg/mod.py', 'from . import sib', files)).toEqual(['pkg/sib.py'])
    expect(resolvePython('main.py', 'import pkg.mod', files)).toEqual(['pkg/mod.py'])
    expect(resolvePython('main.py', 'from pkg import sub', files)).toEqual(['pkg/sub/__init__.py'])
  })

  test('edges come from grep hits, once each', () => {
    const edges = edgesOf([{ path: 'src/a.ts', text: "import { b } from './b'" }, { path: 'src/a.ts', text: "export * from './b'" }], files)

    expect(edges).toEqual([{ from: 'src/a.ts', to: 'src/b.tsx' }])
  })

  test('the repository root is a folder too', () => {
    const root = new Set(['index.js', 'examples/auth/index.js', 'test/app.js'])

    expect(resolveJs('examples/auth/index.js', '../..', root)).toBe('index.js')
    expect(resolveJs('test/app.js', '..', root)).toBe('index.js')
    expect(resolveJs('test/app.js', '../', root)).toBe('index.js')
  })

  test('tsconfig and jsconfig are read as JSONC', () => {
    expect(parseJsonc('{ "a": "x//y", /* c */ "b": [1, 2,], // d\n }')).toEqual({ a: 'x//y', b: [1, 2] })
    expect(parseJsonc('{ "a": ')).toBe(null)
  })

  describe('bare specifiers', () => {
    const tree = new Set([
      'tsconfig.json', 'src/a.ts', 'packages/app/src/x.ts', 'packages/app/legacy/old.ts', 'test-utils.ts',
      'apps/web/src/main.ts', 'apps/web/src/components/button.tsx', 'apps/web/src/packages/app/src/x.ts',
      'packages/math/src/index.ts', 'packages/math/src/vector.ts', 'packages/math/src/angle.ts', 'packages/math/src/internal/clamp.ts',
      'packages/ui/src/index.tsx', 'fixtures/ui/index.js', 'test/fixtures/pad/index.js', 'vendor/dep/lib/main.js', 'vendor/dep/index.js',
    ])
    const rules = jsRulesOf(new Map([
      ['tsconfig.base.json', '{\n  // shared by every app\n  "compilerOptions": { "paths": { "@app/*": ["./packages/app/src/*", "./packages/app/legacy/*"], "~utils": ["./test-utils.ts"], }, },\n}'],
      ['tsconfig.json', '{ "extends": "./tsconfig.base.json" }'],
      ['apps/web/tsconfig.json', '{ "extends": "../../tsconfig.base", "compilerOptions": { "baseUrl": "src" } }'],
      ['package.json', JSON.stringify({ name: 'acme', private: true, workspaces: ['packages/*', 'fixtures/*'] })],
      ['packages/math/package.json', JSON.stringify({ name: '@acme/math', exports: { '.': { types: './dist/index.d.ts', import: './src/index.ts' }, './vector': './src/vector.ts' }, imports: { '#internal/*': './src/internal/*.js', '#dep': 'left-pad', '#flag': { 'module-sync': './src/vector.ts', default: './src/angle.ts' } } })],
      ['packages/ui/package.json', JSON.stringify({ name: 'ui', main: './dist/index.js' })],
      ['fixtures/ui/package.json', JSON.stringify({ name: 'ui', main: 'index.js' })],
      ['test/fixtures/pad/package.json', JSON.stringify({ name: 'left-pad', main: 'index.js' })],
      ['vendor/dep/package.json', JSON.stringify({ main: './lib/main.js' })],
    ]))

    test('tsconfig paths, through extends, with wildcards and fallbacks', () => {
      expect(resolveJs('src/a.ts', '@app/x', tree, rules)).toBe('packages/app/src/x.ts')
      expect(resolveJs('src/a.ts', '@app/old', tree, rules)).toBe('packages/app/legacy/old.ts')
      expect(resolveJs('src/a.ts', '~utils', tree, rules)).toBe('test-utils.ts')
      expect(resolveJs('src/a.ts', 'react', tree, rules)).toBe(null)
    })

    test('with baseUrl set, paths are relative to it, and bare specifiers resolve under it', () => {
      expect(resolveJs('apps/web/src/main.ts', '@app/x', tree, rules)).toBe('apps/web/src/packages/app/src/x.ts')
      expect(resolveJs('apps/web/src/main.ts', 'components/button', tree, rules)).toBe('apps/web/src/components/button.tsx')
    })

    test("the repo's own packages by name: exports, then entry fields, then index; fixtures give way", () => {
      expect(resolveJs('src/a.ts', '@acme/math', tree, rules)).toBe('packages/math/src/index.ts')
      expect(resolveJs('src/a.ts', '@acme/math/vector', tree, rules)).toBe('packages/math/src/vector.ts')
      expect(resolveJs('src/a.ts', '@acme/math/src/angle', tree, rules)).toBe('packages/math/src/angle.ts')
      expect(resolveJs('src/a.ts', 'ui', tree, rules)).toBe('packages/ui/src/index.tsx')
      // no workspace declares it, so the package manager installs npm's left-pad instead
      expect(resolveJs('src/a.ts', 'left-pad', tree, rules)).toBe(null)
    })

    test('pnpm-workspace.yaml globs and link: dependencies declare packages too', () => {
      const pnpm = jsRulesOf(new Map([
        ['pnpm-workspace.yaml', "packages:\n  - 'packages/**'\n  - '!packages/ui'\nhoistPattern:\n  - fixtures/*\n"],
        ['packages/math/package.json', JSON.stringify({ name: '@acme/math', main: './src/index.ts' })],
        ['packages/ui/package.json', JSON.stringify({ name: 'ui', main: './src/index.tsx' })],
        ['fixtures/ui/package.json', JSON.stringify({ name: 'ui', main: 'index.js' })],
        ['src/package.json', JSON.stringify({ name: 'app', dependencies: { ui: 'link:../fixtures/ui' } })],
      ]))

      expect(resolveJs('src/a.ts', '@acme/math', tree, pnpm)).toBe('packages/math/src/index.ts')
      expect(resolveJs('src/a.ts', 'ui', tree, pnpm)).toBe('fixtures/ui/index.js')
    })

    test("a folder's package.json entry comes before its index", () => {
      expect(resolveJs('vendor/entry.js', './dep', tree, rules)).toBe('vendor/dep/lib/main.js')
      expect(resolveJs('vendor/entry.js', './dep', tree)).toBe('vendor/dep/index.js')
    })

    test('a tsconfig mapping wins over a package of the same name', () => {
      const workspace: [string, string][] = [
        ['package.json', JSON.stringify({ workspaces: ['packages/*'] })],
        ['packages/math/package.json', JSON.stringify({ name: '@acme/math', main: './src/index.ts' })],
      ]
      const both = jsRulesOf(new Map([['tsconfig.json', '{ "compilerOptions": { "paths": { "@acme/math": ["./packages/math/src/angle.ts"] } } }'], ...workspace]))

      expect(resolveJs('src/a.ts', '@acme/math', tree, both)).toBe('packages/math/src/angle.ts')
      expect(resolveJs('src/a.ts', '@acme/math', tree, jsRulesOf(new Map(workspace)))).toBe('packages/math/src/index.ts')
    })

    test('#name goes through the nearest package.json imports', () => {
      expect(resolveJs('packages/math/src/index.ts', '#internal/clamp', tree, rules)).toBe('packages/math/src/internal/clamp.ts')
      expect(resolveJs('packages/math/src/index.ts', '#dep', tree, rules)).toBe(null)
      // `default` before a condition the TypeScript compiler does not read
      expect(resolveJs('packages/math/src/index.ts', '#flag', tree, rules)).toBe('packages/math/src/angle.ts')
      expect(resolveJs('src/a.ts', '#internal/clamp', tree, rules)).toBe(null)
    })
  })

  describe('python', () => {
    const tree = new Set([
      'src/flask/__init__.py', 'src/flask/typing.py', 'src/flask/app.py', 'src/flask/json/__init__.py',
      'tests/helpers.py', 'tests/test_app.py', 'tests/apps/blog/__init__.py', 'tests/apps/blog/views.py',
      'app/__init__.py', 'app/models.py', 'app/views.py', 'app/sub/__init__.py', 'app/sub/x.py',
    ])

    test("an absolute import inside a package is Python 3's: never a sibling, always from the sys.path roots", () => {
      expect(resolvePython('src/flask/app.py', 'import typing as t', tree)).toEqual([])
      expect(resolvePython('src/flask/app.py', 'import json', tree)).toEqual([])
      expect(resolvePython('src/flask/app.py', 'from flask.typing import ResponseValue', tree)).toEqual(['src/flask/typing.py'])
      expect(resolvePython('tests/test_app.py', 'from blog import views', tree)).toEqual(['tests/apps/blog/views.py', 'tests/apps/blog/__init__.py'])
    })

    test('a file outside any package may still import a sibling', () => {
      expect(resolvePython('tests/test_app.py', 'import helpers', tree)).toEqual(['tests/helpers.py'])
    })

    test('from . import name takes a name that is no submodule from the package', () => {
      expect(resolvePython('app/views.py', 'from . import models, get_user', tree)).toEqual(['app/models.py', 'app/__init__.py'])
      expect(resolvePython('app/views.py', 'from . import models', tree)).toEqual(['app/models.py'])
      expect(resolvePython('app/sub/x.py', 'from .. import settings', tree)).toEqual(['app/__init__.py'])
    })

    test('an import over several lines reads as one, and stray name lines drop out', () => {
      const rows = joinedPython([
        { path: 'app/views.py', line: 1, text: 'from django.db import (' },
        { path: 'app/views.py', line: 2, text: '    models,  # the ORM' },
        { path: 'app/views.py', line: 3, text: '    connection as conn,' },
        { path: 'app/views.py', line: 9, text: '        self,' },
        { path: 'app/views.py', line: 12, text: 'from .forms import (Form,' },
        { path: 'app/views.py', line: 13, text: '    Field)' },
        { path: 'app/views.py', line: 14, text: 'import os' },
      ])

      expect(rows).toEqual([
        { path: 'app/views.py', line: 1, text: 'from django.db import ( models, connection as conn,' },
        { path: 'app/views.py', line: 12, text: 'from .forms import (Form, Field)' },
        { path: 'app/views.py', line: 14, text: 'import os' },
      ])
      expect(resolvePython('app/views.py', rows[0]!.text, new Set(['django/db/__init__.py', 'django/db/models/__init__.py']))).toEqual(['django/db/models/__init__.py', 'django/db/__init__.py'])
    })
  })
})

describe('git output', () => {
  test('numstat rows, renames included', () => {
    expect(parseNumstat('3\t1\tsrc/a.ts\0' + '2\t0\t\0old.ts\0new.ts\0' + '-\t-\tlogo.png\0')).toEqual([
      { path: 'src/a.ts', added: 3, deleted: 1, isNew: false, isDeleted: false },
      { path: 'new.ts', added: 2, deleted: 0, isNew: false, isDeleted: false },
      { path: 'logo.png', added: 0, deleted: 0, isNew: false, isDeleted: false },
    ])
  })

  test('a commit header before the rows hides none of them', () => {
    expect(parseNumstat('abc1234 fix: a thing\0\n10\t2\tsrc/a.ts\x0011\t0\ttest/a.test.ts\0').map(c => c.path)).toEqual(['src/a.ts', 'test/a.test.ts'])
  })

  test('empty files an import can name come from the index', () => {
    const empty = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391'

    expect(parseEmpty(`100644 ${empty} 0\tpkg/__init__.py\x00100644 ${empty} 0\t.gitkeep\x00100644 422c2b7ab3b3c668038da977e4e93a5fc623169c 0\tpkg/mod.py\x00`)).toEqual(['pkg/__init__.py'])
  })

  test('gatherFacts maps empty files, joins Python imports and resolves through tsconfig paths', async () => {
    const answers: [string, string][] = [
      ['*tsconfig*.json', 'tsconfig.json\0{ "compilerOptions": {\ntsconfig.json\0  "paths": { "@lib/*": ["./lib/*"] } // aliases\ntsconfig.json\0} }\n'],
      ['rev-parse HEAD', 'abc1234\n'],
      ['grep -z -c', 'lib/util.ts\x001\npkg/mod.py\x003\nsrc/a.ts\x001\ntsconfig.json\x003\n'],
      ['ls-files', '100644 e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 0\tpkg/__init__.py\0'],
      ['*.py', 'pkg/mod.py\x001\x00from . import (\npkg/mod.py\x002\x00    helper,\n'],
      ['*.ts', "src/a.ts\x001\x00import { u } from '@lib/util'\n"],
    ]
    const run = async (argv: readonly string[]) => ({ exitCode: 0, stdout: answers.find(([k]) => argv.join(' ').includes(k))?.[1] ?? '' })
    const facts = await gatherFacts(run, '/work')

    expect([...facts.lines]).toEqual([['lib/util.ts', 1], ['pkg/__init__.py', 0], ['pkg/mod.py', 3], ['src/a.ts', 1], ['tsconfig.json', 3]])
    expect(facts.edges).toEqual([{ from: 'src/a.ts', to: 'lib/util.ts' }, { from: 'pkg/mod.py', to: 'pkg/__init__.py' }])
  })

  test('counts, hits and log', () => {
    expect([...parseCounts('a.ts\x0012\nb.ts\x003\n')]).toEqual([['a.ts', 12], ['b.ts', 3]])
    expect(parseHits("a.ts\x004\x00import x from './b'\n")).toEqual([{ path: 'a.ts', text: "import x from './b'" }])
    expect(parseLog('\x1e\na.ts\nb.ts\n\x1e\nc.ts\n')).toEqual([['a.ts', 'b.ts'], ['c.ts']])
  })
})

describe('reach and history', () => {
  const graph = graphOf(FACTS.edges)

  test('reach walks importers hop by hop and remembers the chain', () => {
    const reach = reachOf(graph, ['src/util.ts'], 3)

    expect(reach.map(r => [r.path, r.hop])).toEqual([['src/core.ts', 1], ['src/app.ts', 2], ['test/core.test.ts', 2], ['src/far.ts', 3]])
    expect(chainOf(reach, 'src/far.ts')).toEqual(['src/util.ts', 'src/core.ts', 'src/app.ts', 'src/far.ts'])
  })

  test('history expects the file that usually changes alongside', () => {
    expect(expectedOf(FACTS.commits, ['src/util.ts'], p => FACTS.lines.has(p))).toEqual([{ path: 'test/core.test.ts', with: 'src/util.ts', together: 3, of: 4, lift: 4 }])
  })

  test('a file that changes in nearly every commit never rings, however often it joins this one', () => {
    const commits = [['a.ts', 'CHANGES.md'], ['a.ts', 'CHANGES.md'], ['a.ts', 'CHANGES.md'], ['b.ts', 'CHANGES.md'], ['c.ts', 'CHANGES.md']]

    expect(expectedOf(commits, ['a.ts'], () => true, 0.6, 3).map(e => e.path)).toEqual(['CHANGES.md'])
    expect(expectedOf(commits, ['a.ts'], () => true, 0.6, 3, 4)).toEqual([])
  })
})

describe('basemap and weather', () => {
  const units = unitsOf(FACTS)
  const named = parseBasemapReply(MODEL_REPLY, units)
  const map = finishBasemap('demo', FACTS, named!, 'model', '2026-10-02T00:00:00Z')

  test('every file lands in exactly one region, weights stay 1 to 10', () => {
    const find = regionFinder(map.regions)

    for (const file of FACTS.lines.keys()) expect(find(file)).toBeDefined()
    for (const r of map.regions) expect(r.weight >= 1 && r.weight <= 10).toBe(true)
  })

  test("a file no rule maps joins the region most of its folder's files are in", () => {
    const regions = [
      { id: 'core', name: 'Core', blurb: '', layer: 'quality', paths: ['tests/test_a.py', 'tests/test_b.py'], weight: 1 },
      { id: 'extra', name: 'Extra', blurb: '', layer: 'quality', paths: ['tests/test_c.py', 'examples/'], weight: 1 },
    ]
    const find = regionFinder(regions)
    const files = ['tests/test_a.py', 'tests/test_b.py', 'tests/test_c.py', 'examples/app.py']

    expect(folderRegion(find, files, 'tests/test_new.py')?.id).toBe('core')
    expect(folderRegion(find, files, 'tests/unit/test_deep.py')?.id).toBe('core')
    expect(folderRegion(find, files, 'docs/new.md')).toBeUndefined()
  })

  test('a kept map never grows a region: new files join the regions already there', () => {
    const lines = new Map([...FACTS.lines, ['uv.lock', 300], ['newpkg/a.ts', 12]])
    const grown = { ...FACTS, lines }
    const drawn = completeRegions(map.regions, map.layers, grown, graphOf(grown.edges))
    const kept = completeRegions(map.regions, map.layers, grown, graphOf(grown.edges), true)

    // drawing a map gathers the strays in a region of their own; keeping one places them in the frame as learned
    expect(drawn.some(r => r.id === 'everything-else')).toBe(true)
    expect(kept.map(r => r.id)).toEqual(map.regions.map(r => r.id))
    for (const file of lines.keys()) expect(regionFinder(kept)(file)).toBeDefined()
  })

  test('the weather names the change, its far reach and what history expected', () => {
    const w = weatherOf(map, FACTS, { kind: 'uncommitted', label: 'uncommitted' }, [{ path: 'src/util.ts', added: 5, deleted: 1, isNew: false, isDeleted: false }])

    expect(w.headline).toBe('1 file changed in Core.')
    expect(w.offshoots[0]?.path).toBe('src/far.ts')
    expect(w.lines.join(' ')).toContain('farthest Edge, 3 hops')
    expect(w.lines.join(' ')).toContain('History expects core.test.ts')
    expect(w.regions.core?.tags).toEqual(['CHANGED +5 −1', 'NO TESTS'])
  })

  test('the map is the same picture for the same size, and fills any size', () => {
    const files = [...FACTS.lines.keys()]
    const a = layoutOf(map, files, FACTS.lines, 70, 40)
    const b = layoutOf(map, files, FACTS.lines, 70, 40)

    expect(JSON.stringify(a.cells)).toBe(JSON.stringify(b.cells))
    for (const [cols, rows] of [[40, 20], [70, 40], [120, 60]] as const) {
      const layout = layoutOf(map, files, FACTS.lines, cols, rows)

      for (const { rect } of layout.cells) expect(rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= cols && rect.y + rect.h <= rows).toBe(true)
    }
  })

  test('the sheet holds the terminal to its limits: exact size, printable cells, at most 1000 colour pairs', () => {
    const w = weatherOf(map, FACTS, { kind: 'uncommitted', label: 'uncommitted' }, [{ path: 'src/util.ts', added: 5, deleted: 1, isNew: false, isDeleted: false }])

    for (const [cols, rows] of [[50, 30], [95, 60]] as const) {
      const grid = sheetOf({ repo: 'demo', map, files: [...FACTS.lines.keys()], lines: FACTS.lines, weather: w, layers: ALL_LAYERS }, cols, rows)

      expect(grid.cells.length).toBe(cols * rows)
      expect(grid.cells.every(c => codePointOf(c.glyph) !== 0x20 || c.glyph === ' ')).toBe(true)
      expect(new Set(grid.cells.map(c => `${c.fg},${c.bg}`)).size <= 1000).toBe(true)
    }
  })

  test('the change storms red and its reach rains green', () => {
    const w = weatherOf(map, FACTS, { kind: 'uncommitted', label: 'uncommitted' }, [{ path: 'src/util.ts', added: 5, deleted: 1, isNew: false, isDeleted: false }])
    const grid = sheetOf({ repo: 'demo', map, files: [...FACTS.lines.keys()], lines: FACTS.lines, weather: w, layers: ALL_LAYERS }, 95, 60)
    const painted = new Set(grid.cells.flatMap(c => [c.fg, c.bg]))

    expect(w.reach.length > 0).toBe(true)
    expect(PAPER_INKS.radar.slice(STORM).some(c => painted.has(c))).toBe(true)
    expect(PAPER_INKS.rain.slice(1).some(c => painted.has(c))).toBe(true)
  })

  test('Claude Code paints 256 colours inside tmux and wherever COLORTERM never says truecolor', () => {
    expect(colorsOf({ COLORTERM: 'truecolor' })).toBe('truecolor')
    expect(colorsOf({ COLORTERM: 'truecolor', TMUX: '/tmp/tmux-1/default,1,0' })).toBe('256')
    expect(colorsOf({ TERM: 'xterm-kitty' })).toBe('truecolor')
    expect(colorsOf({ TERM: 'xterm-ghostty' })).toBe('truecolor')
    expect(colorsOf({ TERM_PROGRAM: 'iTerm.app' })).toBe('truecolor')
    expect(colorsOf({ COLORTERM: '24bit' })).toBe('256')
    expect(colorsOf({ TERM: 'xterm-256color', TERM_PROGRAM: 'WezTerm' })).toBe('256')
  })

  test('in 256 colours the cream paper turns yellow, and the 256 inks show as they are named', () => {
    // 0xffeedd lands on xterm 230, 0xffffd7, either way: the yellow a 256-colour terminal shows for the cream
    expect(xtermOf(PAPER_INKS.paper)).toBe(230)
    expect(roundedXtermOf(PAPER_INKS.paper)).toBe(230)
    const lightness = (c: number) => 0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255)

    for (const inks of [PAPER_INKS_256, NIGHT_INKS_256]) {
      // rounded or matched to its nearest, every ink lands on the same xterm colour
      const all = [...inks.radar, ...inks.line, ...inks.rain, ...inks.rainLine, ...Object.values(inks).flatMap(v => (typeof v === 'number' ? [v] : typeof v === 'object' && 'fg' in v ? [v.fg, v.bg] : []))]

      expect(all.filter(c => xtermOf(c) !== roundedXtermOf(c))).toEqual([])
      for (const [ramp, line] of [[inks.radar, inks.line], [inks.rain, inks.rainLine]] as const) {
        // every bin keeps its own name, so the sheet can tell them apart where they show alike
        expect(new Set(ramp).size).toBe(ramp.length)
        const shown = ramp.map(c => lightness(shown256(c)))
        const isDarkening = shown.every((l, k) => k === 0 || (inks.isNight ? l >= shown[k - 1]! : l <= shown[k - 1]!))

        expect(isDarkening).toBe(true)
        // each hairline shows apart from the bin it crosses, short of the core's own colour
        const core = shown256(ramp[ramp.length - 1]!)

        ramp.forEach((c, k) => expect(shown256(c) === core || shown256(line[k]!) !== shown256(c)).toBe(true))
      }
      // the rain shares only the dry ground with the storm, so a painted colour names its bin
      expect(inks.rain.slice(1).filter(c => inks.radar.includes(c))).toEqual([])
    }
    expect(shown256(PAPER_INKS_256.paper)).toBe(0xffffff)
  })

  test('wrap keeps to the width and ends a cut with an ellipsis', () => {
    expect(wrap('one two three four five six', 9, 2)).toEqual(['one two', 'three fo…'])
  })
})
