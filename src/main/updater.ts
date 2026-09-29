import { app, type BrowserWindow } from 'electron'
import type {
  LinuxPackageInstallInstructions,
  UpdateCheckOptions,
  UpdateStatus
} from '../shared/update-status-types'
import type {
  RemoteServerUpdateInstallResult,
  RemoteServerUpdaterSnapshot,
  RemoteServerUpdateSupport
} from '../shared/remote-server-update'
import type { ReleaseBuild, ReleaseChannel } from '../shared/release-channel'
import type { ReleaseBuildListOptions } from './updater-release-build-cache'
import { UpdaterSetup, type UpdaterSetupOptions } from './updater/updater-setup'
import type { UpdateInstallMode } from './updater/updater-state'
import { openReleasesPage } from './releases-page'

const IS_PHORCA_MANAGED_BUILD = typeof PHORCA_MANAGED_BUILD !== 'undefined' && PHORCA_MANAGED_BUILD

// Keep one service instance so all public API calls share updater state and event listeners.
const updater = new UpdaterSetup()

export type { UpdateInstallMode, UpdaterSetupOptions }

export function resolveUpdateInstallMode(isServeMode: boolean): UpdateInstallMode {
  return updater.resolveUpdateInstallMode(isServeMode)
}

export function getUpdateStatus(): UpdateStatus {
  return updater.getUpdateStatus()
}

export function getRemoteServerUpdateSupport(): RemoteServerUpdateSupport {
  if (IS_PHORCA_MANAGED_BUILD) {
    return {
      installMode: 'unsupported-headless-serve',
      automatic: false,
      reason: 'updater-unavailable'
    }
  }
  return updater.getRemoteServerUpdateSupport()
}

export function getRemoteServerUpdaterSnapshot(runtimeId: string): RemoteServerUpdaterSnapshot {
  if (IS_PHORCA_MANAGED_BUILD) {
    return {
      appVersion: app.getVersion(),
      runtimeId,
      support: getRemoteServerUpdateSupport(),
      status: { state: 'idle' }
    }
  }
  return updater.getRemoteServerUpdaterSnapshot(runtimeId)
}

export function checkForRemoteServerUpdate(
  runtimeId: string,
  options?: UpdateCheckOptions
): RemoteServerUpdaterSnapshot {
  if (IS_PHORCA_MANAGED_BUILD) {
    return getRemoteServerUpdaterSnapshot(runtimeId)
  }
  return updater.checkForRemoteServerUpdate(runtimeId, options)
}

export function downloadRemoteServerUpdate(runtimeId: string): RemoteServerUpdaterSnapshot {
  if (IS_PHORCA_MANAGED_BUILD) {
    return getRemoteServerUpdaterSnapshot(runtimeId)
  }
  return updater.downloadRemoteServerUpdate(runtimeId)
}

export function installRemoteServerUpdate(runtimeId: string): RemoteServerUpdateInstallResult {
  if (IS_PHORCA_MANAGED_BUILD) {
    throw new Error('Phorca updates are available from the managed releases page.')
  }
  return updater.installRemoteServerUpdate(runtimeId)
}

export function checkForUpdates(): void {
  if (!IS_PHORCA_MANAGED_BUILD) {
    updater.checkForUpdates()
  }
}

export function checkForUpdatesFromMenu(options?: UpdateCheckOptions): void {
  if (IS_PHORCA_MANAGED_BUILD) {
    void openReleasesPage()
    return
  }
  updater.checkForUpdatesFromMenu(options)
}

export function downloadUpdate(): void {
  if (!IS_PHORCA_MANAGED_BUILD) {
    updater.downloadUpdate()
  }
}

export function quitAndInstall(): void {
  if (!IS_PHORCA_MANAGED_BUILD) {
    updater.quitAndInstall()
  }
}

export function isQuittingForUpdate(): boolean {
  return IS_PHORCA_MANAGED_BUILD ? false : updater.isQuittingForUpdate()
}

export async function getLinuxPackageInstallInstructions(): Promise<LinuxPackageInstallInstructions> {
  return updater.getLinuxPackageInstallInstructions()
}

export async function showLinuxPackage(): Promise<void> {
  return updater.showLinuxPackage()
}

export async function listAvailableReleaseBuilds(
  channel: ReleaseChannel,
  options?: ReleaseBuildListOptions
): Promise<ReleaseBuild[]> {
  return IS_PHORCA_MANAGED_BUILD ? [] : updater.listAvailableReleaseBuilds(channel, options)
}

export function dismissNudge(): void {
  updater.dismissNudge()
}

export function dismissAvailableUpdate(): void {
  updater.dismissAvailableUpdate()
}

export function setupAutoUpdater(mainWindow: BrowserWindow, opts?: UpdaterSetupOptions): void {
  if (!IS_PHORCA_MANAGED_BUILD) {
    updater.setupAutoUpdater(mainWindow, opts)
  }
}
