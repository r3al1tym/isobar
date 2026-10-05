# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.0] - 2026-10-05

A weather map for every change: the change storms red, its reach rains green, and each changed region says in a few words what the change did there.

### Added
- **The gist** (`gist`, on by default). When a session starts, after each turn that changes files, and when the pane shows a commit, `smallModel` reads each changed region's diff (every uncommitted edit, including ones made before the session, or the last commit on a clean tree) and captions what the change does there in a few words, under the region's name. It never sees your requests, so the caption is the diff's own account.

### Changed
- **Two hues, as on a radar.** The reach rains sage green, apart from the change's red storm, so what changed and what it touches read apart at a glance. Night and 256-colour terminals get their own green ramps.
- **`scopeModel` is now `smallModel`**, shared by the gist and the scope check, and defaults to `sonnet`. A value set for `scopeModel` under 0.2 is not carried over: set `smallModel` again with `/plugin configure isobar@isobar`.
- **`NO TESTS` reads the test.** A changed test now covers an edit when its new lines name what the edit touched or a name the edit introduced (a new config key, a new helper), as well as when it imports the file or shares its name.
- **Labels tell files apart.** A note or the track names a file by as much of its path as tells it from the others on the pane, such as `sansio/app.py` beside `flask/app.py`.
- **Crowded regions keep their shape.** A region carrying many edits pools them into one storm that keeps its eyes and bands, instead of filling flat.
- **A new file lands beside its folder.** A file the session created that no region's rule names joins the region holding most of its folder's files, where it used to fall into the map's last region.
- **A long dry name wraps.** A dry region whose name is too long for one line names it on two, where it used to be left blank.
- **Muted ink holds on light rain.** Muted text steps darker only once the rain under it deepens, so captions and reached names keep one tone.
- **A map the model could not name is kept for the session only.** A failed basemap call draws folders for this session, says so on the frame (`folders only · /isobar map retries`), and the next session asks the model again.
- **Files a command creates join the change.** An untracked file that was not there when the session first looked counts as the session's, whether the Write tool or a shell command made it.
- **The gist and the scope check read new files.** An untracked file's content goes in as its diff, inside the same 400-line budget.

### Fixed
- **Large repositories are read whole.** git's output is streamed, so a repository past 4 MiB of grep output no longer loses files from the map.
- **Repositories with no commits, or one.** The change is measured from the empty tree, so staged files in a new repository and a first commit show as added.
- **A dirty submodule no longer blanks the turns.** A path git cannot hash costs only its own hash, and a submodule with local edits but an unmoved pointer is not part of the change.
- **Diffs are read by their headers only.** A removed `-- ` comment line, a file name with a space, and a deleted file each keep their own diff in the gist and the scope check.
- **Every band keeps a place in a short pane.** A map of up to six bands shrinks its bands instead of dropping the last ones, and a pane too small for any map says so instead of cutting it.
- **`/isobar map` during a refresh redraws the map**, and the scope check reads the turn that ended even when the next prompt starts while it waits.
- **An edit through a symlinked checkout counts as the session's**, by where the file really lands.
- **Paths with non-ASCII names** join the history layer and the map's coupling.
- **A `.isobar/map.json` of the wrong shape** is set aside with a note on the frame instead of breaking the pane.

### Security
- **git never writes the index.** Every `diff` runs with `diff.autoRefreshIndex=false`, so a refresh after an edit can no longer take `.git/index.lock` from under Claude's next `git add` or `git commit`.
- **Repository strings are data.** The `p` key's question quotes every path and the region's name; a shared `.isobar/map.json` is clipped as a model answer is; captions and scope notes are cut to 40 characters; the desktop, VS Code and mobile surfaces draw them as plain text, never as markdown.
- **The terminal pane drops bidi controls, zero-width characters and loose combining marks.**
- **The colour probe reads four variables** from the environment Claude Code started with, instead of the whole environment.

## [0.2.0] - 2026-10-02

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

[Unreleased]: https://github.com/r3al1tym/isobar/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/r3al1tym/isobar/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/r3al1tym/isobar/releases/tag/v0.2.0
