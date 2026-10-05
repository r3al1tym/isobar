# Contributing

Thanks for looking at isobar. It is a small Claude Code mod with one job: show what a session changed and where it reaches, as a picture you read at a glance. Contributions that keep the pane quiet and the numbers honest are the easiest to accept.

## Ground rules

- **Facts come from git.** The weather reads `git rev-parse`, `grep`, `log`, `diff`, `ls-files`, `show` and `hash-object` and nothing else. Three model calls exist: the basemap, once per repository; the gist, for any region it has not captioned while no turn runs (at session start, after a turn, on a shown commit); and the opt-in scope check after a turn. A feature that needs another model call, a network request or a write to the repository needs an issue first.
- **Every mark sits on what it describes.** A badge on its region's name, a note beside its file, the far file at the end of its track. A word that floats free of the map is a word the pane does not need.
- **Rain never outranks the storm.** Reach is capped below the edit's colours, so the deepest reds always mean "you changed this".

## Development

Prerequisites:

- Node 20.11 or later (CI runs 22) and pnpm
- Claude Code 2.1.287 or later, and git
- Python 3 with Pillow 10.1 or later (`python3 -m pip install pillow`) for the PNGs `pnpm preview` and `scripts/capture.py` write; any monospace font works, and `ISOBAR_FONT` names one
- tmux, for live captures

```bash
git clone https://github.com/r3al1tym/isobar
cd isobar && pnpm install
claude plugin uninstall isobar@isobar   # only if installed from the marketplace: an installed copy takes precedence over the clone, even when disabled
ln -s "$PWD" ~/.claude/skills/isobar
```

Every interactive Claude Code session now loads your clone as `isobar@skills-dir` and reloads it when you save a file; `claude plugin list` should show `isobar@skills-dir` with `Status: ✔ loaded`. The engine lays the hooks API's TypeScript declarations in `.claude-plugin/types/` when it loads the mod, and `tsconfig.json` includes them, so `pnpm typecheck` (`tsc -p .`) types the mod once an interactive session has loaded it (start `claude --plugin-dir .` the first time, then quit). `pnpm test`, `pnpm validate` and `claude plugin list` do not lay the declarations.

```bash
pnpm typecheck   # tsc -p .: the mod, the tests and the scripts, strict
pnpm test        # claude plugin test .: the engine and pane suites against the engine itself
pnpm validate    # claude plugin validate --strict .: what the engine will load, and anything it would refuse or warn about
pnpm preview --repo ../some-repo --out out/x   # the pane drawn to out/x.png, outside Claude Code
```

The first preview of a repository draws its basemap with `claude -p --model opus` (about 30 to 40 s, and it needs a signed-in `claude`), as the mod does, and keeps it in `out/<repo>-map.json`; a repository with its own `.isobar/map.json` is drawn on that instead, as the mod draws it. `--build model` draws the basemap again with the model, `--build heuristic` makes a folder map with no model call, and `--map <file>` reads (or, with `--build`, writes) a given map; a new build is never written into the repository.

`pnpm preview` runs the same engine and sheet with Node standing in for `$.process.spawn`. Other flags: `--commit <sha>` (draw a past commit), `--cols 96 --rows 56`, `--layers code,impact,risk,history` (the pane's change, reach, risk and history; list the ones to draw), `--ground night`, `--colors 256` (what a 256-colour terminal shows), `--read off` (reach file-wide, the way an unreadable language is drawn), `--earlier a.py,b.py` (draw those files as an earlier turn's) and `--unasked path=why` (draw a scope-check flag). `bench/` measures speed and accuracy on public repositories; see [bench/README.md](bench/README.md).

## Layout

- `hooks/register.tsx` is the mod. `session.start` registers `/isobar` and reads the terminal's colours; `turn.start` counts the session's turns; `tool.call` (Edit, Write, MultiEdit, NotebookEdit, Bash) schedules a refresh 500 ms after the last call; `turn.complete` runs the gist and, when it is on, the scope check; `ui.render` draws the pane as one Raster; hidden buttons carry the keys. Headless sessions do nothing.
- `hooks/engine/` is pure (no `$`). `git.ts` gathers the facts and finds the change; `imports.ts` resolves JS, TS and Python imports; `graph.ts` walks reach, counts dependents and reads co-change history; `symbols.ts` reads a change declaration by declaration and finds the files that use what it touched; `session.ts` keeps the ledger of which turn wrote each file; `gist.ts` builds the gist's question and reads its captions; `scope.ts` builds the scope check's question and reads its answer; `basemap.ts` cuts the repository into units, asks the model, parses its answer and falls back to folders; `weather.ts` turns a change into cells, reach, the far track, expected files and the forecast.
- `hooks/render/` is pure. `layout.ts` lays the treemap; `field.ts` turns storm and rain into radar bins; `sheet.ts` composes the framed chart; `palette.ts` holds every colour; `raster.ts` packs the grid.

## Rules that are easy to break

- **Every colour sits on the 4-bit grid** (each channel a multiple of 0x11). The Raster paints 4 bits a channel, and an off-grid colour snaps channel by channel and drifts in hue. Colours live in `palette.ts` only, in every set of inks (`PAPER_INKS`, `NIGHT_INKS` and their `_256` twins); drawings read them from the sheet's `inks`.
- **256 colours get their own inks.** Claude Code paints 256 colours inside tmux and wherever it started without `COLORTERM=truecolor` (kitty, Ghostty and iTerm aside). It sets `COLORTERM` for itself once running, so the mod reads the environment Claude Code started with from `/proc`. Claude Code's text rounds each channel while the Raster takes the nearest xterm colour, so the `_256` inks use only colours that land on the same xterm colour both ways (`xterm(i, nth)`).
- **Reach follows use.** An edit read by declaration rains only on files that depend on the changed file and name a touched word; a comment-only or import-only edit stays dry. Only an edit the reader cannot parse rains on every importer. Keep a new rule measurable in `bench/uses.mts`.
- **The basemap is drawn once per repository** and kept in the plugin store under `map:<root>`; a repository's `.isobar/map.json` overrides it. New files join a region already there, never by redrawing: a tracked file the region its imports point to, a file the session just created its folder's region.
- **The ramps step evenly.** Each radar ramp walks OKLab in steps of 0.02 to 0.08, mostly 0.04 to 0.06, with lightness moving one way; keep a new bin's step inside that. The night radar's step from bin 5 to bin 6 (0.11) is the one wider, still to be retuned.
- **Eyes and notes draw last** and step onto open weather, and a note that would crowd another is left out (`noteNear`).
- `$` is passed only to named, statically called functions (a validator rule), and a hook has 10 seconds.

## Testing live

Unit tests cover the engine and the pane's contract; the picture needs a real terminal. tmux drives one:

```bash
tmux new-session -d -s iso -x 230 -y 62 -e COLORTERM=truecolor -c ../some-repo \
  "env -u TMUX -u TMUX_PANE TERM=xterm-256color claude --plugin-dir $PWD"
# ask Claude for an edit; the pane docks beside the transcript at 144 columns or wider
python3 scripts/capture.py iso out/live.png
```

Claude Code paints 256 colours when it sees tmux, so the recipe hides tmux from it to paint 24-bit colour as a desktop terminal does. Drop `env -u TMUX -u TMUX_PANE` to check the 256-colour inks, and read the colours it sends with `tmux capture-pane -e -p | grep -o '48;5;[0-9]*'`.

## Pull requests

- Add or update a test for any behaviour change; run `pnpm typecheck`, `pnpm validate` and `pnpm test`. CI runs `claude plugin validate --strict .` and `claude plugin test .` on Claude Code 2.1.287 and on the latest release.
- If you touch the picture, attach a `pnpm preview` render or a live capture, before and after.
- Note user-facing changes in `CHANGELOG.md` under `## [Unreleased]`.
- Code style: TypeScript strict, two-space indent, no semicolons, single quotes; doc comments say what a thing is.

## Releasing

`main` is the last release: `claude plugin marketplace add r3al1tym/isobar` installs from it, so it carries no unreleased work. Feature work stays on a branch and reaches `main` only with its version bump and a dated `CHANGELOG.md` section.

1. On the release branch, set the version in `.claude-plugin/plugin.json` and `package.json`, and date the release in `CHANGELOG.md` (move `[Unreleased]` into `## [x.y.z] - YYYY-MM-DD` and add its compare link).
2. Tag the final commit: `git tag -a vx.y.z -m "isobar x.y.z" <branch>`.
3. Push by explicit refs only: `git push github <branch>:main` and `git push github vx.y.z`. Never `--all`, `--mirror` or `--tags`.
