# bench

Measures isobar's speed and accuracy on six public repositories pinned in `repos.json`: express, excalidraw, vite, vscode, flask and django. The scripts import isobar's own modules through the `ISOBAR` constant in `isobar.mts` (inside isobar's repo it is `'..'`). Clones and results go under `$BENCH_DIR`, which defaults to `isobar-bench` in your cache folder (`${XDG_CACHE_HOME:-$HOME/.cache}/isobar-bench`), created private to you.

It needs Node 20.11 or later, Python 3 with `venv` (the published runs used 3.12), git, and a signed-in `claude` for `perf.mts --model` and `frame.mts`, which make Opus calls. Run it from the root of a clone of isobar:

```bash
pnpm install                                                    # tsx, and the TypeScript compiler the scripts load
export BENCH_DIR=${BENCH_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/isobar-bench}
pnpm exec tsx bench/clone.mts                                   # blobless clones at the pinned commits
python3 -m venv "$BENCH_DIR/venv" && "$BENCH_DIR/venv/bin/pip" install -r bench/requirements.txt
pnpm exec tsx bench/perf.mts                                    # gatherFacts, readChange, weatherOf, sheetOf: median of 5 after a warm-up
pnpm exec tsx bench/perf.mts --only vite,django --model         # one model-drawn basemap each, through `claude -p --model opus`
pnpm exec tsx bench/imports.mts                                 # import graph against the TypeScript compiler and grimp
pnpm exec tsx bench/history.mts                                 # EXPECTED badge, backtested over 300 commits and 3 seeds
pnpm exec tsx bench/uses.mts                                    # reach by declaration against findReferences and jedi
pnpm exec tsx bench/frame.mts --model opus                      # map stability: redraws, a year-old kept map, resizes (model calls)
pnpm exec tsx bench/report.mts && cp "$BENCH_DIR/results/results.md" bench/results.md   # merges the parts into results/results.json and results.md
```

Every script but `report.mts` takes `--only <repo,repo>` for spot checks; `frame.mts` measures flask, vite and excalidraw only. With `--only`, `imports.mts` and `uses.mts` write `imports-<repos>.json` and `uses-<repos>.json`, which `report.mts` skips. `perf.mts`, `history.mts` (unless you pass `--save <name>`) and `frame.mts` overwrite the full-run file, so rerun them without `--only` before `report.mts`. The one exception is `perf.mts --only vite,django --model`, which is the full model run. `imports.mts` (grimp) and `uses.mts` (jedi) run the venv's Python under `$BENCH_DIR`, or `$PYTHON` when set. Run `perf.mts` on an idle machine; the other scripts are not timed.
