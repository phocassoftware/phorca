import { expect, it, vi } from 'vitest'
import { claudeStructuredPermissionModeForSettings } from '../claude/claude-structured-permission-mode'
import { codexStructuredPermissionPolicyForSettings } from '../codex/codex-structured-permission-policy'

it('overrides saved Yolo settings with explicit approval settings for both structured providers', () => {
  vi.stubGlobal('PHORCA_MANAGED_BUILD', true)
  const settings = {
    agentDefaultArgs: {
      claude: '--dangerously-skip-permissions',
      codex: '--dangerously-bypass-approvals-and-sandbox'
    }
  }
  expect(claudeStructuredPermissionModeForSettings(settings)).toBe('default')
  expect(codexStructuredPermissionPolicyForSettings(settings)).toEqual({
    approvalPolicy: 'on-request',
    sandbox: 'workspace-write'
  })
})
