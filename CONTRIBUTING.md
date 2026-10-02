# Contributing

Thanks for looking at isobar. It is a small Claude Code mod with one job: show what a session changed and where it reaches, as a picture you read at a glance. Contributions that keep the pane quiet and the numbers honest are the easiest to accept.

## Ground rules

- **Facts come from git.** The weather reads `git grep`, `git log`, `git diff` and `git hash-object` and nothing else. Two model calls exist: the basemap, once per repository, and the opt-in scope check after a turn. A feature that needs another model call, a network request or a write to the repository needs an issue first.
- **Every mark sits on what it describes.** A badge on its region's name, a note beside its file, the far file at the end of its track. A word that floats free of the map is a word the pane does not need.
- **Rain never outranks the storm.** Reach is capped below the edit's colours, so the deepest reds always mean "you changed this".

## Development

```bash
git clone https://github.com/r3al1tym/isobar
cd isobar && pnpm install
ln -s "$PWD" ~/.claude/skills/isobar
```

Every interactive Claude Code session now loads your clone as `isobar@skills-dir` and reloads it when you save a file. The engine lays the hooks API's TypeScript declarations in `.claude-plugin/types/` when it loads the mod, and `tsconfig.json` includes them, so `tsc -p .` types the mod once Claude Code has loaded it once.

```bash
pnpm test        # claude plugin test .: the engine and pane suites against the engine itself
pnpm validate    # claude plugin validate .: what the engine will load, and anything it would refuse
pnpm preview --repo ../some-repo --out out/x   # the pane drawn to out/x.png, outside Claude Code
```

`pnpm preview` runs the same engine and sheet with Node standing in for `$.process.run`. Useful flags: `--commit <sha>` (draw a past commit), `--cols 96 --rows 56`, `--layers impact,history`, `--ground night`, `--colors 256` (what a 256-colour terminal shows), `--build model` (draw a new basemap with `claude -p`; the map is kept in `out/<repo>-map.json`), `--read off` (reach file-wide, the way an unreadable language is drawn), `--earlier a.py,b.py` (draw those files as an earlier turn's) and `--unasked path=why` (draw a scope-check flag). `bench/` measures speed and accuracy on public repositories; see [bench/README.md](bench/README.md).

## Layout

- `hooks/register.tsx` is the mod. `session.start` registers `/isobar` and reads the terminal's colours; `turn.start` counts the session's turns; `tool.call` (Edit, Write, MultiEdit, NotebookEdit, Bash) schedules a refresh 500 ms after the last call; `turn.complete` runs the scope check when it is on; `ui.render` draws the pane as one Raster; hidden buttons carry the keys. Headless sessions do nothing.
- `hooks/engine/` is pure (no `$`). `git.ts` gathers the facts and finds the change; `imports.ts` resolves JS, TS and Python imports; `graph.ts` walks reach, counts dependents and reads co-change history; `symbols.ts` reads a change declaration by declaration and finds the files that use what it touched; `session.ts` keeps the ledger of which turn wrote each file; `scope.ts` builds the scope check's question and reads its answer; `basemap.ts` cuts the repository into units, asks the model, parses its answer and falls back to folders; `weather.ts` turns a change into cells, reach, the far track, expected files and the forecast.
- `hooks/render/` is pure. `layout.ts` lays the treemap; `field.ts` turns storm and rain into radar bins; `sheet.ts` composes the framed chart; `palette.ts` holds every colour; `raster.ts` packs the grid.

## Rules that are easy to break

- **Every colour sits on the 4-bit grid** (each channel a multiple of 0x11). The Raster paints 4 bits a channel, and an off-grid colour snaps channel by channel and drifts in hue. Colours live in `palette.ts` only, in every set of inks (`PAPER_INKS`, `NIGHT_INKS` and their `_256` twins); drawings read them from the sheet's `inks`.
- **256 colours get their own inks.** Claude Code paints 256 colours inside tmux and wherever it started without `COLORTERM=truecolor` (kitty, Ghostty and iTerm aside). It sets `COLORTERM` for itself once running, so the mod reads the environment Claude Code started with from `/proc`. Claude Code's text rounds each channel while the Raster takes the nearest xterm colour, so the `_256` inks use only colours that land on the same xterm colour both ways (`xterm(i, nth)`).
- **Reach follows use.** An edit read by declaration rains only on files that depend on the changed file and name a touched word; a comment-only or import-only edit stays dry. Only an edit the reader cannot parse rains on every importer. Keep a new rule measurable in `bench/uses.mts`.
- **The basemap is drawn once per repository** and kept in the plugin store under `map:<root>`; a repository's `.isobar/map.json` overrides it. New files are placed by the regions their imports point to, never by redrawing.
- **The ramps step evenly.** Each radar ramp walks OKLab in steps of about 0.04 with lightness moving one way; keep a new bin's step near that.
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

- Add or update a test for any behaviour change; CI runs `claude plugin validate .` and `claude plugin test .`.
- If you touch the picture, attach a `pnpm preview` render or a live capture, before and after.
- Note user-facing changes in `CHANGELOG.md` under `## [Unreleased]`.
- Code style: TypeScript strict, two-space indent, no semicolons, single quotes; doc comments say what a thing is.
