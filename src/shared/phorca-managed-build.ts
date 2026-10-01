declare const PHORCA_MANAGED_BUILD: boolean

export function isPhorcaManagedBuild(): boolean {
  // Plain-Node CLI and daemon builds do not receive electron-vite's defines.
  // oxlint-disable-next-line unicorn/no-typeof-undefined -- An absent build-time identifier must not throw in plain Node.
  return typeof PHORCA_MANAGED_BUILD === 'undefined' || PHORCA_MANAGED_BUILD
}
