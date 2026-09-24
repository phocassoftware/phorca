import type { PreloadApi } from '../../../../preload/api-types'
import { PHORCA_RELEASES_URL } from '../../../../shared/release-channel'

export function createUpdaterApi(): PreloadApi['updater'] {
  return {
    getVersion: () => Promise.resolve('web'),
    openReleasesPage: () => {
      const openedWindow = window.open(PHORCA_RELEASES_URL, '_blank', 'noopener,noreferrer')
      if (openedWindow) {
        return Promise.resolve()
      }
      const message = `The Phorca Releases page could not be opened. Try opening ${PHORCA_RELEASES_URL} in your browser.`
      console.error(`[releases] ${message}`)
      window.alert?.(message)
      return Promise.resolve()
    }
  }
}
