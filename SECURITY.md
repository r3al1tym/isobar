# Security

isobar reads your repository through git and draws a pane. It never writes to the repository, runs no code from it and makes no network calls of its own.

## What it runs and reads

- **git, read-only.** `rev-parse`, `grep`, `log`, `diff`, `ls-files`, `show` and `hash-object` (without `-w`, so it hashes a file and stores nothing), in the repository of the file Claude last edited.
- **Its own environment.** One `sh` call reads the environment Claude Code started with (`/proc/$PPID/environ` on Linux) to learn how many colours the terminal paints. Nothing from it is stored or sent.
- **`.isobar/map.json`** in the repository, when present, as the shared basemap.

## What leaves your machine

Every model call goes through Claude Code's own model access, so it follows whatever provider and policy your Claude Code uses.

- **The basemap, once per repository.** Made with the session's own model, or `mapModel` when set. The prompt carries the repository's folder name and up to about 160 units: file and folder paths, their file and line counts, and up to four imported file names per file. It carries no file contents. The map is kept in Claude Code's plugin store, so later sessions make no call; `/isobar map` draws it again.
- **The scope check, only when `scope` is `on`.** After each turn that changes files, one call to `scopeModel` (default `haiku`) carries your last four requests from the conversation (up to 1,500 characters each), the turn's changed paths with their line counts and touched declaration names, and up to 400 lines of their diff (60 per file). That is file contents: the same lines Claude itself just wrote and read. With `scope` off, the default, no call is made.

## Threat model

A cloned repository controls its own file names, and those names reach the pane, the basemap prompt and the `p` key's question.

- **The pane.** Every glyph goes through a printable-character filter before it is drawn, and the Raster takes code points, never escape sequences, so a file name cannot drive your terminal.
- **The basemap prompt.** A file name could try to steer the model. Its answer is parsed as JSON, its names and blurbs are clipped to a few words, and its paths are only used to place files, so the worst outcome is an odd region name.
- **The scope check.** A diff could carry text that tries to steer the check. Its answer is parsed as JSON, only paths it was shown are kept, and a flag only draws an `UNASKED` badge and a short note: the worst outcome is a wrong badge, or a missing one. Treat the badge as a prompt to look, never as proof that a change is safe.
- **The `p` key.** It submits a question to Claude as you, naming the files on the far import chain. In a repository you do not trust, read the chain on the pane before pressing `p`: Claude then reads those files and may run their tests under your normal permission settings.

## Reporting a vulnerability

Please report security issues privately first:

- open a [GitHub security advisory](https://github.com/r3al1tym/isobar/security/advisories/new) (preferred), or
- open a regular issue **without** exploit details and ask for a private channel.
