import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { getDefaultPersistedState } from '../../../shared/constants'
import { Store } from './store'

it('projects saved managed preferences consistently through reads, writes and notifications', () => {
  const root = mkdtempSync(join(tmpdir(), 'phorca-preferences-'))
  const dataFile = join(root, 'orca-data.json')
  const state = getDefaultPersistedState(root)
  Object.assign(state.settings, {
    pluginSystemEnabled: true,
    artifactSharingEnabled: true,
    agentSkillSharingEnabled: true,
    mobileEmulatorEnabled: true,
    mobilePairingConnectionMode: 'automatic',
    defaultTuiAgent: 'gemini',
    disabledTuiAgents: [],
    agentCmdOverrides: { claude: 'wrapper --yolo' },
    agentDefaultArgs: { claude: '--dangerously-skip-permissions' }
  })
  writeFileSync(dataFile, JSON.stringify(state))
  vi.stubGlobal('PHORCA_MANAGED_BUILD', true)
  const store = new Store({ dataFile })
  try {
    const effective = store.getSettings()
    expect(effective).toMatchObject({
      pluginSystemEnabled: false,
      artifactSharingEnabled: false,
      agentSkillSharingEnabled: false,
      mobileEmulatorEnabled: false,
      mobilePairingConnectionMode: 'local-only',
      defaultTuiAgent: 'blank',
      agentCmdOverrides: {},
      agentDefaultEnv: {},
      agentDefaultArgs: { claude: '--permission-mode default' }
    })
    expect(effective.disabledTuiAgents).toContain('gemini')
    const listener = vi.fn()
    store.onSettingsChanged(listener)
    const updated = store.updateSettings(
      { disabledTuiAgents: [], terminalFontSize: 16 },
      { notifyListeners: true }
    )
    expect(updated.disabledTuiAgents).toContain('gemini')
    expect(listener).toHaveBeenCalledWith(
      { disabledTuiAgents: updated.disabledTuiAgents, terminalFontSize: 16 },
      updated,
      undefined
    )
  } finally {
    store.freezeWrites()
    rmSync(root, { recursive: true, force: true })
  }
})
