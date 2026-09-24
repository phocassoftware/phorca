/** Public Phorca releases page. Every update affordance (menu, tray, settings,
 * sidebar help) opens this in the system browser instead of running an
 * in-app updater. */
export const PHORCA_RELEASES_URL = 'https://github.com/phocassoftware/phorca/releases'

/** Release-notes URL for a specific version when known, otherwise the
 * releases index. Phorca tags releases `phorca-v<version>`. */
export function getReleaseNotesUrlForVersion(version: string | null): string {
  if (!version) {
    return PHORCA_RELEASES_URL
  }
  const normalized = version.startsWith('v') ? version.slice(1) : version
  return `${PHORCA_RELEASES_URL}/tag/phorca-v${normalized}`
}
