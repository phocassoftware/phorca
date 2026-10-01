import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Fs from 'node:fs'

const source = vi.hoisted(() => ({
  registry: vi.fn(),
  read: vi.fn(),
  stat: vi.fn()
}))

vi.mock('../windows-native-registry', () => ({
  WINDOWS_REG_SZ: 1,
  loadWindowsNativeRegistry: () => ({ HK: { LM: 2, CU: 1 }, getRegistryKey: source.registry })
}))
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof Fs>()),
  readFileSync: source.read,
  lstatSync: source.stat
}))

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('PHORCA_MANAGED_BUILD', true)
  source.registry.mockReset().mockReturnValue(null)
  source.read.mockReset().mockReturnValue('{"version":1,"allowPlugins":true}')
  source.stat.mockReset().mockReturnValue({
    uid: 0,
    mode: 0o100644,
    isSymbolicLink: () => false
  })
})

describe('Phorca administrator policy', () => {
  it('defaults every optional capability to denied and rejects unknown or malformed fields', async () => {
    const { phorcaManagedPolicySchema: schema } = await import('./managed-policy')
    expect(Object.values(schema.parse({ version: 1 })).slice(1)).toEqual(Array(7).fill(false))
    for (const document of [
      {},
      { version: 2 },
      { version: 1, allowPlugins: 'true' },
      { version: 1, allowPlugins: true, allowYolo: true }
    ]) {
      expect(schema.safeParse(document).success).toBe(false)
    }
  })

  it('reads only the machine policy registry and accepts only REG_SZ JSON', async () => {
    const { readPhorcaPolicyDocument } = await import('./managed-policy')
    source.registry.mockReturnValue({
      Policy: { type: 1, value: '{"version":1,"allowPlugins":true}' }
    })
    expect(readPhorcaPolicyDocument('win32')).toEqual({ version: 1, allowPlugins: true })
    expect(source.registry).toHaveBeenCalledWith(2, 'SOFTWARE\\Policies\\Phocas\\Phorca')
    source.registry.mockReturnValue({ Policy: { type: 2, value: '%USER_POLICY%' } })
    expect(readPhorcaPolicyDocument('win32')).toEqual({ version: 1 })
  })

  it.each(['darwin', 'linux'] as const)(
    'requires an administrator-owned %s policy and ancestors',
    async (platform) => {
      const { readPhorcaPolicyDocument } = await import('./managed-policy')
      expect(readPhorcaPolicyDocument(platform)).toEqual({ version: 1, allowPlugins: true })
      expect(source.stat.mock.calls.length).toBeGreaterThan(2)
      expect(source.read).toHaveBeenCalledWith(
        platform === 'darwin'
          ? '/Library/Application Support/Phocas/Phorca/policy.json'
          : '/etc/phocas/phorca/policy.json',
        'utf8'
      )
      for (const unsafe of [
        { uid: 1000, mode: 0o100644, isSymbolicLink: () => false },
        { uid: 0, mode: 0o100666, isSymbolicLink: () => false },
        { uid: 0, mode: 0o100644, isSymbolicLink: () => true }
      ]) {
        source.stat
          .mockReturnValueOnce({ uid: 0, mode: 0o100644, isSymbolicLink: () => false })
          .mockReturnValueOnce(unsafe)
        expect(() => readPhorcaPolicyDocument(platform)).toThrow('owned by root')
      }
    }
  )

  it.each([
    null,
    { Policy: { type: 1, value: '{' } },
    { Policy: { type: 1, value: '{"version":2,"allowPlugins":true}' } }
  ])('fails closed when policy is missing or invalid', async (registry) => {
    source.registry.mockReturnValue(registry)
    source.read.mockImplementation(() => {
      throw new Error('missing')
    })
    const { getPhorcaManagedPolicy, assertPhorcaCapabilityAllowed } =
      await import('./managed-policy')
    expect(getPhorcaManagedPolicy().allowPlugins).toBe(false)
    expect(() => assertPhorcaCapabilityAllowed('allowPlugins')).toThrow('administrator policy')
  })

  it('freezes policy for the process lifetime and keeps upstream behavior when explicitly unmanaged', async () => {
    source.registry.mockReturnValue({
      Policy: { type: 1, value: '{"version":1,"allowPlugins":true}' }
    })
    const { getPhorcaManagedPolicy, assertPhorcaCapabilityAllowed } =
      await import('./managed-policy')
    expect(getPhorcaManagedPolicy().allowPlugins).toBe(true)
    expect(Reflect.set(getPhorcaManagedPolicy(), 'allowComputerUse', true)).toBe(false)
    source.registry.mockReturnValue(null)
    expect(() => assertPhorcaCapabilityAllowed('allowPlugins')).not.toThrow()
    vi.stubGlobal('PHORCA_MANAGED_BUILD', false)
    expect(getPhorcaManagedPolicy().allowComputerUse).toBe(true)
  })
})
