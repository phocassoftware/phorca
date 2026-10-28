import { compareDesktopVersions } from './create-draft-release.mjs'
import { parseDesktopStableTag } from './latest-stable-release.mjs'

export function assertOrcaReleaseVersion(contents, tag, { source, allowNewer = false } = {}) {
  const expected = parseDesktopStableTag(tag)
  if (!expected) {
    throw new Error('Expected a stable Orca release tag: vX.Y.Z.')
  }
  const version = JSON.parse(contents).version
  const actual = typeof version === 'string' && parseDesktopStableTag(`v${version}`)
  const comparison = actual ? compareDesktopVersions(actual, expected) : null
  if (comparison === 0 || (allowNewer && comparison > 0)) {
    return
  }
  throw new Error(
    `${source ?? 'package.json'} has version ${JSON.stringify(version)}; expected ${tag.slice(1)}${allowNewer ? ' or newer' : ''} for Orca ${tag}. ` +
      'Release ancestry does not prove the package version is correct. Resolve only the version field against the imported release, then rerun. Do not downgrade a newer release.'
  )
}
