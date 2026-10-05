# isobar

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![version](https://img.shields.io/badge/version-0.3.0-informational)](CHANGELOG.md)
![Claude Code mod](https://img.shields.io/badge/Claude%20Code-mod-d97757.svg)
[![CI](https://github.com/r3al1tym/isobar/actions/workflows/ci.yml/badge.svg)](https://github.com/r3al1tym/isobar/actions/workflows/ci.yml)

> **A weather map for every change your agent makes, from a broad refactor to a one-line fix. See where it landed, what it did there and what else it reaches, on a map of your repo that stays the same from session to session.**

isobar is a [Claude Code](https://claude.com/claude-code) mod (a plugin built on Claude Code's early-access function hooks, which let it draw its own pane) that docks a pane beside the conversation. Read it like a weather radar: a red storm on the code that changed, a few words under each changed region on what the change did there, and green rain on the code that uses it. You see the shape of a change before you read its diff, and a part you did not expect it to reach stands out at once. Read the diff for the lines; read the pane for where they landed and what they touch.

The change is everything uncommitted against HEAD, your own edits included, plus files created during the session; on a clean tree, the last commit.

![Claude Code with the isobar pane docked on the right, over a map of Flask. Over two turns, Claude changed get_debug_flag in helpers.py and added a CHANGES.rst entry, then changed Flask.make_response in app.py. The latest edit burns deepest: the caption under app assembly reads names endpoint in error, the edit's note reads new behaviour · 11 uses in 3 files, green rain marks the files that use it, and a dotted track runs to test_basic.py two hops away. The first turn's edits have faded, captioned treats off as false under utilities & debugging and notes the off debug value under project tooling, where CHANGES.rst carries UNASKED because no request mentioned the changelog](docs/pane.png)

Watch it work in a 26-second film: [isobar.mp4](https://github.com/r3al1tym/isobar/releases/download/v0.3.0/isobar.mp4).

The rain is selective. Across 300 recent commits in six public repositories, the median commit rains on 0 to 12 files where marking every importer within three hops would mark 59 to 352, and it still covers 88 to 98 percent of the files a language server (TypeScript's `findReferences`, or [jedi](https://github.com/davidhalter/jedi) for Python) says use the change. [Accuracy](#accuracy) has the precision and the misses.

## Quick start

You need Claude Code 2.1.287 or later, run interactively in a terminal, inside a git repository.

```bash
claude plugin marketplace add r3al1tym/isobar
claude plugin install isobar@isobar
```

1. Start a new `claude` session in your repository. A session that was already running does not load the mod.
2. Ask Claude for a change, or start in a tree that already has uncommitted changes. The first time in a repository, isobar draws its map with one model call, which takes under a minute. Then the pane opens beside the conversation, once the terminal is 144 columns or wider: at session start on a tree with changes, otherwise on Claude's first edit.
3. At any width, `/isobar` opens the pane and focuses it, so its number keys toggle layers. A pane that opened by itself leaves focus on the prompt: press ctrl+x then Tab, or click it, to focus it. Esc returns focus to the prompt.

To hand the setup to your coding agent, paste the prompt below. An agent reading this page should follow [AGENTS.md](AGENTS.md): checks, settings, verification and troubleshooting, each with exact commands and expected output.

```text
Set up the isobar Claude Code plugin by following https://raw.githubusercontent.com/r3al1tym/isobar/main/AGENTS.md. Ask me before changing any setting, verify the install, then tell me how to open the pane.
```

## What it shows

- **Where the change landed.** A storm on each changed file, in its region of the map. You see at a glance whether the work landed where you expected.
- **What it did there (the gist).** Once a turn ends, and when a session starts on a change, `smallModel` (Sonnet by default) reads the diff of each changed region and captions it under the region's name in 2 to 4 words, such as `names endpoint in error` and `treats off as false` in the picture above. The caption is the diff's own account, written without your requests, so you can set it against what you meant.
- **What it reaches.** Green rain on the files that use what changed. isobar reads each edit declaration by declaration: a new signature or a new behaviour rains on the files that name it, and an edit to comments or imports stays dry. The note beside the riskiest edits (two at most, unasked ones first) says how far each reaches, as in `new behaviour · 11 uses in 3 files`.
- **This turn against the session.** The latest turn's edits burn brightest and earlier turns fade, so a long session still reads in one look.
- **What you never asked for.** Turn on the scope check and, after each turn that changes files, `smallModel` (Sonnet by default) compares your requests with the turn's diff. An edit nobody asked for carries `UNASKED` and a few words on what it did.
- **The same frame every time.** Each repository is cut into named regions once and kept as its basemap. Every change lands on the same map, so you learn to read a change by where it falls.

## Reading the map

![The pane with its parts called out: the title, the storm on the edited files, badges on region names, the caption under a changed region, the edit's note, rain on the files that use the change, the dotted track to the farthest file, an earlier turn's faded edit, an unasked edit, and the map's regions, sized by code and by how much depends on them](docs/anatomy.png)

- **Title.** The repository, then how many files the latest turn changed against the rest of the session (`1 this turn · 2 earlier`), or `last commit <hash>` when nothing is uncommitted.
- **Storm.** Each edited file is an eye in its region (up to eight, latest turn and riskiest first). The storm is deepest where the change is riskiest: a big edit to widely used code with no test moved beside it. Only the latest turn's riskiest edit reaches the deepest reds.
- **Badges.** The region's name carries `CHANGED +a −d`, `NO TESTS` when source code changed what it does and no test moved with it, `UNASKED` when the scope check flagged an edit, and, with history on (key `4`), `EXPECTED` on a region where a dashed ring marks a file history says should have changed. A changed test counts when it imports the file, shares its name, or its new lines name what the edit touched or introduced, such as a new config key.
- **Caption.** Under a changed region's name and badges, what the change did there, from the gist.
- **Note.** The edited file and the declaration it touched, then how it reaches: `new signature` or `new behaviour` with its uses (`11 uses in 3 files`, or `no uses elsewhere`), `comments only`, `imports only`, `new file`, or, for a file isobar reads whole, how many files depend on it. The line turns red when the edit reaches other files and no test moved with it.
- **Rain.** The files that use what changed, in sage green, fading with import distance.
- **Track.** The farthest file the change reaches outside the regions it sits in, along its real import chain, labelled `file · N hops`. A file is named by as much of its path as tells it apart from the others on the pane: `sansio/app.py` beside `flask/app.py`.
- **Earlier turn.** An earlier turn's edits fade to a light shower with a small eye, so the latest turn reads first.
- **Unasked.** An edit the scope check flagged says why in its note, as in `unasked: changelog entry`.
- **The map.** Regions named once per repository, sized by their code and by how much depends on them. A region the weather reached is named in ink; a dry region's name is a faint inscription.

## Keys and commands

- `/isobar` opens and focuses the pane, or closes it when it is open. `/isobar map` redraws the basemap.
- A pane that opened by itself leaves focus on the prompt. Press ctrl+x then Tab, or click it, to focus it; Esc returns focus to the prompt.
- An Edit or Write in another repository switches the pane to that repository's map; a Bash command keeps the map it has.
- A phone, the desktop app or VS Code attached to a terminal session shows a text summary instead of the map: the headline, each changed region's caption, and a few lines on the reach, untested edits and flags.

With the pane focused, these keys work:

- `1` change: the eye on each edited file.
- `2` reach: the green rain and the dotted track.
- `3` risk: the red storm.
- `4` history: dashed rings on files that usually change with these and did not; off at first.
- `p` submits a prompt as you: Claude reads the import chain to the farthest file and runs its tests if it has any. In a repository you do not trust, ask that question yourself ([SECURITY.md](SECURITY.md)).
- `m` redraws the basemap.

Every repository gets its own map:

![Three repositories mapped by isobar: Excalidraw, Vite and Flask, each a different arrangement of named regions with the weather of a recent commit](docs/repos.png)

## Install and setup

### Requirements

- **Claude Code 2.1.287 or later.** Check with `claude --version`; run `claude update` if it is older. Function hooks are an early-access surface, and this release is checked on 2.1.287.
- **An interactive session in a terminal.** isobar stays off in `claude -p` and Agent SDK sessions.
- **git, and a git repository.** Outside one, the pane says there is no change to map. In a repository with no commits yet, staged and new files are read against an empty tree, so every line counts as added.
- **Linux, macOS or WSL.** Native Windows is untested; run Claude Code inside WSL.
- **Best with** a terminal 144 columns or wider, so the pane opens by itself, and 24-bit colour for the warm paper (see [Settings](#settings)). Once you have opened the pane with `/isobar`, it opens by itself from 110 columns, until you close it by hand. Inside tmux, Claude Code's main-screen layout places the pane above the prompt; elsewhere its fullscreen layout docks it beside the conversation from 110 columns.

Languages other than JavaScript, TypeScript and Python get their edits, history and the map, but no rain.

### Install

Pick one method. Each loads isobar under its own plugin id, with its own settings and its own kept maps. Paths below use `~/.claude`; if you set `CLAUDE_CONFIG_DIR`, Claude Code reads that folder instead.

- **Marketplace** (`isobar@isobar`): the two commands in Quick start. Every setting has a default, so a notice that options are not set yet needs no action.
- **A clone, in every session** (`isobar@skills-dir`). Claude Code reloads it when you save a file. Running it needs no `pnpm install`. An installed `isobar@isobar` takes precedence over the clone even when disabled, so uninstall it first.

  ```bash
  claude plugin uninstall isobar@isobar   # only if you installed from the marketplace
  git clone https://github.com/r3al1tym/isobar ~/src/isobar
  mkdir -p "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills"
  ln -sfn ~/src/isobar "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/isobar"
  ```

- **One session only** (`isobar@inline`): `claude --plugin-dir ~/src/isobar`, on a clone made with the `git clone` line above.

### Verify

```bash
claude plugin list
claude plugin details isobar@isobar | head -1
```

The first lists isobar among any other plugins:

```text
  ❯ isobar@isobar
    Version: 0.3.0
    Scope: user
    Status: ✔ enabled
```

The second prints `isobar 0.3.0`. A linked clone is listed under `Skills-directory plugins` as `isobar@skills-dir`, with `Status: ✔ loaded`.

`claude plugin details` lists `Hooks (0)` for any function-hook mod; that is expected. `claude -p` never runs isobar, so the last check is yours: start a new interactive session, ask for an edit, and look for the pane. [AGENTS.md](AGENTS.md) has the full check.

### Share one map with your team

To give a team one shared map, commit it as `.isobar/map.json`. To draw one, run `pnpm install` once in a clone of isobar, then, from the clone and with absolute paths:

```bash
mkdir -p /path/to/repo/.isobar
pnpm preview --repo /path/to/repo --build model --map /path/to/repo/.isobar/map.json
```

It names the regions with `claude -p` on Opus (`--model` picks another) and writes the map first, then renders `out/preview.png` in the clone. The render needs python3 with Pillow and any monospace font; if it fails, the map is still written. The tool needs Node 20.11 or later and pnpm. When `claude -p` gives no usable answer, it writes nothing and exits 1. Commit `.isobar/map.json`.

### Update and uninstall

- **Update:** `claude plugin marketplace update isobar && claude plugin update isobar@isobar`, then restart Claude Code. A clone updates with `git -C ~/src/isobar pull`. 0.3.0 renamed `scopeModel` to `smallModel` and moved its default from haiku to sonnet; if you had set `scopeModel`, set `smallModel` to the same value ([CHANGELOG.md](CHANGELOG.md)).
- **Uninstall:** `claude plugin uninstall isobar@isobar && claude plugin marketplace remove isobar`, or `rm "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/isobar"` for a linked clone (it removes the link and keeps the clone). For `--plugin-dir`, start sessions without the flag.
- **Kept maps** stay in `~/.claude/plugins/store/isobar_*.json` after an uninstall. Delete those files to forget every map, or run `/isobar map` to redraw one repository's. A committed `.isobar/map.json` belongs to the team; leave it in place.

### Troubleshooting

- **No pane.** Start a new session (one open before the install never loads it), widen to 144 columns or run `/isobar`, and check that `panel` is not `command`.
- **Digits land in the prompt.** The pane is not focused: press ctrl+x then Tab.
- **White or yellow paper.** See `colors` under [Settings](#settings).
- **No captions.** `gist` is off, the turn is still running, or your account cannot use `smallModel`.

Every message the pane can show, with its cause and fix: [AGENTS.md § 10](AGENTS.md#10-troubleshooting-by-symptom).

## Settings

Set these with `/plugin configure isobar@isobar` in Claude Code, at install with `claude plugin install isobar@isobar --config scope=on`, or from a shell with `echo '{"scope":"on"}' | claude plugin configure isobar@isobar --values-stdin`. A change applies when Claude Code restarts. `claude plugin configure isobar@isobar --json` reads them back under `inputs`, where a blank `smallModel` or `mapModel` means its default. If you installed from a clone, configure `isobar@skills-dir` instead of `isobar@isobar`.

| Setting | Values | What it does |
| --- | --- | --- |
| `gist` | `on` (default), `off` | Ask `smallModel` to caption what the change does in each region, whenever a changed region has no caption and no turn is running: once a turn ends, at session start, and on the last commit when nothing is uncommitted. |
| `scope` | `off` (default), `on` | After each turn that changes files and ends with an answer, ask `smallModel` which changes your requests never called for. A turn you interrupt is not checked. |
| `smallModel` | `sonnet` (default), any model alias or id | The model the gist and the scope check ask. |
| `mapModel` | empty (default), any model alias or id | The model that names the basemap's regions, once per repository; empty uses the model the session runs on. |
| `ground` | `paper` (default), `night`, `auto` | Warm paper, the terminal's near-black, or whichever matches your Claude Code theme. |
| `colors` | `auto` (default), `truecolor`, `256` | How many colours the terminal paints. On Linux, `auto` reads it from the environment Claude Code started in; elsewhere it assumes 24-bit unless inside tmux or Apple's Terminal, so set `256` if the paper looks yellow. |
| `panel` | `auto` (default), `command` | Open the pane once the repository has uncommitted changes (at session start or on the session's first edit), or only on `/isobar`. |

![The same change printed three ways: on warm paper, on the night ground where the storm burns amber, and in a 256-colour terminal on white paper](docs/grounds.png)

On the night ground the storm burns up from red through amber, and the rain stays sage.

The warm paper needs 24-bit colour. Claude Code paints 24-bit where `COLORTERM=truecolor` is set (and in kitty, Ghostty and iTerm) and never inside tmux; everywhere else it paints xterm's 256 colours, where the cream would turn yellow, so isobar switches to white paper and xterm's own colours there. Inside tmux, leave `colors` on `auto`: forcing `truecolor` turns the cream yellow. Windows Terminal draws 24-bit but never sets `COLORTERM`; add `export COLORTERM=truecolor` to your shell profile to get the paper.

## How it works

1. **Facts from git.** On each refresh isobar runs read-only git calls in parallel: the current commit, the line count of every tracked text file, every import line in JavaScript, TypeScript and Python, the last 400 non-merge commits, and the `tsconfig`, `jsconfig`, `package.json` and `pnpm-workspace.yaml` files that say where imports point. Commits that touch more than 40 files are dropped as bulk moves.
2. **The import graph.** Import lines resolve to repository files: relative specifiers with extension and `index` probing, `tsconfig` paths and `baseUrl`, workspace packages by name, `package.json` `#imports`, and Python 3's absolute and relative modules, multi-line imports included. Imports of outside packages are left out.
3. **The change, declaration by declaration.** The uncommitted diff against HEAD (`git diff -U0`), your own edits included, and each changed file before and after are read into declarations: functions, classes, methods, fields, types and constants. A declaration whose header changed has a new signature; one whose code changed otherwise has a new behaviour; one whose code is the same changed only comments. New untracked files count too: those Claude wrote with the Write tool, and any that appeared after the session first read the repository. With nothing uncommitted, the last commit. Before the first commit, the change is read against an empty tree.
4. **Its users.** One `git grep -w` finds the files that depend on a changed file, at any import distance, and name a touched declaration, or, for a private one, a function in the same file that calls it. Those are the rain. A file isobar cannot read by declaration (another language, a new or deleted file, module-level code, a file over 20,000 lines, or any past the first 40 changed files) rains on every importer, three hops out.
5. **The session.** Each refresh hashes the changed files (`git hash-object`, which stores nothing), so isobar knows which turn last changed each one.
6. **The gist.** When a turn ends, and whenever else a changed region has no caption while no turn runs (at session start, or on the last commit), one call to `smallModel` carries each changed region's name and blurb, its files with their added and deleted line counts and touched declarations, and up to 400 lines of their diff in all, split evenly across the files with at least 12 each until the 400 run out. It asks for a caption of 2 to 4 words per region. Your requests stay out of it. A caption holds until its region's change changes; while a turn runs, the last caption stays.
7. **The scope check** (opt-in). When a turn ends with an answer, one call to `smallModel` carries your last four requests and, for each file the turn changed, its whole uncommitted diff against HEAD (earlier turns' and your own edits to it included), capped at 400 lines (60 per file). It asks which changes no request called for. A flag holds until the file changes again.
8. **The map.** Once per repository, isobar cuts the tree into about 160 units (big source folders opened to their files, the rest taken a folder at a time) and asks the session's model, or `mapModel`, to group them into at most 20 regions in 3 to 6 bands, from where work enters down to the foundations. Every file lands in exactly one region. When the model's answer is unusable, the folders themselves become the regions for that session, the frame says `folders only · /isobar map retries`, and the next session asks again. A region's area grows with the square root of its lines of code and with how many files outside it import it, on a scale of 1 to 10. The map is kept in Claude Code's plugin store (`~/.claude/plugins/store/`), per install and per repository path, and new files join a region already there (a tracked file the region its imports point to, a file just created its folder's region), so new files never grow or move the frame.
9. **The picture.** The storm and the rain are density fields over the map's layout, binned into 17 colour steps that move evenly in a perceptual colour space: the storm in reds, the rain in sage greens wherever it outweighs a storm, as a radar colours storm and rain. They are drawn as one grid of half-block characters.

Refreshes run when a session or turn starts, when a turn ends (with gist or scope on), and 500 ms after Claude's last edit or shell command (Edit, Write, MultiEdit, NotebookEdit, Bash), one at a time.

## Performance

One refresh at each repository's latest commit, median of 5 after a warm-up, on a laptop (Intel Core Ultra 7 265H, WSL2). A refresh is the facts from git, the change read by declaration, the weather and the drawing; [bench/results.md](bench/results.md) times each part.

| Repository | Text files | One refresh |
| --- | --: | --: |
| express | 211 | 33 ms |
| flask | 230 | 67 ms |
| excalidraw | 1,018 | 298 ms |
| vite | 2,736 | 107 ms |
| django | 5,675 | 437 ms |
| VS Code | 19,547 | 1.8 s |

- **Most of a refresh is git.** Reading the change by declaration took a median of 29 to 276 ms over 30 to 60 recent commits per repository (1.3 s at VS Code's 95th percentile), and the weather and the drawing together under 25 ms everywhere but VS Code (300 ms).
- **Nothing waits on it.** Refreshes run in the background, one at a time, and the conversation goes on while they do.
- **The basemap** is one model call per repository: 36 s for Django and 48 s for Vite on Opus. While it runs, an open pane says it is drawing the map.
- **The gist and the scope check** are one small call each after a turn ends, run side by side, a few seconds on Sonnet, and never hold up a refresh.

## Accuracy

The import graph and the rain are measured against outside tools on six public repositories, the frame on three by redrawing it, and history by backtest; [bench/](bench/README.md) reproduces it and [bench/results.md](bench/results.md) breaks it down.

- **The import graph** matches the TypeScript compiler and [grimp](https://github.com/seddonym/grimp): recall 0.998 to 1.0 on all six, precision 0.92 to 1.0. Most of isobar's extra edges are real dependencies the reference leaves out: `from pkg import submodule` also runs `pkg/__init__.py`, and the compiler cannot resolve a workspace package without installed `node_modules`.
- **The rain.** Over 300 recent commits (60 per repository, 30 for VS Code and Django), the files isobar rains on were checked against TypeScript's `findReferences` and jedi. The rain covers 88 to 98 percent of the files that reference a changed declaration, or a function in the same file that calls a changed private one. Of the files it rains on, 47 to 86 percent are such files, and 25 percent on VS Code, where a common member name such as `setActive` matches declarations of the same name elsewhere.
- **Less rain.** The median commit rains on 0 files in express (97 when every importer within three hops is marked), 9 in Excalidraw (352), 1 in Vite (137), 12 in VS Code (66), 1 in Flask (67) and 3 in Django (59).
- **The frame holds.** Drawn three times from scratch, a map groups files much the same way on Flask and Excalidraw (adjusted Rand index 0.89 to 0.98, where 1 is the same grouping) and less so on Vite (0.54 to 0.87), which is why isobar draws it once and keeps it. A map drawn a year ago, kept through a year of commits, still agrees with a fresh one at 0.92 to 0.97 on Flask and Excalidraw and 0.53 to 0.90 on Vite; the year's 2 to 532 new files moved no region, and resizing the pane keeps regions in place (layout overlap 0.99 or more).
- **History is weak evidence.** Backtested over 300 commits per repository, a ring was right 38 to 79 percent of the time and named 4 to 16 percent of the files that did change. That is why rings start switched off.
- **The gist and the scope check** have no benchmark yet. Each is a model's judgement; see [Limitations](#limitations).

## Limitations

- **Languages.** The import graph is read for JavaScript, TypeScript (with Vue and Svelte files) and Python; declarations for JavaScript, TypeScript and Python only, so a Vue or Svelte edit rains on every importer, three hops out. Other languages show their edits, history and map, but no rain.
- **Terminal sessions.** isobar sets itself up only in interactive sessions, so `claude -p` and Agent SDK sessions never run it. Sessions that the desktop app or VS Code start on their own are untested.
- **Static names only.** A use is a file that imports the changed file, at any distance, and names the declaration. A method called through an object built elsewhere, dependency injection, dynamic imports built from strings, and a default export imported under another name are invisible to it, or read file-wide.
- **The scope check is a judgement.** It reads your requests and the diff, never your intent. Take `UNASKED` as a prompt to look, and its absence as no proof of anything.
- **A caption is a summary.** It reads up to 400 diff lines; on a change past that, the files late in the diff are captioned from their names, added and deleted line counts and touched declarations alone.
- **History is a forecast.** A ring says these files usually change together; it is a prompt to check, never a finding.
- **Early access.** Function hooks are an early-access Claude Code surface that may change between releases. CI runs `claude plugin validate --strict .` and `claude plugin test .` on Claude Code 2.1.287 and on the latest release.

## Privacy

isobar reads git and draws a pane; it writes nothing to your repository and makes no network calls of its own. Its model calls go through Claude Code's own model access, so every call counts against your Claude Code usage.

- **The basemap**, one call per repository on the session's model (or `mapModel`), carries file and folder paths, their sizes and up to four imported file names per file, never file contents.
- **The gist**, on by default, is one `smallModel` call at session start (once the repository has a map) and one after each turn that changes files, whether or not the pane is open. It sends each changed region's name, its paths with their added and deleted line counts and touched declaration names, and up to 400 lines of their diff, which is file contents; it never sends your requests. Set `gist` to `off` to stop it.
- **The scope check**, off by default, is one more `smallModel` call after each turn that changes files and ends with an answer. It carries your last four requests and, for each file the turn changed, its uncommitted diff, up to 400 lines in all.

[SECURITY.md](SECURITY.md) has the details and the threat model.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development loop, the preview tool and the rules the picture keeps. [AGENTS.md](AGENTS.md) is the setup guide for a person's coding agent. [bench/](bench/README.md) reproduces every number above on public repositories. [docs/design.md](docs/design.md) tells how the design came about. The project follows a [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE) © r3al1tym.
