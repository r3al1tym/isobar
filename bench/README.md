# bench

Measures isobar's speed and accuracy on six public repositories pinned in `repos.json`: express, excalidraw, vite, vscode, flask and django. The scripts import isobar's own modules through the `ISOBAR` constant in `isobar.mts` (inside isobar's repo it is `'..'`). Clones and results go under `$BENCH_DIR`, which defaults to `/tmp/isobar-bench`.

```bash
tsx bench/clone.mts                                   # blobless clones at the pinned commits
python3 -m venv $BENCH_DIR/venv && $BENCH_DIR/venv/bin/pip install -r bench/requirements.txt
tsx bench/perf.mts                                    # gatherFacts, weatherOf, sheetOf: median of 5 after a warm-up
tsx bench/perf.mts --only vite,django --model         # one model-drawn basemap each, through `claude -p --model opus`
tsx bench/imports.mts                                 # import graph against the TypeScript compiler and grimp
tsx bench/history.mts                                 # EXPECTED badge, backtested over 300 commits and 3 seeds
tsx bench/uses.mts                                    # reach by declaration against findReferences and jedi (pip install jedi into the venv)
tsx bench/frame.mts --model opus                      # map stability: redraws, a year-old kept map, resizes (model calls)
tsx bench/report.mts                                  # results/results.json and results/results.md (copied to bench/results.md)
```

Every script takes `--only <repo,repo>`. `imports.mts` runs grimp with `$BENCH_DIR/venv/bin/python`, or `$PYTHON` when set. Run `perf.mts` on an idle machine; the other scripts are not timed.
