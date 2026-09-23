import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectDevChannelPackagingProblems } from './verify-dev-channel-packaging.mjs'

const require = createRequire(import.meta.url)
const CONFIG_PATH = resolve(import.meta.dirname, '../electron-builder.config.cjs')

/** The config reads process.env at require time, so each channel needs a fresh load. */
function loadConfigWithEnv(env, { allowPlaceholder = true } = {}) {
  const saved = { ...process.env }
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('ORCA_') || key.startsWith('PHORCA_')) {
      delete process.env[key]
    }
  }
  if (allowPlaceholder) {
    process.env.PHORCA_ALLOW_PLACEHOLDER_IDENTITY = '1'
  }
  Object.assign(process.env, env)
  try {
    delete require.cache[require.resolve(CONFIG_PATH)]
    return require(CONFIG_PATH)
  } finally {
    process.env = saved
    delete require.cache[require.resolve(CONFIG_PATH)]
  }
}

const WIN_ADHOC_ENV = {
  ORCA_WIN_ADHOC: '1',
  ORCA_ADHOC_BUILD_VERSION: '1.4.178-adhoc.20260819010203'
}

const MAC_ADHOC_ENV = {
  ORCA_MAC_ADHOC: '1',
  ORCA_ADHOC_BUILD_VERSION: '1.4.178-adhoc.20260819010203'
}

const EXPECTED_MAC_TARGET = [{ target: 'dmg', arch: ['x64', 'arm64'] }]

afterEach(() => {
  delete require.cache[require.resolve(CONFIG_PATH)]
})

describe('electron-builder managed packaging policy', () => {
  it('keeps the unresolved Q-004 identity loud while removing publisher and updater metadata', () => {
    const config = loadConfigWithEnv({})

    expect(config.appId).toContain('q004-placeholder')
    expect(config.productName).toContain('q004-placeholder')
    expect(config.publish).toBeUndefined()
    expect(config.win.target).toEqual(['nsis'])
    expect(config.win.signtoolOptions).toBeUndefined()
    expect(config.mac.target).toEqual(EXPECTED_MAC_TARGET)
    expect(config.mac.identity).toBe('-')
    expect(config.mac.notarize).toBeUndefined()
    expect(config.mac.hardenedRuntime).toBeUndefined()
    expect(config.forceCodeSigning).toBeUndefined()
  })
  it('fails closed when unresolved identity lacks the explicit local opt-in', () => {
    expect(() => loadConfigWithEnv({}, { allowPlaceholder: false })).toThrow(
      'PHORCA_ALLOW_PLACEHOLDER_IDENTITY=1'
    )
  })

  it.each([
    ['hourly', { ORCA_WIN_HOURLY: '1', ORCA_HOURLY_BUILD_VERSION: '1.2.3-hourly' }, '1.2.3-hourly'],
    ['daily', { ORCA_WIN_DAILY: '1', ORCA_DAILY_BUILD_VERSION: '1.2.3-daily' }, '1.2.3-daily'],
    ['adhoc', WIN_ADHOC_ENV, WIN_ADHOC_ENV.ORCA_ADHOC_BUILD_VERSION]
  ])('injects the allocated %s version without enabling a publisher', (_channel, env, version) => {
    const config = loadConfigWithEnv(env)

    expect(config.extraMetadata).toEqual({ version })
    expect(config.publish).toBeUndefined()
    expect(config.win.target).toEqual(['nsis'])
  })

  it('keeps macOS channel builds ad-hoc signed and DMG-only', () => {
    const config = loadConfigWithEnv(MAC_ADHOC_ENV)

    expect(config.extraMetadata).toEqual({ version: MAC_ADHOC_ENV.ORCA_ADHOC_BUILD_VERSION })
    expect(config.publish).toBeUndefined()
    expect(config.mac.target).toEqual(EXPECTED_MAC_TARGET)
    expect(config.mac.identity).toBe('-')
    expect(config.mac.notarize).toBeUndefined()
    expect(config.mac.hardenedRuntime).toBeUndefined()
  })
})

describe('collectDevChannelPackagingProblems', () => {
  const version = '1.4.178-adhoc.20260819010203'
  const env = { ORCA_ADHOC_BUILD_VERSION: version }
  const goodWinConfig = {
    extraMetadata: { version },
    win: { target: ['nsis'] }
  }
  const goodMacConfig = {
    extraMetadata: { version },
    mac: { target: EXPECTED_MAC_TARGET, identity: '-' }
  }

  it('accepts a correctly configured Windows dev build', () => {
    expect(
      collectDevChannelPackagingProblems({
        channel: 'adhoc',
        platform: 'win32',
        config: goodWinConfig,
        env
      })
    ).toEqual([])
  })

  it('rejects any publisher configuration even when the targets are otherwise valid', () => {
    const problems = collectDevChannelPackagingProblems({
      channel: 'adhoc',
      platform: 'win32',
      config: { ...goodWinConfig, publish: {} },
      env
    })

    expect(problems).toContain(
      'electron-builder publish configuration must be absent for managed Phorca builds.'
    )
  })

  it('rejects a Windows dev build with a non-NSIS target or signing options', () => {
    const problems = collectDevChannelPackagingProblems({
      channel: 'adhoc',
      platform: 'win32',
      config: {
        ...goodWinConfig,
        win: { target: ['portable'], signtoolOptions: { publisherName: 'unexpected' } }
      },
      env
    })

    expect(problems.join('\n')).toContain('win.target must contain exactly one "nsis" target')
    expect(problems.join('\n')).toContain('win.signtoolOptions must be absent')
  })

  it('rejects a build packaging a version other than the allocated channel version', () => {
    const problems = collectDevChannelPackagingProblems({
      channel: 'adhoc',
      platform: 'win32',
      config: { ...goodWinConfig, extraMetadata: { version: '1.4.178' } },
      env
    })

    expect(problems.join('\n')).toContain('but the workflow computed')
  })

  it('accepts a correctly configured macOS dev build', () => {
    expect(
      collectDevChannelPackagingProblems({
        channel: 'adhoc',
        platform: 'darwin',
        config: goodMacConfig,
        env
      })
    ).toEqual([])
  })

  it('rejects a macOS build that adds a ZIP target or signing/notarization policy', () => {
    const problems = collectDevChannelPackagingProblems({
      channel: 'adhoc',
      platform: 'darwin',
      config: {
        ...goodMacConfig,
        mac: {
          target: ['dmg', 'zip'],
          identity: 'Developer ID Application: unexpected',
          notarize: true,
          hardenedRuntime: true
        },
        forceCodeSigning: true
      },
      env
    })

    expect(problems.join('\n')).toContain('mac.target must contain exactly one "dmg" target')
    expect(problems.join('\n')).toContain('mac.identity must be "-"')
    expect(problems.join('\n')).toContain('mac.notarize must be absent')
    expect(problems.join('\n')).toContain('mac.hardenedRuntime must be absent')
    expect(problems.join('\n')).toContain('forceCodeSigning must be absent')
  })

  it('rejects an unknown channel', () => {
    expect(
      collectDevChannelPackagingProblems({
        channel: 'nightly',
        platform: 'win32',
        config: goodWinConfig,
        env
      })
    ).toEqual(['Unknown dev channel "nightly"; expected one of hourly, daily, adhoc.'])
  })
})
