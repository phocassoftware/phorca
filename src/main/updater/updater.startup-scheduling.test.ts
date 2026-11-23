import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { UpdaterSetup } from './lifecycle/updater-setup'
import { beginMacUpdateDownload } from './mac-install/updater-mac-install'
import type * as NudgeCampaign from './nudges/nudge-campaign'
import type * as PrereleaseFeed from './releases/updater-prerelease-feed'
import { updaterMainWindow } from './testing/updater-test-main-window'

const {
  appMock,
  autoUpdaterMock,
  nativeUpdaterMock,
  powerMonitorMock,
  loadAutoUpdaterMock,
  fetchNudgeMock,
  openExternalMock
} = await vi.hoisted(async () => {
  // The hoisted mock factory must load EventEmitter before static imports run.
  const { EventEmitter } = await import('node:events')
  const autoUpdater = Object.assign(new EventEmitter(), {
    autoInstallOnAppQuit: true,
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn<() => Promise<unknown>>(),
    downloadUpdate: vi.fn(async () => []),
    quitAndInstall: vi.fn()
  })
  return {
    appMock: Object.assign(new EventEmitter(), { isPackaged: true, getVersion: () => '1.0.51' }),
    autoUpdaterMock: autoUpdater,
    nativeUpdaterMock: new EventEmitter(),
    powerMonitorMock: new EventEmitter(),
    loadAutoUpdaterMock: vi.fn(() => autoUpdater),
    fetchNudgeMock: vi.fn(async () => null),
    openExternalMock: vi.fn(async () => {})
  }
})

vi.mock('electron', () => ({
  app: appMock,
  autoUpdater: nativeUpdaterMock,
  powerMonitor: powerMonitorMock,
  shell: { openExternal: openExternalMock }
}))
vi.mock('./electron-updater-loader', () => ({ loadElectronAutoUpdater: loadAutoUpdaterMock }))
vi.mock('./mac-install/macos-shipit-scheduling', () => ({ configureMacShipItScheduling: vi.fn() }))
vi.mock('./mac-install/shipit-leftover-recovery', () => ({
  prepareThisProcessShipItStaging: () => null
}))
vi.mock('./linux-package/linux-update-package-type', () => ({
  getLinuxPackageType: () => 'non-root',
  getLinuxRootPackageType: () => null,
  isExternallyManagedLinuxInstall: () => false
}))
vi.mock('./updater-lifecycle-diagnostics', () => ({ recordUpdaterLifecycle: vi.fn() }))
vi.mock('./releases/updater-changelog', () => ({ fetchChangelog: async () => null }))
vi.mock('./nudges/nudge-campaign', async (original) => ({
  ...(await original<typeof NudgeCampaign>()),
  fetchNudge: fetchNudgeMock
}))
vi.mock('./releases/updater-prerelease-feed', async (original) => ({
  ...(await original<typeof PrereleaseFeed>()),
  fetchNewerReleaseTagsWithReadiness: async () => ({ state: 'no-newer', tags: [] }),
  fetchLatestStableReleaseTag: async () => 'v1.0.51'
}))
vi.mock('../cli/appimage/appimage-copy-pre-extraction', () => ({
  preExtractDownloadedAppImageUpdate: async () => false
}))
vi.mock('./mac-install/macos-update-running-instances', () => ({
  getMacUpdateRunningInstances: async () => []
}))
vi.mock('./lifecycle/serve-supervisor-install-park', () => ({
  parkServeSupervisorsForInstall: async () => ({ kind: 'parked' }),
  commitServeSupervisorPark: async () => {},
  releaseServeSupervisorPark: async () => {}
}))
vi.mock('./lifecycle/updater-installer-session-release', () => ({
  releaseSessionsForInstaller: () => 0
}))
vi.mock('./update-install-exit-watchdog', () => ({
  armUpdateInstallExitWatchdog: vi.fn(),
  disarmUpdateInstallExitWatchdog: vi.fn()
}))

describe('updater', () => {
  beforeEach(() => {
    appMock.isPackaged = true
    appMock.removeAllListeners()
    autoUpdaterMock.removeAllListeners()
    nativeUpdaterMock.removeAllListeners()
    powerMonitorMock.removeAllListeners()
    autoUpdaterMock.autoInstallOnAppQuit = true
    autoUpdaterMock.checkForUpdates.mockReset().mockResolvedValue(null)
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    beginMacUpdateDownload()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('does not load or configure electron-updater during dev setup', () => {
    appMock.isPackaged = false
    const mainWindow = updaterMainWindow(vi.fn())

    const updater = new UpdaterSetup()

    updater.setupAutoUpdater(mainWindow)

    expect(loadAutoUpdaterMock).not.toHaveBeenCalled()
    expect(autoUpdaterMock.setFeedURL).not.toHaveBeenCalled()
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
    expect(powerMonitorMock.listenerCount('resume')).toBe(0)
  })

  it('preserves explicit remote updates without starting managed desktop updates', async () => {
    vi.stubGlobal('PHORCA_MANAGED_BUILD', true)
    // The service captures the managed-build flag at module initialization.
    const service = await import('./updater-service')
    const platform = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    onTestFinished(() => {
      Object.defineProperty(process, 'platform', { value: platform })
    })
    service.setupAutoUpdater(updaterMainWindow(vi.fn()), { getAutomaticUpdates: () => true })

    expect(autoUpdaterMock.setFeedURL).toHaveBeenCalledTimes(1)
    expect(autoUpdaterMock.autoInstallOnAppQuit).toBe(false)
    expect(powerMonitorMock.listenerCount('resume')).toBe(0)
    expect(service.getRemoteServerUpdateSupport()).toEqual({
      installMode: 'interactive',
      automatic: true,
      reason: 'available'
    })

    powerMonitorMock.emit('resume')
    appMock.emit('browser-window-focus')
    service.checkForUpdates()
    service.checkForUpdatesFromMenu()
    expect(openExternalMock).toHaveBeenCalledExactlyOnceWith(
      'https://github.com/phocassoftware/phorca-releases/releases'
    )
    await expect(service.listAvailableReleaseBuilds('stable')).resolves.toEqual([])
    await vi.advanceTimersByTimeAsync(25 * 60 * 60 * 1000)
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
    expect(fetchNudgeMock).not.toHaveBeenCalled()

    autoUpdaterMock.checkForUpdates.mockImplementationOnce(async () => {
      autoUpdaterMock.emit('checking-for-update')
      throw new Error('net::ERR_FAILED')
    })
    service.checkForRemoteServerUpdate('remote-server')
    await vi.advanceTimersByTimeAsync(0)
    expect(service.getUpdateStatus()).toMatchObject({ state: 'error', userInitiated: true })
    // Even a retryable error from an explicit remote check cannot re-arm desktop checks.
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1)

    autoUpdaterMock.checkForUpdates.mockImplementationOnce(async () => {
      autoUpdaterMock.emit('checking-for-update')
      autoUpdaterMock.emit('update-available', { version: '1.0.61' })
    })
    service.checkForRemoteServerUpdate('remote-server')
    await vi.advanceTimersByTimeAsync(0)
    expect(service.getUpdateStatus()).toMatchObject({ state: 'available', version: '1.0.61' })
    service.applyAutomaticUpdatesSetting(true)
    service.downloadUpdate()
    expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled()

    expect(service.downloadRemoteServerUpdate('remote-server').status).toMatchObject({
      state: 'downloading',
      version: '1.0.61'
    })
    expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledTimes(1)
    autoUpdaterMock.emit('download-progress', { percent: 100 })
    const preventDefault = vi.fn()
    appMock.emit('before-quit', { preventDefault })
    expect(preventDefault).not.toHaveBeenCalled()

    autoUpdaterMock.emit('update-downloaded', { version: '1.0.61', files: [] })
    expect(service.getUpdateStatus()).toMatchObject({ state: 'downloaded', version: '1.0.61' })
    service.quitAndInstall()
    await vi.advanceTimersByTimeAsync(1000)
    expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()
    expect(service.isQuittingForUpdate()).toBe(false)
    expect(service.installRemoteServerUpdate('remote-server')).toEqual({
      accepted: true,
      fromVersion: '1.0.51',
      targetVersion: '1.0.61',
      runtimeId: 'remote-server'
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledExactlyOnceWith(false, true)
    nativeUpdaterMock.emit('update-downloaded')
  })

  it('waits until the remaining interval before the next background check', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-03T12:00:00Z'))

    const mainWindow = updaterMainWindow(vi.fn())
    const setLastUpdateCheckAt = vi.fn()

    const updater = new UpdaterSetup()

    updater.setupAutoUpdater(mainWindow, {
      getLastUpdateCheckAt: () => Date.now() - 23 * 60 * 60 * 1000,
      setLastUpdateCheckAt
    })

    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(59 * 60 * 1000)
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(60 * 1000)
    await vi.waitFor(() => {
      expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1)
    })
    expect(setLastUpdateCheckAt).not.toHaveBeenCalled()
  })

  it('deduplicates rapid focus-triggered daily checks before checking status arrives', async () => {
    let lastUpdateCheckAt = Date.now()
    const mainWindow = updaterMainWindow(vi.fn())

    autoUpdaterMock.checkForUpdates.mockImplementation(() => new Promise(() => {}))

    const updater = new UpdaterSetup()

    updater.setupAutoUpdater(mainWindow, {
      getLastUpdateCheckAt: () => lastUpdateCheckAt
    })

    lastUpdateCheckAt = Date.now() - 25 * 60 * 60 * 1000
    appMock.emit('browser-window-focus')
    appMock.emit('browser-window-focus')

    await vi.waitFor(() => {
      expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1)
    })
  })

  it('does not persist lastUpdateCheckAt when a focus-triggered check fails benignly', async () => {
    let lastUpdateCheckAt = Date.now()
    const setLastUpdateCheckAt = vi.fn()
    const sendMock = vi.fn()
    const mainWindow = updaterMainWindow(sendMock)

    autoUpdaterMock.checkForUpdates.mockImplementation(() => {
      autoUpdaterMock.emit('checking-for-update')
      queueMicrotask(() => {
        autoUpdaterMock.emit('error', new Error('net::ERR_FAILED'))
      })
      return Promise.reject(new Error('net::ERR_FAILED'))
    })

    const updater = new UpdaterSetup()

    updater.setupAutoUpdater(mainWindow, {
      getLastUpdateCheckAt: () => lastUpdateCheckAt,
      setLastUpdateCheckAt
    })

    lastUpdateCheckAt = Date.now() - 25 * 60 * 60 * 1000
    appMock.emit('browser-window-focus')

    await vi.waitFor(() => {
      const statuses = sendMock.mock.calls
        .filter(([channel]) => channel === 'updater:status')
        .map(([, status]) => status)
      expect(statuses).toContainEqual({ state: 'idle' })
    })

    expect(setLastUpdateCheckAt).not.toHaveBeenCalled()
  })

  it('retries background checks sooner after a failed automatic check', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-03T12:00:00Z'))

    autoUpdaterMock.checkForUpdates.mockImplementation(() => {
      autoUpdaterMock.emit('checking-for-update')
      queueMicrotask(() => {
        autoUpdaterMock.emit('error', new Error('boom'))
      })
      return Promise.reject(new Error('boom'))
    })

    const sendMock = vi.fn()
    const mainWindow = updaterMainWindow(sendMock)

    const updater = new UpdaterSetup()

    updater.setupAutoUpdater(mainWindow, {
      getLastUpdateCheckAt: () => null,
      setLastUpdateCheckAt: vi.fn()
    })

    await vi.waitFor(() => {
      expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1)
    })

    await vi.advanceTimersByTimeAsync(59 * 60 * 1000)
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(60 * 1000)
    await vi.waitFor(() => {
      expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(2)
    })
  })

  it('reschedules the next automatic check 24 hours after finding an available update', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-03T12:00:00Z'))

    autoUpdaterMock.checkForUpdates.mockImplementation(() => {
      autoUpdaterMock.emit('checking-for-update')
      queueMicrotask(() => {
        autoUpdaterMock.emit('update-available', { version: '1.0.61' })
      })
      return Promise.resolve(undefined)
    })

    const sendMock = vi.fn()
    const setLastUpdateCheckAt = vi.fn()
    const mainWindow = updaterMainWindow(sendMock)

    const updater = new UpdaterSetup()

    // Start 23h in to distinguish the result handler's re-arm from the initial startup timer.
    updater.setupAutoUpdater(mainWindow, {
      getLastUpdateCheckAt: () => Date.now() - 23 * 60 * 60 * 1000,
      setLastUpdateCheckAt
    })

    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    await vi.waitFor(() => {
      expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1)
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(setLastUpdateCheckAt).toHaveBeenCalledTimes(1)
    expect(sendMock).toHaveBeenCalledWith('updater:status', {
      state: 'available',
      version: '1.0.61',
      changelog: null
    })

    await vi.advanceTimersByTimeAsync(23 * 60 * 60 * 1000)
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    // Other timers fire at this boundary too; assert the schedule rather than an exact global call count.
    await vi.waitFor(() => {
      expect(autoUpdaterMock.checkForUpdates.mock.calls.length).toBeGreaterThanOrEqual(2)
    })
  })
})
