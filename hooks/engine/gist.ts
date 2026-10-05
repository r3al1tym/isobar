import type { Cell } from './weather'
import type { Basemap } from './types'

/** The most diff lines the gist sends the model in all, shared across the files. */
const ALL_LINES = 400
/** The fewest diff lines one file may take while the whole lasts; files past it get none. */
const FILE_FLOOR = 12
/** The most characters of a caption: the question asks for 24, and a longer answer is cut. */
const WHAT_CHARS = 40

/** Each file's share of the diff the gist sends: an even split of the whole, at least the floor while it lasts. */
export const gistLines = (files: number) => ({ file: Math.max(FILE_FLOOR, Math.floor(ALL_LINES / Math.max(1, files))), all: ALL_LINES })

/**
 * The gist's question: each region the change sits in, with its files, the declarations they
 * touched and their diff. It asks what the change does there, in a few words a person reads at a
 * glance. The requests are left out on purpose: the gist is the diff's own account, so a person
 * can set it against what they meant.
 */
export function gistPrompt(map: Basemap, cells: readonly Cell[], excerpts: ReadonlyMap<string, string>): string {
  const regions = [...new Set(cells.map(c => c.region))].map(id => {
    const r = map.regions.find(x => x.id === id)
    const files = cells.filter(c => c.region === id).map(c => {
      const touched = c.touches.filter(t => t.kind !== 'comments').map(t => `${t.kind} ${t.owner === undefined ? '' : `${t.owner}.`}${t.name}`)
      const head = `${c.path} (${c.isNew ? 'new file' : c.isDeleted ? 'deleted' : `+${c.added} −${c.deleted}`}${touched.length > 0 ? `; ${touched.join(', ')}` : ''})`
      const diff = excerpts.get(c.path)

      return diff === undefined || diff === '' ? head : `${head}\n\`\`\`diff\n${diff}\n\`\`\``
    })

    return `<region id="${id}" name="${r?.name ?? id}">\n${r?.blurb ?? ''}\n\n${files.join('\n\n')}\n</region>`
  })

  return [
    'You write the captions on a map of a codebase. Each region below is one part of the product, and a coding agent has just changed files in it.',
    '',
    regions.join('\n\n'),
    '',
    'For each region, caption what the change does there in 2 to 4 lowercase words, at most 24 characters, read from the diff alone: what it adds, fixes or changes for someone using or maintaining that part, such as "retries failed uploads", "documents the new flag", "changelog entry" or "covers the empty cart". Say what it does, never how and name the specific thing that changed (never "implements", "updates", "adds logic for" or "refactors code"); for docs, a changelog or tests, say what it records or covers. Never repeat the region\'s name or a file name, and end without a period.',
    '',
    'Answer with JSON only: {"regions": [{"id": "<the id as given>", "what": "<the caption>"}]}.',
  ].join('\n')
}

/** Each region's caption from the model's reply, kept to the regions it was shown; null when the reply is not the JSON asked for. */
export function parseGistReply(text: string, shown: ReadonlySet<string>): Map<string, string> | null {
  const json = /\{[\s\S]*\}/.exec(text)?.[0]

  if (json === undefined) return null
  try {
    const reply = JSON.parse(json) as { regions?: unknown }

    if (!Array.isArray(reply.regions)) return null
    const out = new Map<string, string>()

    for (const row of reply.regions as { id?: unknown; what?: unknown }[]) {
      if (typeof row?.id !== 'string' || !shown.has(row.id) || typeof row.what !== 'string') continue
      // a caption reads in lowercase on the map; an acronym or a quoted name keeps its capitals
      const what = row.what.trim().replace(/^["']|["']$/g, '').replace(/\.$/, '').replace(/\s+/g, ' ').slice(0, WHAT_CHARS).trim()

      if (what !== '') out.set(row.id, /^[A-Z][a-z]/.test(what) ? what[0]!.toLowerCase() + what.slice(1) : what)
    }
    return out
  } catch {
    return null
  }
}
