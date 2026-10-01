import { lstatSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'
import { isPhorcaManagedBuild } from '../../shared/phorca-managed-build'
import { loadWindowsNativeRegistry, WINDOWS_REG_SZ } from '../windows-native-registry'

export const phorcaManagedPolicySchema = z
  .object({
    version: z.literal(1),
    allowComputerUse: z.boolean().default(false),
    allowAutomations: z.boolean().default(false),
    allowNetworkListeners: z.boolean().default(false),
    allowCloudServices: z.boolean().default(false),
    allowTelemetry: z.boolean().default(false),
    allowRuntimeDownloads: z.boolean().default(false),
    allowPlugins: z.boolean().default(false)
  })
  .strict()

export type PhorcaManagedPolicy = z.infer<typeof phorcaManagedPolicySchema>
export type PhorcaManagedCapability = Exclude<keyof PhorcaManagedPolicy, 'version'>

const RESTRICTED_POLICY = phorcaManagedPolicySchema.parse({ version: 1 })
const UNMANAGED_POLICY: PhorcaManagedPolicy = {
  version: 1,
  allowComputerUse: true,
  allowAutomations: true,
  allowNetworkListeners: true,
  allowCloudServices: true,
  allowTelemetry: true,
  allowRuntimeDownloads: true,
  allowPlugins: true
}
let managedPolicy: PhorcaManagedPolicy | undefined

export function readPhorcaPolicyDocument(platform: NodeJS.Platform = process.platform): unknown {
  if (platform === 'win32') {
    const registry = loadWindowsNativeRegistry()
    const value = registry.getRegistryKey(
      registry.HK.LM,
      'SOFTWARE\\Policies\\Phocas\\Phorca'
    )?.Policy
    if (value?.type !== WINDOWS_REG_SZ || typeof value.value !== 'string') {
      return { version: 1 }
    }
    return JSON.parse(value.value)
  }
  const path =
    platform === 'darwin'
      ? '/Library/Application Support/Phocas/Phorca/policy.json'
      : '/etc/phocas/phorca/policy.json'
  // Check ancestors too: a writable parent would allow replacing a root-owned policy.
  for (let entry = path; ; entry = dirname(entry)) {
    const stat = lstatSync(entry)
    if (stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o022) !== 0) {
      throw new Error('Phorca policy must be owned by root and not writable by other users')
    }
    if (entry === dirname(entry)) {
      break
    }
  }
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function getPhorcaManagedPolicy(): Readonly<PhorcaManagedPolicy> {
  if (!isPhorcaManagedBuild()) {
    return UNMANAGED_POLICY
  }
  if (!managedPolicy) {
    try {
      managedPolicy = phorcaManagedPolicySchema.parse(readPhorcaPolicyDocument())
    } catch {
      managedPolicy = RESTRICTED_POLICY
      console.warn('[phorca] Managed policy unavailable or invalid; restricted defaults apply')
    }
    Object.freeze(managedPolicy)
  }
  return managedPolicy
}

export function assertPhorcaCapabilityAllowed(capability: PhorcaManagedCapability): void {
  if (!isPhorcaManagedBuild()) {
    return
  }
  const allowed = getPhorcaManagedPolicy()[capability]
  if (!allowed) {
    throw new Error(`Phorca administrator policy disables ${capability}`)
  }
}
