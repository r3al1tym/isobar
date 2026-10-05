# isobar: setup and operating guide for agents

This file is for an AI coding agent that a person asked to install, check or explain isobar. For a default install, the fast path below is enough; otherwise work through it in order. Each command says what it should print. Sections 1 and 4 only read state; section 4's optional scratch repository goes in a new temporary folder. Sections 2, 3, 8 and 9 change the person's Claude Code setup, so run them once the person has asked for that. To change isobar's own code, read [CONTRIBUTING.md](CONTRIBUTING.md) instead (section 12).

isobar 0.3.0 is a [Claude Code mod](https://code.claude.com/docs/en/plugins/mods/overview): a plugin of function hooks ([reference](https://code.claude.com/docs/en/plugins/mods/reference)). In an interactive Claude Code session it docks a pane that draws the uncommitted change as weather over a fixed map of the repository. A red storm sits on the edited files, a 2 to 4 word caption under each changed region says what the change did there, and green rain falls on the files that use what changed.

## Fast path

For a default install on Linux, macOS or WSL, these steps are enough:

1. `claude --version` prints `2.1.287 (Claude Code)` or higher.
2. `claude plugin marketplace add r3al1tym/isobar && claude plugin install isobar@isobar`. Options it reports as not set yet keep their defaults.
3. `claude plugin list` shows `❯ isobar@isobar` with `Version: 0.3.0` and `Status: ✔ enabled`.
4. `claude plugin details isobar@isobar | head -1` prints `isobar 0.3.0`.
5. `claude plugin validate "$(claude plugin list --json | jq -r '.[] | select(.id == "isobar@isobar") | .installPath')"` ends with `✔ Validation passed` (without jq, or from a local-folder marketplace, where you validate its `readFromFolder` instead, see section 4, step 3). Stop there: `claude -p` never runs isobar, so it proves nothing.
6. Pass the person the text in section 5. They start a new `claude` session to load isobar.
7. To explain the pane, use the table in section 7 and the paragraph under it.

The sections below are the full guide and its reference: the other install methods, settings, colour depth and troubleshooting.

## What you can and cannot do

- **You can** check the prerequisites, install, configure, update and uninstall isobar from a shell, and confirm that Claude Code loads it.
- **You cannot** see the pane, press its keys, or read the person's terminal width. The live check belongs to the person; section 5 gives you the words to hand them.
- **Headless runs prove nothing.** isobar sets itself up only in interactive sessions, so `claude -p` and Agent SDK sessions never run it.
- **A new session is needed.** A plugin installed during a session loads in the next one. The person must start a new `claude` session after you install.

## 1. Check the prerequisites

| Requirement | Check | If it fails |
| --- | --- | --- |
| Claude Code 2.1.287 or later | `claude --version` prints `2.1.287 (Claude Code)` or higher | `claude update`, then check again. This release is checked on 2.1.287. |
| Linux, macOS or WSL | `uname -s` prints `Linux` or `Darwin` | Native Windows is untested: run Claude Code inside WSL. |
| git on PATH | `git --version` prints a version | Install git. |
| A git repository | `git -C <repo> rev-parse --show-toplevel` prints its root | Outside a repository the pane says there is no change to map. A repository with no commits yet works: its staged and new files are read against an empty tree, so every line counts as added. |
| An interactive terminal session | The person runs `claude` in a terminal | `claude -p` and SDK sessions do nothing. Sessions the desktop app or VS Code start on their own are untested. |
| 144 columns, for the pane to open by itself | Ask the person; a tool call cannot measure their terminal | Optional. `/isobar` opens the pane at any width. |
| 24-bit colour, for the warm paper | See "Colour depth" below | Optional. In 256 colours isobar prints on white paper. |

### Colour depth

Your shell's `$COLORTERM` belongs to Claude Code, which sets `COLORTERM=truecolor` for the processes it starts, so it reads `truecolor` even when the terminal never said so. Read the environment Claude Code itself started with. On Linux or WSL, check that `cat /proc/$PPID/comm` prints `claude` (if it prints something else, ask the person as on macOS below), then run:

```bash
tr '\0' '\n' < /proc/$PPID/environ | grep -E '^(COLORTERM|TMUX|TERM|TERM_PROGRAM|WT_SESSION)='
```

isobar reads `COLORTERM`, `TERM`, `TERM_PROGRAM` and `TMUX` by these rules; `WT_SESSION` is in the grep only to spot Windows Terminal:

- `TMUX` set: 256 colours, white paper. Claude Code paints 256 colours inside tmux. Leave `colors` on `auto`; forcing `truecolor` there turns the cream yellow.
- `COLORTERM=truecolor`, `TERM=xterm-kitty`, `TERM=xterm-ghostty` or `TERM_PROGRAM=iTerm.app`: 24-bit, warm paper. Nothing to do.
- `WT_SESSION` set with no `COLORTERM`: Windows Terminal draws 24-bit but does not say so. Suggest that the person add `export COLORTERM=truecolor` to their shell profile, and ask before you edit it.
- Anything else: 256 colours, white paper.

On macOS there is no `/proc`. Ask the person to run `echo "$COLORTERM $TERM_PROGRAM $TMUX"` in the shell they start `claude` from. isobar assumes 24-bit there unless it is inside tmux or Apple's Terminal; if the paper looks yellow, set `colors` to `256`.

## 2. Install

Pick one method and use only that one. Each loads isobar under its own plugin id, with its own settings and its own kept maps.

| Method | Plugin id | Use when |
| --- | --- | --- |
| A. Marketplace | `isobar@isobar` | The default. |
| B. A clone linked into the skills directory | `isobar@skills-dir` | The person wants to read or change the code, or run unreleased commits. |
| C. `claude --plugin-dir` | `isobar@inline` | A one-session trial. |

### A. Marketplace

```bash
claude plugin marketplace add r3al1tym/isobar
claude plugin install isobar@isobar
```

To set options at install, add `--config key=value`, once per option: `claude plugin install isobar@isobar --config scope=on`. If the install reports options that are not set yet, no action is needed: every option has a default.

### B. A clone, loaded in every session

```bash
git clone https://github.com/r3al1tym/isobar ~/src/isobar
mkdir -p "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills"
ln -sfn ~/src/isobar "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/isobar"
```

Claude Code loads the clone in every interactive session and reloads it when a file in it changes. Running it needs no `pnpm install`: the mod imports nothing from npm, and pnpm is only for the preview tool and the tests. If `~/.claude/skills/isobar` already exists as a real folder, stop and ask the person; `ln` would put the link inside it.

### C. One session only

Clone first, as in B (`git clone https://github.com/r3al1tym/isobar ~/src/isobar`), without the link, then:

```bash
claude --plugin-dir ~/src/isobar
```

Its settings belong to `isobar@inline`: `claude --plugin-dir ~/src/isobar plugin configure isobar@inline --values-stdin`.

### Rules that hold for every method

- **The configuration directory.** If `CLAUDE_CONFIG_DIR` is set, read it in place of `~/.claude` everywhere in this guide (the skills link, the kept maps).
- **One method at a time.** With `isobar@isobar` installed, a clone linked as `isobar@skills-dir` does not load, and `claude plugin list` says the name is taken. Uninstall one of them.
- **Maps are kept per install method and per repository path.** Switching method, moving a repository or opening a new git worktree draws a new map, which is one model call. A committed `.isobar/map.json` is shared by all of them.

## 3. Configure

Set only what the person asks for; the defaults are a working setup. A change applies when Claude Code restarts.

| Key | Values (default first) | Effect |
| --- | --- | --- |
| `panel` | `auto`, `command` | `auto` opens the pane by itself once the repository has uncommitted changes, at session start or on the session's first edit. `command` opens it only on `/isobar`. |
| `gist` | `on`, `off` | `on` captions each changed region in 2 to 4 words with one `smallModel` call, whenever a changed region has no caption and no turn is running: once a turn ends, at session start, and on the last commit when nothing is uncommitted. |
| `scope` | `off`, `on` | `on` asks `smallModel`, after each turn that changes files and ends with an answer, which edits no request called for, and marks them `UNASKED`. It sends the person's last four requests. |
| `smallModel` | `sonnet`, or any model alias or id | The model the gist and the scope check ask. |
| `mapModel` | empty, or any model alias or id | The model that names the basemap's regions, once per repository. Empty means the model the session runs on. |
| `ground` | `paper`, `night`, `auto` | Warm cream paper, the terminal's near-black, or whichever matches the Claude Code theme. |
| `colors` | `auto`, `truecolor`, `256` | How many colours the terminal paints. Leave it on `auto` unless the paper looks yellow (set `256`). |

Set values from a shell. Keys left out keep their values:

```bash
echo '{"scope":"on"}' | claude plugin configure isobar@isobar --values-stdin
```

For a linked clone, configure `isobar@skills-dir`; for `--plugin-dir`, see method C. Every value is a string. The CLI checks each one against the options in isobar's manifest, and isobar reads any value it does not recognise as the default.

Read the settings back:

```bash
claude plugin configure isobar@isobar          # each option, and whether it is set
claude plugin configure isobar@isobar --json   # "inputs": current values, "choices": allowed values
```

In the JSON, a blank `smallModel` means `sonnet`, and a blank `mapModel` means the session's model.

Before you turn `scope` on, tell the person that it sends their last four requests (up to 1,500 characters each) and up to 400 lines of the changed files' diff to `smallModel`, through Claude Code's own model access.

## 4. Verify

**Step 1: Claude Code lists it.**

```bash
claude plugin list
```

Expect an entry like this one (other plugins may be listed too):

```text
  ❯ isobar@isobar
    Version: 0.3.0
    Scope: user
    Status: ✔ enabled
```

A marketplace added from a local folder adds a `Read from: <folder>` line.

A linked clone is listed under `Skills-directory plugins (.claude/skills/*):` as `isobar@skills-dir`, its `Path:` the link's location with the home folder shown as `~` (by default `~/.claude/skills/isobar`), with `Status: ✔ loaded`.

**Step 2: the version.**

```bash
claude plugin details isobar@isobar | head -1
```

Expect `isobar 0.3.0`. Further down, the component inventory counts `Hooks (0)`. That is expected for a function-hook mod and is no sign of failure.

**Step 3: what the engine will load.** Take `installPath` from the `isobar@isobar` entry of `claude plugin list --json` (with jq: `claude plugin list --json | jq -r '.[] | select(.id == "isobar@isobar") | .installPath'`), then:

```bash
claude plugin validate <installPath>
```

Expect, among other lines:

```text
  ❯ ./register.tsx hooks: session.start, config.set{key=theme}, turn.start, turn.complete, tool.call, command.run{command=isobar}, ui.focus{requestId=isobar}, ui.render{component=Pane, requestId=isobar}

✔ Validation passed
```

If the marketplace was added from a local folder, the entry carries `readFromFolder`; that folder is what loads, so validate it instead.

**Step 4: stop there.** Steps 1 to 3 are all a tool shell can show. Do not run `claude -p` as a smoke test: isobar stays off in it, so it proves nothing either way. The live check is the person's (section 5).

If the person has no repository at hand, this makes a scratch one in a new temporary folder. A change to `total` then rains on `main.py`, which uses it:

```bash
cd "$(mktemp -d)" && git init -q \
  && printf 'def total(xs):\n    return sum(xs)\n' > cart.py \
  && printf 'from cart import total\n\nprint(total([1, 2]))\n' > main.py \
  && git add . && git -c user.name=isobar -c user.email=isobar@example.invalid commit -qm init && pwd
```

Hand them the printed path, and a request such as "make total skip None values".

## 5. Hand the live check to the person

Pass this on, adjusted to what you found:

> isobar is installed. To see it:
>
> 1. Start a new `claude` session in your repository. Sessions that were already open do not load it.
> 2. Ask Claude for a change. The first time in a repository, isobar draws its map with one model call, which takes under a minute; then the pane opens beside the conversation. It opens by itself once your terminal is 144 columns or wider; at any width, type `/isobar`.
> 3. A pane that opened by itself leaves the keyboard with the prompt. To use its keys, press ctrl+x then Tab, or click the pane. Then `1` to `4` toggle its layers, and Esc hands the keys back. Typing `/isobar` on an open pane closes it; type it again to reopen it with the keys.
> 4. A few seconds after Claude's turn ends, a short caption appears under each changed region.

## 6. Operating the pane

### Commands

| The person types | isobar does | Reply |
| --- | --- | --- |
| `/isobar` with the pane closed, or waiting for room | Opens it, with the keyboard | The forecast headline, `<n> files changed in <regions>.` (for example `2 files changed in app assembly and utilities & debugging.`), or `Isobar pane opened.` |
| `/isobar` with the pane shown | Closes it | `Isobar pane closed.` |
| `/isobar map` | Redraws the basemap with one model call | `Redrawing the basemap of this codebase. The pane updates when it is ready.` |

With nothing changed, the headline reads `Clear skies. Nothing has changed yet.`

### Keys

They work while the pane has the keyboard: after `/isobar`, ctrl+x then Tab, or a click. Esc hands the keyboard back to the prompt.

| Key | Effect |
| --- | --- |
| `1` | Layer change: the eye on each edited file. |
| `2` | Layer reach: the green rain, its arms, and the dotted track with its label. |
| `3` | Layer risk: the red storm itself. |
| `4` | Layer history: dashed rings, and their `EXPECTED` badges. Off at first. |
| `p` | Submits a prompt as the person asking Claude to check the farthest reach: read the import chain to it, and run that file's tests. When nothing reaches past the edited regions, a toast says `Nothing reaches past the regions this change sits in.` |
| `m` | Redraws the basemap, as `/isobar map` does. |

The legend under the map shows the four layers; a layer switched off fades. In a repository the person does not trust, tell them to read the chain on the pane before pressing `p`, since Claude then reads those files and may run their tests ([SECURITY.md](SECURITY.md)).

### When the pane opens by itself

With `panel` on `auto`, it opens the first time in a session that the repository has uncommitted changes: at session start if the tree already has some, or on Claude's first edit. If the repository has no map yet, isobar draws it first, and the pane opens once it is ready. A pane the person closed stays closed for the rest of the session.

Opened this way, the pane appears once the terminal is 144 columns wide, or 110 after the person has opened it with `/isobar`. Below that it waits, and appears as soon as the terminal is wide enough. `/isobar` places it at any width. Claude Code's fullscreen layout docks the pane beside the conversation from 110 columns; narrower, and in its main-screen layout (the default inside tmux), the pane sits above the prompt. The 110-column rule holds until the person closes the pane by hand.

### What it maps and what counts as the change

- **The repository** is the one holding the file Claude last edited with Edit, Write, MultiEdit or NotebookEdit, and at session start the one the session runs in. A Bash command keeps the map it has.
- **The change** is everything uncommitted in tracked files against HEAD, the person's own edits included, plus new untracked files: those Claude wrote with the Write tool, and any that appeared after the session first read the repository. Files that were already untracked then stay out. With nothing uncommitted, the pane shows the last commit, and the title says `last commit <hash>`; in a repository with no commits yet and nothing in it, it says `no commits yet`.
- **Refreshes** run when a session or turn starts, when a turn ends (with gist or scope on), and 500 ms after Claude's last edit or shell command, one at a time and in the background.

### Other surfaces

A phone, the desktop app or VS Code attached to a terminal session shows a text summary in place of the map: the headline, each changed region's caption, and a few lines on the reach, untested edits, unasked edits and history.

## 7. What each mark means

Use this table to explain the pane. Each mark is one of three kinds: a fact read from git, an estimate computed from facts, or a judgement or forecast to check rather than trust.

| Mark | What it is | Kind |
| --- | --- | --- |
| Red storm | The edited files, each in its region. Deepest where an edit is big, widely used and has no test moved with it; only the latest turn's riskiest edit reaches the deepest reds. On the night ground it burns from red through amber. | Estimate |
| Eye `●` or `•` | One edited file: `●` for the latest turn, `•` for an earlier one. Up to eight, latest turn and riskiest first. | Fact |
| Faded storm | An earlier turn's edit, a light shower with a small eye. | Fact |
| Caption under a region's name | What the change does there, in 2 to 4 words, from `smallModel` reading the diff without the person's requests. Appears a few seconds after a turn ends. | Judgement |
| `CHANGED +a −d` | Lines added and deleted in that region. | Fact |
| `NO TESTS` | Source code there changed what it does and no test moved with it. A changed test counts when it imports the file, shares its name, or its new lines name what the edit touched or introduced. | Fact |
| `UNASKED`, and `unasked: <why>` in the note | The scope check found no request that called for this edit. Only with `scope` on. | Judgement |
| `EXPECTED` | A ring in this region marks a file that usually changes with these and did not. Only with history on (`4`). | Forecast |
| Note beside an eye | On the two riskiest edits, unasked ones first: `<file> · <declaration>`, then how it reaches: `new signature · N uses in M files`, `new behaviour · …`, `no uses elsewhere`, `comments only`, `imports only`, `new file`, or `N files depend on it` for a file read whole. Red when it reaches other files and no test moved with it. | Fact |
| Green rain | Files that use what changed: they depend on the changed file and name a touched declaration, or, for a private one, a same-file function that calls it. Fades with import distance. | Fact, from static names |
| Dotted track, `<file> · N hops` | The farthest file reached outside the regions the change sits in, along its import chain. | Fact |
| Dashed rings | Files that changed in at least 60 percent of the past commits touching one of these, at four or more times their usual rate, and not this time. At most two. | Forecast |
| Region name in ink, or faint | The weather reached that region, or it stayed dry. | Fact |
| Title | `ISOBAR` and the repository, then `N this turn · M earlier`, `last commit <hash>`, or `no commits yet`. | Fact |
| Words set into the frame's top edge | What the map is drawn from, when that matters: `folders only · /isobar map retries` or `ignoring .isobar/map.json: not a valid map`. | Fact |

When you explain a pane, keep the kinds apart: the storm, badges, notes, rain and track come from git; a caption and `UNASKED` are a small model's reading of the diff, so take them as prompts to look; rings are a forecast that backtested at 38 to 79 percent precision, which is why they start off.

## 8. Update

- **Marketplace:** `claude plugin marketplace update isobar && claude plugin update isobar@isobar`, then restart Claude Code. `claude plugin list` shows the new `Version`.
- **Clone:** `git -C ~/src/isobar pull`. A running interactive session reloads it.
- **`--plugin-dir`:** update the folder; the next session loads it.

Read [CHANGELOG.md](CHANGELOG.md) for renamed settings. 0.3.0 renamed `scopeModel` to `smallModel` and moved its default from `haiku` to `sonnet`; the old key is no longer read. If the person had set `scopeModel`, set `smallModel` to the same value.

## 9. Uninstall

- **Marketplace:** `claude plugin uninstall isobar@isobar && claude plugin marketplace remove isobar`
- **Clone:** `rm "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/isobar"` removes the link only; the clone stays.
- **`--plugin-dir`:** start sessions without the flag.

Kept maps live in `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/store/isobar_*.json`, one file per install method, keyed by repository path. Uninstalling leaves them. Delete those files, after asking the person, to forget every map; to redraw one repository's map, use `/isobar map`. The `--keep-data` option of `claude plugin uninstall` names `~/.claude/plugins/data/`, which isobar does not use. A repository's committed `.isobar/map.json` belongs to the team: leave it in place.

## 10. Troubleshooting by symptom

The pane's own messages are quoted exactly.

| Symptom | Cause | Fix |
| --- | --- | --- |
| No pane after Claude's first edit | The terminal is under 144 columns, so the pane waits; `panel` is `command`; the session started before the install; or it is a `-p` or SDK session | Run `/isobar`, or widen the terminal. Check `panel` with `configure --json`. Start a new interactive session. |
| No pane for the first minute in a new repository | isobar is drawing the basemap; the pane opens once it is ready | Wait, or run `/isobar` to open it now; it reads `Drawing the map of this codebase. This happens once per repository.` until the map is ready. |
| `Drawing the map of this codebase. This happens once per repository.` | The first map for this repository and install, or `/isobar map` | Wait: under a minute on Opus. |
| `folders only · /isobar map retries` on the frame | The model's answer for the basemap was unusable, so the folders are the regions for this session; nothing is kept | Run `/isobar map` to ask again, or let the next session ask. Set `mapModel` to another model if it keeps failing. |
| `ignoring .isobar/map.json: not a valid map` on the frame | The repository's shared map failed isobar's checks | Redraw it with the recipe in section 12, and commit the new file. |
| `Widen or heighten the pane to see the map` | The pane is too small for every region to get a row and a column | Make the terminal wider or taller. |
| `/isobar` is an unknown command | isobar did not load in this session | Run `claude plugin list`, then start a new interactive session. |
| `This folder is not a git repository, so there is no change to map.` | The session runs outside a repository, and Claude has edited no file inside one | Start `claude` in the repository. An edit to a file inside a repository also moves the pane there. |
| `Reading the repository…` stays | The pane opened in a clean tree with no map kept yet | Send any prompt, or run `/isobar map`. |
| `Isobar could not read the repository: <error>` | A git call failed; a git call ran past 20 s (`ran past 20 s`, a very large repository); or the model call that draws the map was refused | For a git error, run `git -C <repo> status` and fix what git reports. For a model error, set `mapModel` to a model the account can use. |
| `Clear skies. Nothing has changed yet.` | Nothing uncommitted, and no files in the last commit either | Ask Claude for a change. |
| Title reads `no commits yet` under clear skies | The repository has no commits and nothing staged or new yet | Expected. Its first files show as all added, under a normal title. |
| Digits land in the prompt | The pane does not have the keyboard: a pane that opened by itself leaves it with the prompt | Press ctrl+x then Tab, or click the pane. |
| `/isobar` closed the pane | `/isobar` closes a pane that is shown | Run it again: it reopens with the keyboard. |
| The pane sits above the prompt, not beside the conversation | Claude Code's main-screen layout, the default inside tmux | Expected there. Outside tmux, the fullscreen layout docks it. |
| White paper in place of cream | 256 colours detected: tmux, or no `COLORTERM=truecolor` | Inside tmux, expected. In Windows Terminal, `export COLORTERM=truecolor` in the shell profile, then restart. |
| Yellow paper | 24-bit inks in a terminal Claude Code paints in 256 colours: `colors` forced to `truecolor`, or a macOS terminal without 24-bit colour, which isobar cannot detect | Set `colors` to `auto` on Linux, or to `256`. |
| No rain | A language other than JavaScript, TypeScript or Python; an edit to comments, imports or tests only; nothing else uses the declaration (`no uses elsewhere`); or layer `2` is off | Expected. Press `2` if the legend shows reach faded. |
| Rain on every importer of a file | The file was read whole: Vue or Svelte, a new or deleted file, module-level code, over 20,000 lines, or past the first 40 changed files | Expected; the note reads `N files depend on it` (or `new file`, or `<file> deleted`). |
| No captions | `gist` is `off`; the turn is still running; or `smallModel` is a model this account cannot use | Check `configure --json`. Wait for the turn to end. Set `smallModel` to a model the session can use. |
| `UNASKED` never appears | `scope` is `off`, the default; or the turn was interrupted, which is not checked | Set `scope` to `on`, then restart. |
| A new file is missing from the weather | It was already untracked when the session first read the repository | Expected until it is committed, or until Claude writes it with the Write tool. |
| The map changed after a move, a new worktree or a new install method | Maps are kept per repository path and per install method | Commit `.isobar/map.json` to share one map. |
| Edits to a linked clone have no effect | `isobar@isobar` is installed and holds the name | Uninstall one of the two. |
| Anything else | | Run `claude --debug-file /tmp/cc.log`, reproduce it, then `grep -i isobar /tmp/cc.log`, and file a bug with that output. |

## 11. What leaves the machine

isobar runs read-only git calls, writes nothing to the repository and makes no network calls of its own. Its model calls go through Claude Code's own model access.

- **The basemap**, once per repository: file and folder paths, their file and line counts, and up to four imported file names per file. No file contents.
- **The gist**, on by default: each changed region's name, its changed paths with line counts and touched declaration names, and up to 400 lines of their diff. Never the person's requests. It runs whenever a changed region has no caption and no turn is running: after a turn, at session start, and on the last commit when nothing is uncommitted, including at session start in a repository with a kept map.
- **The scope check**, off by default: the last four requests (up to 1,500 characters each), and for each file the latest turn changed, its whole uncommitted diff against HEAD, up to 400 lines in all and 60 per file.

[SECURITY.md](SECURITY.md) has the full list and the threat model.

## 12. Working on isobar itself

For a change to isobar's code rather than a setup, follow [CONTRIBUTING.md](CONTRIBUTING.md). The short version, from a clone:

```bash
pnpm install                                  # tsx and typescript, for the preview tool
pnpm test                                     # claude plugin test .
pnpm validate                                 # claude plugin validate --strict .
pnpm preview --repo ../some-repo --out out/x  # the pane drawn to out/x.png, outside Claude Code
```

To draw a shared map for a team, run, from the clone with absolute paths:

```bash
mkdir -p /path/to/repo/.isobar
pnpm preview --repo /path/to/repo --build model --map /path/to/repo/.isobar/map.json
```

It asks `claude -p` on Opus to name the regions (`--model <alias>` picks another), writes the map, then renders `out/preview.png` in the clone, which needs python3 with Pillow 10.1 or later and any monospace font. The map is written before the render, so a failed render leaves it in place. When `claude -p` gives no usable answer, it writes nothing and exits 1. Commit `.isobar/map.json` in that repository.
