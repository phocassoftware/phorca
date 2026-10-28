import { readFileSync } from 'node:fs'
import { assertOrcaReleaseVersion } from './orca-release-version.mjs'
import { parseDesktopStableTag } from './latest-stable-release.mjs'
import { runProcessSync } from './script-child-process.mjs'

const tag = process.argv[2]
if (process.argv.length !== 3 || !parseDesktopStableTag(tag ?? '')) {
  throw new Error('Usage: node config/scripts/check-orca-release-version.mjs vX.Y.Z')
}
const git = (args) => {
  const result = runProcessSync({ program: 'git', args, cwd: process.cwd(), timeoutMs: 10_000 })
  if (result.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  }
  return result.stdout
}
const releaseRef = `refs/tags/${tag}`
git(['merge-base', '--is-ancestor', `${releaseRef}^{commit}`, 'HEAD'])
assertOrcaReleaseVersion(git(['show', `${releaseRef}:package.json`]), tag, { source: releaseRef })
assertOrcaReleaseVersion(readFileSync('package.json', 'utf8'), tag)
console.log(`Package version matches imported Orca ${tag}.`)
