/** Public Phorca releases page. Every update affordance (menu, tray, settings,
 *  sidebar help) opens this in the system browser instead of running an
 *  in-app updater. */
export const PHORCA_RELEASES_URL = 'https://github.com/phocassoftware/phorca/releases'

/** Release-notes URL for a specific version when known, otherwise the
 *  releases index. Phorca tags releases `v<version>`. */
export function getReleaseNotesUrlForVersion(version: string | null): string {
  if (!version) {
    return PHORCA_RELEASES_URL
  }
  const tag = version.startsWith('v') ? version : `v${version}`
  return `${PHORCA_RELEASES_URL}/tag/${tag}`
}
