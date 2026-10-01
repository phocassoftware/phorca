import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildAgentDraftLaunchPlan,
  buildAgentResumeStartupPlan,
  buildAgentStartupPlan
} from './tui-agent-startup'
import { resolveTuiAgentLaunchArgs, resolveTuiAgentLaunchEnv } from './tui-agent-launch-defaults'
import { resolveStartupShell, tokenizeStartupCommand } from './tui-agent-startup-shell'

beforeEach(() => vi.stubGlobal('PHORCA_MANAGED_BUILD', true))

describe('managed Claude and Codex launch parity', () => {
  it.each(['win32', 'darwin', 'linux'] as const)(
    'applies policy to new, draft and resumed terminals on %s, including SSH',
    (platform) => {
      for (const agent of ['claude', 'codex'] as const) {
        const input = {
          agent,
          platform,
          isRemote: true,
          cmdOverrides: { [agent]: 'malicious-wrapper --yolo' },
          agentArgs:
            '--yolo --dangerously-skip-permissions --dangerously-bypass-approvals-and-sandbox',
          agentEnv: { UNSAFE_OVERRIDE: '1' }
        }
        const plans = [
          ...(agent === 'claude'
            ? [buildAgentDraftLaunchPlan({ ...input, draft: 'Review this folder' })]
            : []),
          buildAgentStartupPlan({ ...input, prompt: 'Review this folder' }),
          buildAgentResumeStartupPlan({
            ...input,
            agentCommand: 'cached-wrapper --yolo',
            providerSession: { key: 'session_id', id: 'old-session' }
          })
        ]
        for (const plan of plans) {
          expect(plan).not.toBeNull()
          const command = tokenizeStartupCommand(
            plan?.launchCommand ?? '',
            resolveStartupShell(platform)
          )
          expect(command.ok && command.tokens).toEqual(
            expect.arrayContaining(
              agent === 'claude'
                ? ['--permission-mode', 'default']
                : ['--ask-for-approval', 'on-request', '--sandbox', 'workspace-write']
            )
          )
          expect(plan?.launchCommand).not.toMatch(/yolo|dangerously|wrapper/)
          expect(plan?.env).not.toHaveProperty('UNSAFE_OVERRIDE')
          expect(plan?.launchConfig.agentEnv).toEqual({})
        }
        expect(resolveTuiAgentLaunchArgs(agent, { [agent]: '--yolo' })).not.toContain('yolo')
        expect(resolveTuiAgentLaunchEnv(agent, { [agent]: { UNSAFE_OVERRIDE: '1' } })).toEqual({})
      }
    }
  )

  it('refuses providers without a managed approval contract', () => {
    expect(
      buildAgentStartupPlan({
        agent: 'gemini',
        platform: 'linux',
        cmdOverrides: {},
        prompt: 'Run'
      })
    ).toBeNull()
  })
})
