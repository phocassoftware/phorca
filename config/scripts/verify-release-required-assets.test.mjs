import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getRequiredReleaseAssetNames,
  validateReleaseAssetNames,
  verifyRequiredReleaseAssets
} from './verify-release-required-assets.mjs'

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: vi.fn(async () => body),
    text: vi.fn(async () => (typeof body === 'string' ? body : JSON.stringify(body)))
  }
}

function releaseWithAssets(tag, assetNames, overrides = {}) {
  return {
    tag_name: tag,
    draft: true,
    prerelease: false,
    assets: assetNames.map((name, index) => ({
      id: index + 1,
      name,
      state: 'uploaded',
      size: 123,
      ...overrides[name]
    }))
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getRequiredReleaseAssetNames', () => {
  it('returns the exact managed Windows, macOS, and evidence allowlist independent of tag', () => {
    const expected = [
      'q004-placeholder-windows-setup.exe',
      'q004-placeholder-macos-x64.dmg',
      'q004-placeholder-macos-arm64.dmg',
      'evidence-manifest.json'
    ]

    expect(getRequiredReleaseAssetNames('v1.4.27')).toEqual(expected)
    expect(getRequiredReleaseAssetNames('phorca-v99.0.0')).toEqual(expected)
  })
})

describe('validateReleaseAssetNames', () => {
  it('reports missing, duplicate, and unexpected names without a blocklist', () => {
    expect(
      validateReleaseAssetNames({
        tag: 'v1.4.27',
        assetNames: [
          'q004-placeholder-windows-setup.exe',
          'q004-placeholder-windows-setup.exe',
          'q004-placeholder-macos-x64.dmg',
          'latest.yml'
        ]
      })
    ).toEqual({
      required: [
        'q004-placeholder-windows-setup.exe',
        'q004-placeholder-macos-x64.dmg',
        'q004-placeholder-macos-arm64.dmg',
        'evidence-manifest.json'
      ],
      duplicates: ['q004-placeholder-windows-setup.exe'],
      missing: ['evidence-manifest.json', 'q004-placeholder-macos-arm64.dmg'],
      unexpected: ['latest.yml']
    })
  })
})

describe('verifyRequiredReleaseAssets', () => {
  it('accepts one uploaded asset for every allowlisted name', async () => {
    const tag = 'v1.4.27'
    const required = getRequiredReleaseAssetNames(tag)
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([releaseWithAssets(tag, required)]))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      verifyRequiredReleaseAssets({ repo: 'phocassoftware/phorca', tag, token: 'token' })
    ).resolves.toMatchObject({ tag, checked: required, draft: true, prerelease: false })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fails on missing metadata, duplicate assets, sidecars, non-uploaded assets, and empty assets', async () => {
    const tag = 'v1.4.27'
    const required = getRequiredReleaseAssetNames(tag)
    const names = [
      'q004-placeholder-windows-setup.exe',
      'q004-placeholder-windows-setup.exe',
      'q004-placeholder-macos-x64.dmg',
      'latest.yml',
      ...required.filter((name) => name === 'evidence-manifest.json')
    ]
    const release = releaseWithAssets(tag, names, {
      'q004-placeholder-macos-x64.dmg': { state: 'created', size: 0 }
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([release])))

    await expect(
      verifyRequiredReleaseAssets({ repo: 'phocassoftware/phorca', tag, token: 'token' })
    ).rejects.toThrow(
      [
        'Missing: q004-placeholder-macos-arm64.dmg',
        'Duplicate: q004-placeholder-windows-setup.exe',
        'Unexpected: latest.yml',
        'Not uploaded: q004-placeholder-macos-x64.dmg:created',
        'Empty: q004-placeholder-macos-x64.dmg'
      ].join('\n')
    )
  })
})
