import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'
import {
  matchingDesktopReleases,
  restorePublishedDesktopReleasesToDraft
} from './assert-github-release-is-draft.mjs'

const require = createRequire(import.meta.url)

function jsonResponse(body, init = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    json: vi.fn(async () => body),
    text: vi.fn(async () => JSON.stringify(body))
  }
}

describe('matchingDesktopReleases', () => {
  it('matches tagged, untagged-name, and version-name releases', () => {
    const releases = [
      { id: 1, tag_name: 'v1.4.206', name: 'v1.4.206', draft: true },
      { id: 2, tag_name: 'untagged-abc', name: '1.4.206', draft: false },
      { id: 3, tag_name: 'v1.4.205', name: 'v1.4.205', draft: false }
    ]

    expect(matchingDesktopReleases(releases, 'v1.4.206').map((release) => release.id)).toEqual([
      1, 2
    ])
  })
})

describe('restorePublishedDesktopReleasesToDraft', () => {
  it('leaves drafts alone', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse([{ id: 1, tag_name: 'v1.4.206', name: 'v1.4.206', draft: true }])
      )

    await expect(
      restorePublishedDesktopReleasesToDraft({
        repo: 'stablyai/orca',
        tag: 'v1.4.206',
        token: 'token',
        fetchImpl,
        log: vi.fn()
      })
    ).resolves.toEqual([])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('re-drafts a published match immediately', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse([{ id: 9, tag_name: 'v1.4.206', name: '1.4.206', draft: false }])
      )
      .mockResolvedValueOnce(jsonResponse({ id: 9, tag_name: 'v1.4.206', draft: true }))

    const log = vi.fn()
    await expect(
      restorePublishedDesktopReleasesToDraft({
        repo: 'stablyai/orca',
        tag: 'v1.4.206',
        token: 'token',
        fetchImpl,
        log
      })
    ).resolves.toEqual([{ id: 9, tag_name: 'v1.4.206', draft: true }])

    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://api.github.com/repos/stablyai/orca/releases/9',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ draft: true, make_latest: 'false' })
      })
    )
    expect(log).toHaveBeenCalledWith('Restored GitHub release 9 (v1.4.206) to draft.')
  })

  it('fails closed when no matching release exists', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse([]))

    await expect(
      restorePublishedDesktopReleasesToDraft({
        repo: 'stablyai/orca',
        tag: 'v1.4.206',
        token: 'token',
        fetchImpl
      })
    ).rejects.toThrow('No GitHub release named v1.4.206 was found after artifact upload')
  })
})

describe('release draft configuration', () => {
  it('configures desktop release publishing as draft', () => {
    const electronBuilderConfig = require('../electron-builder.config.cjs')
    expect(electronBuilderConfig.publish.releaseType).toBe('draft')
  })
})
