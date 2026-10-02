/** Clones every repo in repos.json (blobless) and checks out its pinned commit. */
import { existsSync } from 'node:fs'
import { picked, rootOf, run } from './isobar.mts'

for (const repo of picked()) {
  const dir = rootOf(repo)

  if (!existsSync(dir)) await run(['git', 'clone', '-q', '--filter=blob:none', repo.url, dir])
  const r = await run(['git', '-C', dir, '-c', 'advice.detachedHead=false', 'checkout', '-q', repo.sha])

  console.log(repo.name, r.exitCode === 0 ? repo.sha : 'checkout failed')
}
