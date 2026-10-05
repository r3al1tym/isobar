# Security

isobar reads your repository through git and draws a pane. It never writes to the repository, runs no code from it and makes no network calls of its own.

## What it runs and reads

- **git, read-only.** `rev-parse`, `grep`, `log`, `diff`, `ls-files`, `show` and `hash-object` (without `-w`, so it hashes a file and stores nothing), in the repository of the file Claude last edited. Every `diff` runs with `diff.autoRefreshIndex=false`, so it never rewrites `.git/index` or takes its lock.
- **Its own environment.** One `sh` call reads four variables (COLORTERM, TERM, TERM_PROGRAM, TMUX) from the environment Claude Code started with (`/proc/$PPID/environ` on Linux) to learn how many colours the terminal paints. Nothing from it is stored or sent.
- **`.isobar/map.json`** in the repository, when present, as the shared basemap.

## What leaves your machine

Every model call goes through Claude Code's own model access, so it follows whatever provider and policy your Claude Code uses.

- **The basemap, once per repository.** Made with the session's own model, or `mapModel` when set. The prompt carries the repository's folder name and up to about 160 units: file and folder paths, their file and line counts, and up to four imported file names per file. It carries no file contents. The map is kept in Claude Code's plugin store, so later sessions make no call; `/isobar map` draws it again.
- **The gist, unless `gist` is `off`.** Whenever the pane's change has a region it has not captioned yet and no turn is running (at session start, once a turn that changes files ends, and when the pane shows a commit), one call to `smallModel` (default `sonnet`) captions the change the weather shows: every uncommitted edit to a tracked file, including edits made before the session started, plus the files this session created; on a clean tree, the last commit, whoever wrote it. It runs whether or not the pane is open, once the repository has a map. The call carries each changed region's name and blurb, its changed paths with their added and deleted line counts and touched declaration names, and up to 400 lines of their diff in all, split evenly across the files with at least 12 each until the 400 run out (files past that send none). That is file contents. It never carries your requests. With `gist` off, no call is made.
- **The scope check, only when `scope` is `on`.** After each turn that changes files and ends with an answer, one call to `smallModel` (default `sonnet`) carries your last four requests from the conversation (up to 1,500 characters each), the turn's changed paths with their added and deleted line counts and touched declaration names, and, for each of those files, its whole uncommitted diff against HEAD, earlier turns' edits and your own included, up to 400 lines in all (60 per file). That is file contents. With `scope` off, the default, no call is made.

## Threat model

A cloned repository controls its own file names and can ship its own map, and those names reach the pane, the basemap and gist prompts and the `p` key's question.

- **The pane.** The terminal pane draws only printable single-width code points (no control, bidi or zero-width characters), and the Raster takes code points, never escape sequences, so a file name cannot drive your terminal. The desktop, VS Code and mobile surfaces draw the same strings as plain text, never as markdown, so a name or a caption cannot become a link or an image.
- **The basemap prompt.** A file name could try to steer the model. Its answer is parsed as JSON, its names and blurbs are clipped to a few words, and its paths are only used to place files, so the worst outcome is an odd region name.
- **`.isobar/map.json`.** A repository can ship its own map. Its names and blurbs are clipped like the model's, and they reach the gist prompt and the `p` question as data. A file that is no valid map is set aside, and the pane says so.
- **The gist.** A diff could carry text that tries to steer the caption. Its answer is parsed as JSON, only regions it was shown are kept, and a caption is cut to 40 characters and drawn as plain text: the worst outcome is a wrong or odd caption. Read it as a summary, and the diff as the record.
- **The scope check.** A diff could carry text that tries to steer the check. Its answer is parsed as JSON, only paths it was shown are kept, and a flag only draws an `UNASKED` badge and a short note: the worst outcome is a wrong badge, or a missing one. Treat the badge as a prompt to look, never as proof that a change is safe.
- **The `p` key.** It submits a question to Claude as you. The question names every file on the far import chain and that region's name, as quoted strings. The pane shows only the farthest file and a dotted track. Claude then reads those files and may run their tests under your normal permission settings. In a repository you do not trust, ask the question yourself.

## Reporting a vulnerability

Please report security issues privately first:

- open a [GitHub security advisory](https://github.com/r3al1tym/isobar/security/advisories/new) (preferred), or
- open a regular issue **without** exploit details and ask for a private channel.
