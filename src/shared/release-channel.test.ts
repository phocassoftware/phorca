import { describe, expect, it } from 'vitest'
import { getReleaseNotesUrlForVersion, PHORCA_RELEASES_URL } from './release-channel'

describe('Phorca release links', () => {
  it('uses the Phorca tag convention for release notes', () => {
    expect(getReleaseNotesUrlForVersion('1.4.160')).toBe(
      `${PHORCA_RELEASES_URL}/tag/phorca-v1.4.160`
    )
    expect(getReleaseNotesUrlForVersion('v1.4.160-rc.3')).toBe(
      `${PHORCA_RELEASES_URL}/tag/phorca-v1.4.160-rc.3`
    )
  })

  it('uses the releases index when no version is available', () => {
    expect(getReleaseNotesUrlForVersion(null)).toBe(PHORCA_RELEASES_URL)
  })
})
