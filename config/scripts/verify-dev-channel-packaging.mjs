#!/usr/bin/env node
// Validate legacy channel builds against Phorca's managed packaging policy.
// Channels may still inject an allocated version, but they must never regain
// an electron-builder publisher or a signing identity through this seam.

import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const CHANNEL_VERSION_ENV = {
  hourly: 'ORCA_HOURLY_BUILD_VERSION',
  daily: 'ORCA_DAILY_BUILD_VERSION',
  adhoc: 'ORCA_ADHOC_BUILD_VERSION'
}

export function collectDevChannelPackagingProblems({ channel, platform, config, env }) {
  const problems = []
  const versionVariable = CHANNEL_VERSION_ENV[channel]
  if (!versionVariable) {
    return [
      `Unknown dev channel "${channel}"; expected one of ${Object.keys(CHANNEL_VERSION_ENV).join(', ')}.`
    ]
  }

  if (config.publish !== undefined) {
    problems.push('electron-builder publish configuration must be absent for managed Phorca builds.')
  }

  const expectedVersion = env[versionVariable]
  if (expectedVersion && config.extraMetadata?.version !== expectedVersion) {
    problems.push(
      `extraMetadata.version is "${config.extraMetadata?.version}" but the workflow computed "${expectedVersion}".`
    )
  }

  if (platform === 'win32') {
    const targets = config.win?.target ?? []
    const targetNames = targets.map((target) =>
      typeof target === 'string' ? target : target.target
    )
    if (targetNames.length !== 1 || targetNames[0] !== 'nsis') {
      problems.push(`win.target must contain exactly one "nsis" target, got ${JSON.stringify(targets)}.`)
    }
    if (config.win?.signtoolOptions !== undefined) {
      problems.push('win.signtoolOptions must be absent because Windows artifacts are unsigned.')
    }
  }

  if (platform === 'darwin') {
    const targets = config.mac?.target ?? []
    const targetNames = targets.map((target) =>
      typeof target === 'string' ? target : target.target
    )
    if (targetNames.length !== 1 || targetNames[0] !== 'dmg') {
      problems.push(`mac.target must contain exactly one "dmg" target, got ${JSON.stringify(targets)}.`)
    }
    if (config.mac?.identity !== '-') {
      problems.push('mac.identity must be "-" for identity-less ad-hoc signing.')
    }
    for (const key of ['notarize', 'hardenedRuntime']) {
      if (config.mac?.[key] !== undefined) {
        problems.push(`mac.${key} must be absent; managed builds are not notarized or hardened.`)
      }
    }
    if (config.forceCodeSigning !== undefined) {
      problems.push('forceCodeSigning must be absent for ad-hoc signing.')
    }
  }

  return problems
}

function parseArgs(argv) {
  const args = {}
  for (const entry of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(entry)
    if (match) {
      args[match[1]] = match[2]
    }
  }
  return args
}

function main() {
  const { channel, platform = process.platform } = parseArgs(process.argv.slice(2))
  if (!channel) {
    console.error(
      'Usage: verify-dev-channel-packaging.mjs --channel=<hourly|daily|adhoc> [--platform=win32|darwin]'
    )
    process.exit(1)
  }
  const require = createRequire(import.meta.url)
  const config = require(resolve(import.meta.dirname, '../electron-builder.config.cjs'))
  const problems = collectDevChannelPackagingProblems({
    channel,
    platform,
    config,
    env: process.env
  })
  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(`::error::${problem}`)
    }
    process.exit(1)
  }
  console.log(
    `Managed packaging verified: ${channel} on ${platform} @ ${config.extraMetadata?.version ?? 'default version'}; publisher disabled.`
  )
}

// Why the guard: the test imports the pure collector without running the CLI.
// pathToFileURL, not a `file://` template: this also runs on Windows, where a
// drive-letter path does not concatenate into a valid URL.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
