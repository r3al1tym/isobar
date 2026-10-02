import type { Cell } from './weather'
import type { Run } from './types'

/** The most diff lines one file, and the whole check, sends the model. */
const FILE_LINES = 60
const ALL_LINES = 400
/** The most characters of one request the check quotes. */
const ASK_CHARS = 1500

/** The diff of `paths` with one line of context, cut per file and overall; a file past the cut says so. */
export async function excerptOf(run: Run, root: string, paths: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()

  if (paths.length === 0) return out
  const r = await run(['git', '-C', root, '-c', 'core.quotePath=false', 'diff', '-U1', '--no-color', '--no-ext-diff', 'HEAD', '--', ...paths])
  let budget = ALL_LINES
  let path = ''
  let lines: string[] = []
  const flush = () => {
    if (path === '') return
    const kept = lines.slice(0, Math.min(FILE_LINES, Math.max(0, budget)))

    budget -= kept.length
    out.set(path, kept.length < lines.length ? [...kept, `… ${lines.length - kept.length} more lines`].join('\n') : kept.join('\n'))
  }

  for (const line of r.stdout.split('\n')) {
    if (line.startsWith('diff --git ')) {
      flush()
      path = ''
      lines = []
    } else if (line.startsWith('+++ ')) path = line.slice(4).replace(/^b\//, '')
    else if (line.startsWith('--- ') && line !== '--- /dev/null') path = line.slice(4).replace(/^a\//, '')
    else if (path !== '' && /^[-+ @]/.test(line)) lines.push(line)
  }
  flush()
  return out
}

/**
 * The scope check's question: the person's requests, then each file the latest turn changed with
 * the declarations it touched and its diff. It asks which changes no request called for.
 */
export function scopePrompt(asks: readonly string[], cells: readonly Cell[], excerpts: ReadonlyMap<string, string>): string {
  const requests = asks.map((a, i) => `${i + 1}. ${a.length > ASK_CHARS ? `${a.slice(0, ASK_CHARS)}…` : a}`).join('\n')
  const files = cells.map(c => {
    const touched = c.touches.filter(t => t.kind !== 'comments').map(t => `${t.kind} ${t.owner === undefined ? '' : `${t.owner}.`}${t.name}`)
    const head = `${c.path} (${c.isNew ? 'new file' : c.isDeleted ? 'deleted' : `+${c.added} −${c.deleted}`}${touched.length > 0 ? `; ${touched.join(', ')}` : ''})`
    const diff = excerpts.get(c.path)

    return diff === undefined || diff === '' ? head : `${head}\n\`\`\`diff\n${diff}\n\`\`\``
  })

  return [
    "You check whether a coding agent's edits stayed inside what the person asked for.",
    '',
    'The person\'s requests this session, oldest first; the last one started this turn:',
    '<requests>',
    requests || '(none written; the turn continued earlier work)',
    '</requests>',
    '',
    'The files the agent changed this turn, each with the declarations it touched and its diff:',
    '<changes>',
    files.join('\n\n'),
    '</changes>',
    '',
    'For each file, decide whether a request called for that change, directly or as a step the request plainly needs (a test for it, a type it must widen, a caller it must update, an import it uses). Flag a file only when nothing the person said calls for it: an unrelated refactor or reformat, a fix or feature nobody mentioned, a dependency or config change nobody mentioned. When unsure, it was asked for.',
    '',
    'Answer with JSON only: {"unasked": [{"path": "<the path as given>", "why": "<what the change does, 2 to 4 lowercase words, such as changelog entry or renamed a helper>"}]}, with an empty list when every change was asked for.',
  ].join('\n')
}

/** The flagged files from the model's reply, kept to the paths it was shown; null when the reply is not the JSON asked for. */
export function parseScopeReply(text: string, shown: ReadonlySet<string>): Map<string, string> | null {
  const json = /\{[\s\S]*\}/.exec(text)?.[0]

  if (json === undefined) return null
  try {
    const reply = JSON.parse(json) as { unasked?: unknown }

    if (!Array.isArray(reply.unasked)) return null
    const out = new Map<string, string>()

    for (const row of reply.unasked as { path?: unknown; why?: unknown }[]) {
      if (typeof row?.path !== 'string' || !shown.has(row.path)) continue
      // the badge already says nobody asked, so a trailing "not requested" is cut
      const why = typeof row.why === 'string' ? row.why.trim().replace(/\.$/, '').replace(/[\s,;:-]+(?:was\s+|is\s+)?(?:not|never)\s+(?:requested|asked(?:\s+for)?|mentioned)$/i, '') : ''

      // a note reads in lowercase after "unasked:"; an acronym keeps its capitals
      out.set(row.path, why === '' ? 'not in the request' : /^[A-Z][a-z]/.test(why) ? why[0]!.toLowerCase() + why.slice(1) : why)
    }
    return out
  } catch {
    return null
  }
}
