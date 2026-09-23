#!/usr/bin/env node

import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const { getPhorcaArtifactNames } = require('./phorca-package-identity.cjs')
const API_VERSION = '2022-11-28'

// Q-003 keeps the current dual-architecture macOS matrix. Change this one
// constant when the approved platform matrix changes; the allowlist remains
// exact for every architecture selected here.
export const MAC_RELEASE_ARCHES = Object.freeze(['x64', 'arm64'])
const EVIDENCE_MANIFEST_ASSET = 'evidence-manifest.json'

export function getRequiredReleaseAssetNames(_tag) {
  const artifactNames = getPhorcaArtifactNames()
  return [
    `${artifactNames.windowsInstaller}.exe`,
    ...MAC_RELEASE_ARCHES.map((arch) => `${artifactNames.macDmg}-${arch}.dmg`),
    EVIDENCE_MANIFEST_ASSET
  ]
}


export function validateReleaseAssetNames({ tag, assetNames }) {
  const required = getRequiredReleaseAssetNames(tag)
  const counts = new Map()
  for (const name of assetNames) {
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const duplicates = [...counts]
    .filter(([, count]) => count > 1)
    .map(([name]) => name)
    .sort()
  const expected = new Set(required)
  const present = new Set(assetNames)
  return {
    required,
    duplicates,
    missing: required.filter((name) => !present.has(name)).sort(),
    unexpected: [...present].filter((name) => !expected.has(name)).sort()
  }
}


async function githubFetch(url, token, accept = 'application/vnd.github+json') {
  const res = await fetch(url, {
    headers: {
      Accept: accept,
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': API_VERSION
    }
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`GitHub request failed ${res.status} ${res.statusText}: ${body.slice(0, 300)}`)
  }
  return res
}

async function fetchRelease(repo, tag, token) {
  // The publish gate runs while the release is still draft.
  const res = await githubFetch(`https://api.github.com/repos/${repo}/releases?per_page=100`, token)
  const releases = await res.json()
  if (!Array.isArray(releases)) {
    throw new Error(`GitHub releases response for ${repo} was not an array`)
  }
  const release = releases.find((candidate) => candidate.tag_name === tag)
  if (!release) {
    throw new Error(`Release ${repo}@${tag} was not found in the draft-aware releases list`)
  }
  return release
}


export async function verifyRequiredReleaseAssets({ repo, tag, token }) {
  const release = await fetchRelease(repo, tag, token)
  if (!Array.isArray(release.assets)) {
    throw new Error(`Release ${repo}@${tag} returned a non-array assets field`)
  }

  const assetNames = release.assets.map((asset) => asset.name)
  const validation = validateReleaseAssetNames({ tag, assetNames })
  const assetsByName = new Map(release.assets.map((asset) => [asset.name, asset]))
  const notUploaded = validation.required
    .map((name) => assetsByName.get(name))
    .filter((asset) => asset && asset.state && asset.state !== 'uploaded')
    .map((asset) => `${asset.name}:${asset.state}`)
    .sort()
  const empty = validation.required
    .map((name) => assetsByName.get(name))
    .filter((asset) => asset && asset.size === 0)
    .map((asset) => asset.name)
    .sort()

  if (
    validation.missing.length > 0 ||
    validation.duplicates.length > 0 ||
    validation.unexpected.length > 0 ||
    notUploaded.length > 0 ||
    empty.length > 0
  ) {
    throw new Error(
      [
        `Release ${tag} has an invalid asset set.`,
        validation.missing.length > 0 ? `Missing: ${validation.missing.join(', ')}` : null,
        validation.duplicates.length > 0
          ? `Duplicate: ${validation.duplicates.join(', ')}`
          : null,
        validation.unexpected.length > 0
          ? `Unexpected: ${validation.unexpected.join(', ')}`
          : null,
        notUploaded.length > 0 ? `Not uploaded: ${notUploaded.join(', ')}` : null,
        empty.length > 0 ? `Empty: ${empty.join(', ')}` : null
      ]
        .filter(Boolean)
        .join('\n')
    )
  }

  return {
    tag,
    checked: validation.required,
    draft: release.draft,
    prerelease: release.prerelease
  }
}

async function main() {
  const tag = process.argv[2]
  if (!tag) {
    throw new Error('Usage: node config/scripts/verify-release-required-assets.mjs <tag>')
  }
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  if (!token) {
    throw new Error('GH_TOKEN or GITHUB_TOKEN must be set')
  }
  const repo = process.env.GITHUB_REPOSITORY || 'phocassoftware/phorca'
  const result = await verifyRequiredReleaseAssets({ repo, tag, token })
  console.log(`Verified ${result.checked.length} required release assets for ${repo}@${tag}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
