/** Merges the per-part results into results/results.json and a short results/results.md. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { repos, RESULTS, save } from './isobar.mts'

const read = (name: string) => {
  const path = resolve(RESULTS, `${name}.json`)

  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
}
const perf = read('perf')
const model = read('perf-model')
const imports = read('imports')
const history = read('history')
const uses = read('uses')
const frame = read('frame')
const find = (part: { rows: { repo: string }[] } | null, repo: string): any => part?.rows.find(r => r.repo === repo) ?? null

const rows = repos.map(repo => {
  const p = find(perf, repo.name)
  const m = find(model, repo.name)?.model ?? null
  const i = find(imports, repo.name)
  const h = find(history, repo.name)
  const u = find(uses, repo.name)

  return {
    repo: repo.name,
    sha: repo.sha,
    perf: p && { ...p, model: m },
    imports: i && { ...i, falseCauses: i.falseCauses.slice(0, 3), missCauses: i.missCauses.slice(0, 3) },
    history: h,
    uses: u && { ...u, perCommit: undefined },
  }
})

save('results', { machine: perf?.machine, cliBaselineSeconds: model?.cliBaselineSeconds ?? null, history: history && { ...history, rows: undefined }, rows })

/** 0.99987 prints as 0.999: rounding up to 1.000 would claim a perfect score. */
const ratio = (n: number, d: number) => (d === 0 ? '–' : n === d ? '1.000' : Math.min(0.999, Math.round((n / d) * 1000) / 1000).toFixed(3))
const fixed = (x: number | null | undefined, places = 3) => (x === null || x === undefined ? '–' : x.toFixed(places))
const ms = (x: number | undefined) => (x === undefined ? '–' : x < 10 ? x.toFixed(1) : String(Math.round(x)))
const mc = perf?.machine

/** One refresh: the medians of its timed parts summed (the facts, the change read by declaration, the weather, the sheet). */
const refreshMs = (p: any): number | undefined => {
  const parts = p ? [p.factsMs, p.readMs, p.weatherMs, p.sheetMs] : []

  return parts.length > 0 && parts.every(x => typeof x === 'number') ? parts.reduce((a, b) => a + b, 0) : undefined
}

const table = [
  '| repo | files (mapped) | edges | facts ms | read ms | weather ms | sheet ms | refresh ms | model map s | import precision / recall | dependents error (median, differ) | EXPECTED coverage / precision / recall / false alarms |',
  '|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|',
  ...rows.map(({ repo, perf: p, imports: i, history: h }) => {
    const mm = p?.model ? `${p.model.seconds}${p.model.accepted ? '' : ' (rejected)'}` : '–'
    const imp = i ? `${ratio(i.agreed, i.isobarEdges)} / ${ratio(i.agreed, i.compilerEdges)}` : '–'
    const dep = i ? `${fixed(i.dependents.medianRelativeError)} (${i.dependents.differ}/${i.dependents.files})` : '–'
    const exp = h ? [h.coverage, h.precision, h.recall, h.falseAlarms].map(x => fixed(x, 2)).join(' / ') : '–'

    return `| ${repo} | ${p ? `${p.trackedFiles} (${p.textFiles})` : '–'} | ${p?.edges ?? '–'} | ${ms(p?.factsMs)} | ${ms(p?.readMs)} | ${ms(p?.weatherMs)} | ${ms(p?.sheetMs)} | ${ms(refreshMs(p))} | ${mm} | ${imp} | ${dep} | ${exp} |`
  }),
]

const causes = rows.flatMap(({ repo, imports: i }) => {
  if (!i) return []
  const list = (title: string, cs: { cause: string; count: number; example: string }[]) =>
    cs.length === 0 ? [`- ${title.replace(/ \(0 .*/, '')}: none`] : [`- ${title}:`, ...cs.map(c => `  - ${c.count} × ${c.cause}. Example: \`${c.example}\``)]
  const s = i.specifiers
  const parts = s
    ? [
        s.workspaceUnresolved && `${s.workspaceUnresolved} workspace-package specifiers the compiler cannot resolve without node_modules links`,
        s.unresolvedRelative && `${s.unresolvedRelative} relative specifiers it cannot resolve (${Object.entries(i.unresolvedRelativeByType).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(', ')})`,
        i.isobarEdgesLeftOut.total && `${i.isobarEdgesLeftOut.total} isobar edges to or from files the compiler does not resolve (${Object.entries({ ...i.isobarEdgesLeftOut.toFileType, ...i.isobarEdgesLeftOut.fromSourceType }).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(', ')})`,
      ].filter(Boolean)
    : []
  const left = s
    ? parts.length ? [`- Left out of both graphs: ${parts.join('; ')}.`] : []
    : [`- Compared within the ${i.files} files grimp sees as modules${i.portions.length ? `, with ${i.portions.join(', ')} added (a folder without __init__.py, which grimp skips by default)` : ''}.`]
  const worst = [...i.dependents.rows].sort((a, b) => Math.abs(b.isobar - b.compiler) - Math.abs(a.isobar - a.compiler))[0]
  const dep = worst && worst.isobar !== worst.compiler
    ? [`- Dependents: ${i.dependents.differ} of ${i.dependents.files} differ; furthest \`${worst.file}\`, ${worst.compiler} by the compiler, ${worst.isobar} by isobar.`]
    : [`- Dependents: all ${i.dependents.files} match.`]

  return [`### ${repo} (${i.by})`, '', ...list(`Misses (${i.compilerEdges - i.agreed} edges the ${s ? 'compiler' : 'grimp graph'} has and isobar lacks)`, i.missCauses), ...list(`False edges (${i.isobarEdges - i.agreed} isobar edges the ${s ? 'compiler' : 'grimp graph'} lacks)`, i.falseCauses), ...dep, ...left, '']
})

const pct = (x: number | null | undefined, places = 1) => (x === null || x === undefined ? '–' : `${(x * 100).toFixed(places)}%`)
const reachTable = [
  '| repo | commits (files read) | comments / imports / body / signature / file | rain v0.1 → v0.2, median (p90) | users P / R, direct | users P / R, + propagated | exact | readChange ms median / p95 |',
  '|---|--:|--:|--:|--:|--:|--:|--:|',
  ...rows.flatMap(({ repo, uses: u }) => {
    if (!u) return []
    const k = u.kinds
    const rain = (r: { medianShare: number; p90Share: number; medianFiles: number }) => `${pct(r.medianShare, 2)} (${pct(r.p90Share)}), ${r.medianFiles} files`
    const pr = (v: { precision: number | null; recall: number | null }) => `${fixed(v.precision)} / ${fixed(v.recall)}`

    return [`| ${repo} | ${u.commits} (${u.sourceFiles}) | ${[k.comments, k.imports, k.body, k.signature, k.file].map(x => pct(x, 0)).join(' / ')} | ${rain(u.rain.v01)} → ${rain(u.rain.v02)} | ${pr(u.users.direct)} | ${pr(u.users.withPropagated)} | ${u.users.direct.exact} / ${u.users.files} | ${ms(u.readChangeMs.median)} / ${ms(u.readChangeMs.p95)} |`]
  }),
]
const reachCauses = rows.flatMap(({ repo, uses: u }) => {
  if (!u) return []
  const list = (title: string, cs: { cause: string; count: number; example: string }[]) =>
    cs.length === 0 ? [`- ${title}: none`] : [`- ${title}:`, ...cs.map(c => `  - ${c.count} × ${c.cause}. Example: \`${c.example}\``)]
  const left = [u.users.timedOut && `${u.users.timedOut} timed out`, u.users.failed && `${u.users.failed} failed`, u.users.unlocated && `${u.users.unlocated} with a declaration the truth could not find`].filter(Boolean)

  return [
    `### ${repo}`,
    '',
    ...list(`Users the direct truth lacks (${u.users.direct.fp})`, u.falseCauses),
    ...list(`Direct references isobar misses (${u.users.direct.fn})`, u.missCauses),
    ...list(`References to propagated callers isobar misses (${u.propagatedMissCauses.reduce((n: number, c: { count: number }) => n + c.count, 0)})`, u.propagatedMissCauses),
    ...(left.length ? [`- Files left out of the comparison: ${left.join(', ')}.`] : []),
    '',
  ]
})

const span = (xs: number[]) => (Math.min(...xs) === Math.max(...xs) ? `${Math.min(...xs)}` : `${Math.min(...xs)}–${Math.max(...xs)}`)
const frameTable = [
  '| repo | files | regions per draw | redraw ARI | a year-old map: files then → now, new files, kept vs fresh ARI, layout IoU | resize IoU, lowest |',
  '|---|--:|--:|--:|--:|--:|',
  ...(frame?.rows ?? []).map((f: any) =>
    `| ${f.repo} | ${f.files} | ${f.regions.join(', ')} | ${span(f.redrawARI)} | ${f.yearOld.files}, ${f.yearOld.newFiles} new, ${span(f.yearOld.keptVsFreshARI)}, ${f.yearOld.layoutIoU} | ${Math.min(...Object.values(f.resize as Record<string, number>))} |`),
]

const notes = [
  `Edges are what \`gatherFacts\` finds. Times are the median of 5 runs after one warm-up, in one Node process, on warm git caches; read (\`readChange\`, the change read by declaration), weather and sheet are for the HEAD commit's own change over a heuristic basemap, and refresh is facts + read + weather + sheet. The laptop was running other work: the 1-minute load average was ${mc?.loadAverage ?? '–'} when the timings started.`,
  ...(rows.some(r => r.perf?.model)
    ? [
        `The model map is one \`claude -p --model opus\` call fed \`basemapPrompt\` on stdin, as scripts/preview.ts asks, timed through \`parseBasemapReply\` and \`finishBasemap\`: one sample per repo, so it moves with model load.${model?.cliBaselineSeconds == null ? '' : ` \`claude -p\` alone took ${model.cliBaselineSeconds} s to answer one word here (median of 3); the mod asks through \`$.model.complete\` and skips that start-up.`} ${rows.filter(r => r.perf?.model).map(r => `${r.repo}: ${r.perf.model.units} units in the prompt, ${r.perf.model.regions} regions back`).join('; ')}. Replies are kept in \`results/model-map-<repo>.txt\`.`,
      ]
    : []),
  `Files are tracked files, with the files isobar maps in brackets: every text file (\`git grep -I -c -e ''\`) and the empty JavaScript, TypeScript and Python files an import can name. Binary files, symlinks and other empty files stay off the map.`,
  'JS/TS ground truth: `ts.preProcessFile` + `ts.resolveModuleName` with the nearest tsconfig.json or jsconfig.json, with `allowJs` and `resolveJsonModule` forced on so a .js or .json target counts. Sources are tracked .ts/.tsx/.js/.jsx/.mjs/.cjs/.mts/.cts files minus .d.ts and *.min.js; targets are the same plus .json. No directory is skipped. Clones are blobless with no node_modules, so a workspace package resolves only where tsconfig `paths` maps it.',
  'Python ground truth: grimp, both ends inside the package. grimp records `from pkg import submodule` as an import of the submodule only, so isobar\'s extra edge to `pkg/__init__.py` counts as false even though Python runs that file.',
  '"dependents error" is the median of |isobar − compiler| / compiler over `dependentsOf` for the 20 files the compiler graph says are imported most, then how many of the 20 differ at all.',
  ...(uses
    ? [`Reach by declaration (bench/uses.mts): per repo a seeded sample of the latest ${uses.window} non-merge commits touching 1 to 15 JS/TS or Python files (${uses.perRepo}, fewer where the table says), each read in a detached worktree. Truth for JS/TS is the TypeScript language service's \`findReferences\` over the nearest tsconfig or jsconfig (allowJs on), widened by the files isobar's graph says depend on the changed file; for Python, jedi's \`get_references\` over the repo. A file counts when it references a touched declaration outside its imports. Searches over ${uses.timeoutSeconds} s leave their file out. readChange is timed once after a warm-up call that fetches the parent commit's blobs.`]
    : []),
  `EXPECTED backtest: the latest ${history?.commits} non-merge commits touching 2 to 40 files; history is the ${history?.history} non-merge commits before each (bulk commits over 40 files dropped); half the files given, half hidden, by a seeded shuffle; \`expectedOf(history, given, () => true, ${history?.minShare}, ${history?.minTogether}, ${history?.minLift})\`, top ${history?.top}; mean over seeds ${history?.seeds?.join(', ')}. Coverage: share of commits flagged. Precision: flags that were hidden files. Recall: hidden files flagged. False alarms: share of complete commits (every file given) that still get a flag.`,
]

const md = [
  '# isobar benchmarks',
  '',
  mc ? `Machine: ${mc.cpu}, ${mc.cores} logical CPUs, ${mc.memoryGb} GB, ${mc.os}; Node ${mc.node.replace(/^v/, '')}, ${mc.git}, Claude Code ${mc.claude.split(' ')[0]}.` : '',
  '',
  ...table,
  '',
  '## Import graph: where isobar and the compiler disagree',
  '',
  ...causes,
  ...(reachTable.length > 2
    ? ['## Reach by declaration', '', 'Rain is the files the weather reaches as a share of the mapped files, per commit: v0.1 every importer up to 3 hops, v0.2 the users of what changed and the files on their import chains. P / R are isobar\'s users (`uses > 0`) against the files that reference a touched declaration, then also the same-file callers isobar propagated to; exact is changed files where the set matches the direct truth.', '', ...reachTable, '', ...reachCauses]
    : []),
  ...(frame
    ? ['## The frame', '', `Basemaps drawn by \`claude -p --model ${frame.model}\`, ${frame.draws} at the pinned commit and one a year earlier (bench/frame.mts). ARI is the adjusted Rand index over every file's region: 1 is the same grouping, 0 is chance. The year-old map is kept and completed at the pinned commit, as the pane keeps a map, and compared with each fresh draw; layout IoU is how much of each region's rectangle stays put once the year's new files join it, and resize IoU the same across pane sizes.`, '', ...frameTable, '']
    : []),
  '## How it was measured',
  '',
  ...notes.map(n => `- ${n}`),
  '',
  '## Repositories',
  '',
  ...repos.map(r => `- ${r.name}: ${r.url} at \`${r.sha}\``),
  '',
].join('\n')

writeFileSync(resolve(RESULTS, 'results.md'), md)
console.log(md)
