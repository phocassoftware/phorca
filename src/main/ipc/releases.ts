import { app, ipcMain } from 'electron'
import { openReleasesPage } from '../releases-page'

const OPEN_RELEASES_CHANNEL = 'releases:open'
const GET_VERSION_CHANNEL = 'app:getVersion'

export function registerReleaseHandlers(): void {
  ipcMain.removeHandler(OPEN_RELEASES_CHANNEL)
  ipcMain.removeHandler(GET_VERSION_CHANNEL)
  ipcMain.handle(OPEN_RELEASES_CHANNEL, () => openReleasesPage())
  ipcMain.handle(GET_VERSION_CHANNEL, () => app.getVersion())
}
