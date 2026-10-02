# isobar benchmarks

Machine: Intel(R) Core(TM) Ultra 7 265H, 16 logical CPUs, 43 GB, Ubuntu 24.04.5 LTS, Linux 6.18.33.2-microsoft-standard-WSL2; Node 24.14.0, git version 2.43.0, Claude Code 2.1.287.

| repo | files (mapped) | edges | facts ms | weather ms | sheet ms | model map s | import precision / recall | dependents error (median, differ) | EXPECTED coverage / precision / recall / false alarms |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| express | 214 (211) | 153 | 29 | 0.2 | 4.3 | – | 1.000 / 1.000 | 0.000 (0/20) | 0.25 / 0.79 / 0.15 / 0.13 |
| excalidraw | 1308 (1018) | 3698 | 83 | 2.6 | 10 | – | 0.997 / 0.999 | 0.017 (17/20) | 0.34 / 0.38 / 0.07 / 0.44 |
| vite | 2841 (2736) | 2232 | 90 | 1.5 | 15 | 48.4 | 0.946 / 0.998 | 0.000 (0/20) | 0.32 / 0.62 / 0.13 / 0.33 |
| vscode | 19916 (19547) | 135968 | 1322 | 61 | 238 | – | 0.999 / 1.000 | 0.000 (9/20) | 0.47 / 0.47 / 0.10 / 0.44 |
| flask | 236 (230) | 195 | 44 | 0.2 | 2.8 | – | 0.960 / 1.000 | 0.000 (0/20) | 0.36 / 0.58 / 0.16 / 0.36 |
| django | 7083 (5675) | 10157 | 413 | 2.0 | 20 | 36 | 0.919 / 1.000 | 0.000 (2/20) | 0.16 / 0.46 / 0.04 / 0.14 |

## Import graph: where isobar and the compiler disagree

### express (typescript 5.9.3)

- Misses: none
- False edges: none
- Dependents: all 20 match.

### excalidraw (typescript 5.9.3)

- Misses (1 edges the compiler has and isobar lacks):
  - 1 × an import isobar's line pattern does not match (a template literal, or a comment between `import(` and the string). Example: `excalidraw-app/components/TopErrorBoundary.tsx → '../bug-issue-template' (compiler: excalidraw-app/bug-issue-template.js, isobar: excalidraw-app/bug-issue-template.js)`
- False edges (11 isobar edges the compiler lacks):
  - 11 × a workspace package the compiler cannot resolve without node_modules links. Example: `dev-docs/src/theme/ReactLiveScope/index.js → '@excalidraw/excalidraw' (isobar: packages/excalidraw/index.tsx)`
- Dependents: 17 of 20 differ; furthest `packages/common/src/index.ts`, 536 by the compiler, 545 by isobar.
- Left out of both graphs: 17 workspace-package specifiers the compiler cannot resolve without node_modules links; 319 relative specifiers it cannot resolve (.woff2 230, .scss 85, .css 4); 90 isobar edges to or from files the compiler does not resolve (.scss 85, .css 4, .ts 1).

### vite (typescript 5.9.3)

- Misses (4 edges the compiler has and isobar lacks):
  - 2 × an import isobar's line pattern does not match (a template literal, or a comment between `import(` and the string). Example: `playground/dynamic-import/nested/index.js → '../nested/static.js' (compiler: playground/dynamic-import/nested/static.js, isobar: playground/dynamic-import/nested/static.js)`
  - 1 × isobar resolves the specifier to another file. Example: `packages/vite/src/node/ssr/__tests__/fixtures/errors/syntax-error-dep.js → './syntax-error.js' (compiler: packages/vite/src/node/ssr/__tests__/fixtures/errors/syntax-error.ts, isobar: packages/vite/src/node/ssr/__tests__/fixtures/errors/syntax-error.js)`
  - 1 × a file off isobar's file list: a symlink, which `git grep` never reads. Example: `playground/ssr-wasm/src/direct-light.js → './imports.js' (compiler: playground/ssr-wasm/src/imports.js)`
- False edges (106 isobar edges the compiler lacks):
  - 96 × a workspace package the compiler cannot resolve without node_modules links. Example: `packages/vite/src/node/__tests__/fixtures/config/entry/vite.config.import-attributes.ts → 'vite/package.json' (isobar: packages/vite/package.json)`
  - 8 × matched text the compiler does not read as an import (inside a string or template, or a method called `import`). Example: `packages/vite/src/node/__tests__/environment.spec.ts → '@vitejs/test-dep-conditions' (isobar: packages/vite/src/node/__tests__/fixtures/test-dep-conditions/index.default.js)`
  - 1 × the compiler finds no file for the specifier. Example: `packages/vite/src/node/__tests__/fixtures/config/native-compat/json-extensionless/vite.config.js → './foo' (isobar: packages/vite/src/node/__tests__/fixtures/config/native-compat/json-extensionless/foo.json)`
- Dependents: all 20 match.
- Left out of both graphs: 266 workspace-package specifiers the compiler cannot resolve without node_modules links; 245 relative specifiers it cannot resolve (.css 114, .svg 37, (none) 18); 271 isobar edges to or from files the compiler does not resolve (.css 116, .ts 74, .svg 37).

### vscode (typescript 5.9.3)

- Misses: none
- False edges (22 isobar edges the compiler lacks):
  - 22 × matched text the compiler does not read as an import (inside a string or template, or a method called `import`). Example: `extensions/copilot/.esbuild.mts → './src/util/common/test/shims/vscodeTypesShim.ts' (isobar: extensions/copilot/src/util/common/test/shims/vscodeTypesShim.ts)`
- Dependents: 9 of 20 differ; furthest `extensions/copilot/src/util/common/test/shims/vscodeTypesShim.ts`, 1749 by the compiler, 1752 by isobar.
- Left out of both graphs: 1502 relative specifiers it cannot resolve (.css 754, .js 477, (none) 238); 756 isobar edges to or from files the compiler does not resolve (.css 732, .ts 5, .ps1 2).

### flask (grimp 3.17)

- Misses: none
- False edges (4 isobar edges the grimp graph lacks):
  - 4 × a line that is no import statement (inside a docstring or string). Example: `src/flask/app.py:126 → 'from flask import Flask' (isobar: src/flask/__init__.py)`
- Dependents: all 20 match.
- Compared within the 24 files grimp sees as modules, with flask.sansio added (a folder without __init__.py, which grimp skips by default).

### django (grimp 3.17)

- Misses: none
- False edges (286 isobar edges the grimp graph lacks):
  - 282 × the package itself, for `from pkg import submodule`. Example: `django/__main__.py:7 → 'from django.core import management' (isobar: django/core/__init__.py)`
  - 4 × a line that is no import statement (inside a docstring or string). Example: `django/contrib/gis/utils/ogrinspect.py:77 → 'from django.contrib.gis.utils import ogrinspect' (isobar: django/contrib/gis/utils/__init__.py)`
- Dependents: 2 of 20 differ; furthest `django/core/exceptions.py`, 611 by the compiler, 612 by isobar.
- Compared within the 907 files grimp sees as modules.

## Reach by declaration

Rain is the files the weather reaches as a share of the mapped files, per commit: v0.1 every importer up to 3 hops, v0.2 the users of what changed and the files on their import chains. P / R are isobar's users (`uses > 0`) against the files that reference a touched declaration, then also the same-file callers isobar propagated to; exact is changed files where the set matches the direct truth.

| repo | commits (files read) | comments / imports / body / signature / file | rain v0.1 → v0.2, median (p90) | users P / R, direct | users P / R, + propagated | exact | readChange ms median / p95 |
|---|--:|--:|--:|--:|--:|--:|--:|
| express | 60 (141) | 9% / 28% / 15% / 6% / 42% | 44.59% (47.6%), 96.5 files → 0.00% (0.5%), 0 files | 0.333 / 0.833 | 0.467 / 0.875 | 17 / 27 | 29 / 43 |
| excalidraw | 60 (236) | 1% / 3% / 42% / 26% / 28% | 39.46% (46.4%), 351.5 files → 0.94% (34.7%), 9 files | 0.624 / 0.952 | 0.737 / 0.949 | 90 / 159 | 136 / 488 |
| vite | 60 (150) | 11% / 1% / 31% / 11% / 46% | 5.10% (5.7%), 136.5 files → 0.04% (0.9%), 1 files | 0.549 / 0.957 | 0.716 / 0.967 | 45 / 63 | 89 / 147 |
| vscode | 30 (157) | 2% / 0% / 22% / 26% / 50% | 0.34% (6.0%), 65.5 files → 0.06% (0.5%), 11.5 files | 0.211 / 0.967 | 0.248 / 0.972 | 30 / 67 | 276 / 1306 |
| flask | 60 (130) | 17% / 2% / 42% / 32% / 7% | 28.51% (31.6%), 67 files → 0.42% (6.6%), 1 files | 0.602 / 0.980 | 0.605 / 0.980 | 44 / 70 | 124 / 152 |
| django | 30 (66) | 3% / 0% / 42% / 55% / 0% | 1.04% (17.8%), 59 files → 0.04% (0.4%), 2.5 files | 0.849 / 0.903 | 0.857 / 0.904 | 16 / 26 | 174 / 250 |

### express

- Users the direct truth lacks (10):
  - 7 × names only a propagated caller's word, which there means another declaration. Example: `26801a0a lib/application.js → lib/express.js ('handle')`
  - 2 × a caller in the same file that isobar propagated to (words, two calls deep). Example: `2f64f68c lib/utils.js → lib/application.js ('compileQueryParser')`
  - 1 × names the word as a member of a value the language server cannot type: it cannot say whose it is. Example: `8cb53ea5 lib/application.js → lib/express.js ('handle')`
- Direct references isobar misses (1):
  - 1 × in reach and named, yet not a user. Example: `26801a0a lib/application.js → test/exports.js ('set')`
- References to propagated callers isobar misses (0): none

### excalidraw

- Users the direct truth lacks (287):
  - 112 × another declaration with the same name: a common word matched as text. Example: `00ae4558 excalidraw-app/collab/Collab.tsx → excalidraw-app/App.tsx ('startCollaboration')`
  - 86 × a caller in the same file that isobar propagated to (words, two calls deep). Example: `531f3e55 packages/element/src/elbowArrow.ts → packages/element/src/binding.ts ('updateElbowArrowPoints')`
  - 63 × names only a propagated caller's word, which there means another declaration. Example: `f55ecb96 packages/excalidraw/components/App.tsx → examples/with-script-in-browser/index.tsx ('render')`
  - 24 × names the word as a member of a value the language server cannot type: it cannot say whose it is. Example: `5fffc474 packages/excalidraw/components/main-menu/MainMenu.tsx → dev-docs/src/theme/ReactLiveScope/index.js ('MainMenu')`
  - 2 × imports the touched name from the changed file, yet the language server links none of its uses to it. Example: `a0e93b60 packages/excalidraw/components/App.tsx → packages/excalidraw/actions/actionExport.tsx ('sessionExportThemeOverride')`
- Direct references isobar misses (24):
  - 14 × in reach and named, yet not a user. Example: `b552c607 packages/element/src/linearElementEditor.ts → packages/excalidraw/actions/actionFinalize.tsx ('LinearElementEditor')`
  - 10 × named only on import lines (re-exported, or imported and used under another name). Example: `5fffc474 packages/excalidraw/actions/types.ts → packages/excalidraw/actions/shortcuts.ts ('ActionName')`
- References to propagated callers isobar misses (6):
  - 4 × in reach and named, yet not a user. Example: `3004c642 packages/element/src/fractionalIndex.ts → packages/element/src/store.ts ('syncInvalidIndicesImmutable')`
  - 2 × referenced under another name (an alias or a computed access), never by a touched word. Example: `2874f9e4 packages/excalidraw/components/canvases/InteractiveCanvas.tsx → packages/excalidraw/components/canvases/index.tsx ('getRelevantAppStateProps')`

### vite

- Users the direct truth lacks (92):
  - 34 × a caller in the same file that isobar propagated to (words, two calls deep). Example: `63198271 packages/vite/src/node/optimizer/index.ts → packages/vite/src/node/optimizer/optimizer.ts ('loadCachedDepOptimizationMetadata')`
  - 25 × names only a propagated caller's word, which there means another declaration. Example: `e72036ee packages/vite/src/node/server/bundledDev.ts → packages/vite/src/node/__tests__/dev.spec.ts ('listen')`
  - 18 × another declaration with the same name: a common word matched as text. Example: `41c46589 packages/vite/src/node/server/bundledDev.ts → packages/vite/src/node/__tests__/dev.spec.ts ('listen')`
  - 15 × names the word as a member of a value the language server cannot type: it cannot say whose it is. Example: `41c46589 packages/vite/src/node/server/bundledDev.ts → packages/vite/src/node/__tests__/http.spec.ts ('listen')`
- Direct references isobar misses (5):
  - 4 × in reach and named, yet not a user. Example: `55bba7bb packages/vite/src/node/config.ts → packages/vite/src/node/__tests__/build.spec.ts ('resolveConfig')`
  - 1 × named only on import lines (re-exported, or imported and used under another name). Example: `eac0cc84 packages/vite/src/node/constants.ts → packages/vite/src/node/plugins/html.ts ('BUNDLED_DEV_CLIENT_FILENAME')`
- References to propagated callers isobar misses (0): none

### vscode

- Users the direct truth lacks (885):
  - 451 × another declaration with the same name: a common word matched as text. Example: `cfce2d16 src/vs/workbench/contrib/chat/browser/widget/chatContentParts/chatProgressContentPart.ts → src/vs/workbench/test/browser/componentFixtures/chat/chatWidget.fixture.ts ('responseComplete')`
  - 386 × names only a propagated caller's word, which there means another declaration. Example: `cfce2d16 src/vs/workbench/contrib/chat/browser/widget/chatWorkingLogo.ts → src/vs/sessions/contrib/chat/browser/newChatVoice.ts ('setActive')`
  - 41 × a caller in the same file that isobar propagated to (words, two calls deep). Example: `ae20a785 src/vs/workbench/contrib/terminal/browser/terminalInstance.ts → src/vs/workbench/contrib/terminal/browser/terminalInstanceService.ts ('TerminalInstance')`
  - 7 × names the word as a member of a value the language server cannot type: it cannot say whose it is. Example: `15013c0f src/vs/platform/agentHost/node/copilot/copilotSessionLauncher.ts → src/vs/platform/agentHost/test/node/copilotAgent.test.ts ('launch')`
- Direct references isobar misses (8):
  - 8 × in reach and named, yet not a user. Example: `d7ab01a2 src/vs/platform/agentHost/common/state/protocol/channels-automation/state.ts → src/vs/platform/agentHost/common/state/protocol/common/commands.ts ('AutomationSessionTemplate')`
- References to propagated callers isobar misses (0): none
- Files left out of the comparison: 1 timed out.

### flask

- Users the direct truth lacks (132):
  - 61 × another declaration with the same name: a common word matched as text. Example: `8646edca src/flask/sessions.py → src/flask/app.py ('save_session')`
  - 55 × names the word as a member of a value the language server cannot type: it cannot say whose it is. Example: `8646edca src/flask/sessions.py → src/flask/testing.py ('save_session')`
  - 14 × names a touched word only in a comment or a string. Example: `0ec7f713 src/flask/sansio/app.py → src/flask/json/tag.py ('session_interface')`
  - 1 × a caller in the same file that isobar propagated to (words, two calls deep). Example: `84e11a1e src/flask/scaffold.py → src/flask/app.py ('find_package')`
  - 1 × imports the touched name from the changed file, yet the language server links none of its uses to it. Example: `eca5fd1d src/flask/helpers.py → src/flask/sansio/app.py ('redirect')`
- Direct references isobar misses (4):
  - 4 × in reach and named, yet not a user. Example: `726d3f4f src/flask/__init__.py → src/flask/cli.py ('__version__')`
- References to propagated callers isobar misses (0): none

### django

- Users the direct truth lacks (53):
  - 23 × another declaration with the same name: a common word matched as text. Example: `57c8c8b1 django/contrib/admin/options.py → django/contrib/contenttypes/admin.py ('get_formset')`
  - 15 × names the word as a member of a value the language server cannot type: it cannot say whose it is. Example: `57c8c8b1 django/contrib/admin/options.py → django/contrib/admin/actions.py ('delete_confirmation_max_display')`
  - 11 × names a touched word only in a comment or a string. Example: `8d1c6734 django/db/models/base.py → django/contrib/admin/sites.py ('Model')`
  - 3 × a caller in the same file that isobar propagated to (words, two calls deep). Example: `b5b53afa django/views/decorators/csp.py → django/views/debug.py ('csp_override')`
  - 1 × imports the touched name from the changed file, yet the language server links none of its uses to it. Example: `189c2d2c django/core/serializers/jsonl.py → tests/serializers/test_deserialization.py ('Deserializer')`
- Direct references isobar misses (32):
  - 30 × in reach and named, yet not a user. Example: `8d1c6734 django/db/models/base.py → django/contrib/admin/checks.py ('Model')`
  - 2 × used without importing the changed file: through an instance, a type or a global. Example: `142b881c django/middleware/cache.py → django/utils/decorators.py ('process_response')`
- References to propagated callers isobar misses (0): none
- Files left out of the comparison: 6 timed out.

## The frame

Basemaps drawn by `claude -p --model opus`, 3 at the pinned commit and one a year earlier (bench/frame.mts). ARI is the adjusted Rand index over every file's region: 1 is the same grouping, 0 is chance. The year-old map is kept and completed at the pinned commit, as the pane keeps a map, and compared with each fresh draw; layout IoU is how much of each region's rectangle stays put once the year's new files join it, and resize IoU the same across pane sizes.

| repo | files | regions per draw | redraw ARI | a year-old map: files then → now, kept vs fresh ARI, layout IoU | resize IoU, lowest |
|---|--:|--:|--:|--:|--:|
| excalidraw | 1018 | 16, 19, 16 | 0.96–0.98 | 860 → 1018, 0.93–0.94, 1 | 0.99 |
| vite | 2736 | 14, 12, 12 | 0.54–0.87 | 2350 → 2736, 0.53–0.9, 1 | 0.99 |
| flask | 230 | 15, 14, 13 | 0.89–0.97 | 228 → 230, 0.92–0.97, 1 | 0.99 |

## How it was measured

- Edges are what `gatherFacts` finds. Times are the median of 5 runs after one warm-up, in one Node process, on warm git caches; weather and sheet are for the HEAD commit's own change over a heuristic basemap. The laptop was running other work: the 1-minute load average was 2.6 when the timings started.
- The model map is one `claude -p --model opus` call fed `basemapPrompt` on stdin, as scripts/preview.ts asks, timed through `parseBasemapReply` and `finishBasemap`: one sample per repo, so it moves with model load. `claude -p` alone took 10.5 s to answer one word here (median of 3); the mod asks through `$.model.complete` and skips that start-up. vite: 120 units in the prompt, 11 regions back; django: 28 units in the prompt, 8 regions back. Replies are kept in `results/model-map-<repo>.txt`.
- Files are tracked files, with the files isobar maps in brackets: every text file (`git grep -I -c -e ''`) and the empty JavaScript, TypeScript and Python files an import can name. Binary files, symlinks and other empty files stay off the map.
- JS/TS ground truth: `ts.preProcessFile` + `ts.resolveModuleName` with the nearest tsconfig.json or jsconfig.json, with `allowJs` and `resolveJsonModule` forced on so a .js or .json target counts. Sources are tracked .ts/.tsx/.js/.jsx/.mjs/.cjs/.mts/.cts files minus .d.ts and *.min.js; targets are the same plus .json. No directory is skipped. Clones are blobless with no node_modules, so a workspace package resolves only where tsconfig `paths` maps it.
- Python ground truth: grimp, both ends inside the package. grimp records `from pkg import submodule` as an import of the submodule only, so isobar's extra edge to `pkg/__init__.py` counts as false even though Python runs that file.
- "dependents error" is the median of |isobar − compiler| / compiler over `dependentsOf` for the 20 files the compiler graph says are imported most, then how many of the 20 differ at all.
- Reach by declaration (bench/uses.mts): per repo a seeded sample of the latest 300 non-merge commits touching 1 to 15 JS/TS or Python files (60, fewer where the table says), each read in a detached worktree. Truth for JS/TS is the TypeScript language service's `findReferences` over the nearest tsconfig or jsconfig (allowJs on), widened by the files isobar's graph says depend on the changed file; for Python, jedi's `get_references` over the repo. A file counts when it references a touched declaration outside its imports. Searches over 20 s leave their file out. readChange is timed once after a warm-up call that fetches the parent commit's blobs.
- EXPECTED backtest: the latest 300 non-merge commits touching 2 to 40 files; history is the 400 non-merge commits before each (bulk commits over 40 files dropped); half the files given, half hidden, by a seeded shuffle; `expectedOf(history, given, () => true, 0.6)`, top 3; mean over seeds 1, 2, 3. Coverage: share of commits flagged. Precision: flags that were hidden files. Recall: hidden files flagged. False alarms: share of complete commits (every file given) that still get a flag.

## Repositories

- express: https://github.com/expressjs/express at `7ef98448f8b38099ab1ded55e458538ad47a51e7`
- excalidraw: https://github.com/excalidraw/excalidraw at `ed10ac7dca7e40f3f4a31269b4bfba980d0db41e`
- vite: https://github.com/vitejs/vite at `10033218d239c927cdc375970b5741cce408e81b`
- vscode: https://github.com/microsoft/vscode at `e4685335361dd89ac2b84e47ecc64e2842fd52a9`
- flask: https://github.com/pallets/flask at `d73fa1cdcbd8b1465c151db8924ba58b1dd14e35`
- django: https://github.com/django/django at `0ae93a02e55ec42dfde251fc5500b3ec617a4200`
