import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const updaterApi = {
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
  openReleasesPage: (): Promise<void> => ipcRenderer.invoke('releases:open')
} satisfies PreloadApi['updater']
