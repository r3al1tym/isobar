# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [0.2.0] — 2026-10-02

The first public release. (0.1 was an internal preview.)

### Added
- **The pane.** A framed weather chart docked beside the conversation: a storm on each file the session changed, rain on the files that use what changed, a dotted track to the farthest file the change reaches, and badges on region names: `CHANGED +a −d`, `NO TESTS`, `UNASKED` and `EXPECTED`.
- **Reach by declaration.** Each edit is read function by function, class by class: a new signature or a new behaviour rains on the files that depend on the changed file and name what it touched (or a function in the same file that calls it); an edit to comments or imports stays dry. The edit's note says `new behaviour · 9 uses in 4 files`. A file isobar cannot read by declaration rains on every importer, three hops out.
- **This turn against the session.** The latest turn's edits burn brightest and earlier turns fade; the title counts the latest turn's files against the rest.
- **The scope check** (`scope`, off by default). After each turn that changes files, `scopeModel` (default `haiku`) compares your requests with the turn's diff and marks each change nobody asked for `UNASKED`, with a few words on what it did.
- **A basemap per repository.** Named once by the session's own model (or `mapModel`) from paths, sizes and imports, kept across sessions, shareable as `.isobar/map.json`, redrawn with `/isobar map`. New files join the regions already there, so the frame never grows or moves.
- **An import graph that follows the build.** Relative imports, `tsconfig` paths and `baseUrl`, workspace packages by name, `package.json` `#imports`, and Python 3 modules, multi-line imports included.
- **History's rings** (off until `4`). Files that changed with these in most past commits, four times more often than they change at all, and sit outside this change.
- **The map follows the edit.** An Edit or Write in another repository switches the pane to that repository's map; a Bash command keeps the map it has.
- **Keys.** `1` to `4` toggle the layers, `p` asks Claude to check the farthest reach, `m` redraws the map.
- **Grounds and colours.** Warm paper by default, `night` for the terminal's near-black, `auto` to follow the Claude Code theme; 256-colour terminals get inks drawn from xterm's own palette on white paper, and `colors` pins the choice.
- **bench/.** Speed and accuracy on six public repositories (express, excalidraw, vite, vscode, flask, django), against the TypeScript compiler, grimp and jedi.
