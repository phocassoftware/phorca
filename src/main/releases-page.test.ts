import { beforeEach, describe, expect, it, vi } from 'vitest'

const { openExternalMock, showErrorBoxMock } = vi.hoisted(() => ({
  openExternalMock: vi.fn(),
  showErrorBoxMock: vi.fn()
}))

vi.mock('electron', () => ({
  dialog: { showErrorBox: showErrorBoxMock },
  shell: { openExternal: openExternalMock }
}))

import { openReleasesPage } from './releases-page'

const phorcaReleasesUrl = 'https://github.com/phocassoftware/phorca-releases/releases'

describe('openReleasesPage', () => {
  beforeEach(() => {
    openExternalMock.mockReset().mockResolvedValue(undefined)
    showErrorBoxMock.mockReset()
  })

  it('opens the private Phorca Releases page in the system browser', async () => {
    await openReleasesPage()

    expect(openExternalMock).toHaveBeenCalledExactlyOnceWith(phorcaReleasesUrl)
    expect(showErrorBoxMock).not.toHaveBeenCalled()
  })

  it('shows the private URL when the system browser cannot open', async () => {
    openExternalMock.mockRejectedValue(new Error('browser unavailable'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await openReleasesPage()

    expect(consoleError).toHaveBeenCalledWith(
      `[releases] Failed to open ${phorcaReleasesUrl}: browser unavailable`
    )
    expect(showErrorBoxMock).toHaveBeenCalledWith(
      'Unable to open Phorca Releases',
      expect.stringContaining(phorcaReleasesUrl)
    )
    consoleError.mockRestore()
  })
})
