# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **The gist** (`gist`, on by default). Once a turn that changes files ends, `smallModel` reads each changed region's diff and captions what the change does there in a few words, under the region's name. It never sees your requests, so the caption is the diff's own account.

### Changed
- **Two hues, as on a radar.** The reach rains sage green, apart from the change's red storm, so what changed and what it touches read apart at a glance. Night and 256-colour terminals get their own green ramps.
- **`scopeModel` is now `smallModel`**, shared by the gist and the scope check, and defaults to `sonnet`.
- **`NO TESTS` reads the test.** A changed test now covers an edit when its new lines name what the edit touched or a name the edit introduced (a new config key, a new helper), as well as when it imports the file or shares its name.
- **Labels tell files apart.** A note or the track names a file by as much of its path as tells it from the others on the pane, such as `sansio/app.py` beside `flask/app.py`.
- **Crowded regions keep their shape.** A region carrying many edits pools them into one storm that keeps its eyes and bands, instead of filling flat.
- **A new file lands beside its folder.** A file the session created that no region's rule names joins the region holding most of its folder's files, where it used to fall into the map's last region.
- **Muted ink holds on light rain.** Muted text steps darker only once the rain under it deepens, so captions and reached names keep one tone.

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
