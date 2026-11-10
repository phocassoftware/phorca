import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  LOC_BLOCK_END,
  LOC_BLOCK_START,
  emptyLocTotals,
  mergeLocBlock
} from '../../.github/scripts/pr-test-loc-table.mjs'
import { runOrcaReleaseAction } from './sync-orca-release-action.mjs'
import { AGE, NOW, fixture, release } from './sync-orca-release-fixture.mjs'
import { selectOrcaRelease, syncOrcaRelease } from './sync-orca-release.mjs'

describe('Orca sync API safeguards', () => {
  it('rejects duplicate open PRs before release lookup or Git changes', async () => {
    const github = {
      paginate: vi.fn().mockResolvedValue([{ state: 'open' }, { state: 'open' }]),
      rest: { pulls: { list: vi.fn(), create: vi.fn(), update: vi.fn() }, repos: {} }
    }
    const git = vi.fn()
    await expect(
      syncOrcaRelease({
        github,
        git,
        repo: { owner: 'phocassoftware', repo: 'phorca' },
        base: 'main'
      })
    ).rejects.toThrow('More than one Orca sync PR is open')
    expect(github.paginate).toHaveBeenCalledOnce()
    expect(git).not.toHaveBeenCalled()
    expect(github.rest.pulls.create).not.toHaveBeenCalled()
    expect(github.rest.pulls.update).not.toHaveBeenCalled()
  })

  it('validates malformed override tags before any API or Git calls', async () => {
    const github = { paginate: vi.fn(), rest: { repos: { getReleaseByTag: vi.fn() } } }
    const git = vi.fn()
    await expect(syncOrcaRelease({ github, git, overrideTag: 'main; injected' })).rejects.toThrow(
      'Override must be a stable desktop tag: vX.Y.Z.'
    )
    expect(github.paginate).not.toHaveBeenCalled()
    expect(github.rest.repos.getReleaseByTag).not.toHaveBeenCalled()
    expect(git).not.toHaveBeenCalled()
  })

  it.each([404, 401, 503, undefined])(
    'reports override lookup errors with tag context (%s)',
    async (status) => {
      const lookupError = Object.assign(new Error('Lookup unavailable'), { status })
      const github = {
        paginate: vi.fn().mockResolvedValue([]),
        rest: {
          pulls: { list: vi.fn(), create: vi.fn(), update: vi.fn() },
          repos: { getReleaseByTag: vi.fn().mockRejectedValue(lookupError) }
        }
      }
      const git = vi.fn()
      const result = syncOrcaRelease({
        github,
        git,
        repo: { owner: 'phocassoftware', repo: 'phorca' },
        overrideTag: 'v1.4.224'
      })
      await expect(result).rejects.toThrow(
        status === 404
          ? 'No published stable desktop release exists for v1.4.224.'
          : 'Looking up Orca v1.4.224 failed: Lookup unavailable'
      )
      await expect(result).rejects.toHaveProperty('cause', lookupError)
      expect(git).not.toHaveBeenCalled()
      expect(github.rest.pulls.create).not.toHaveBeenCalled()
      expect(github.rest.pulls.update).not.toHaveBeenCalled()
    }
  )
})

describe('shared PR generated blocks', () => {
  it('keeps reviewer text and an orphan end marker while moving the LoC block after ELI5', () => {
    const body = [
      'Reviewer note',
      LOC_BLOCK_END,
      '',
      '## ELI5',
      'Keep this explanation.',
      '',
      LOC_BLOCK_START,
      'Old totals',
      LOC_BLOCK_END,
      '',
      '## Testing',
      'Keep these results.'
    ].join('\n')

    const updated = mergeLocBlock(body, emptyLocTotals())

    expect(
      updated.startsWith(`Reviewer note\n${LOC_BLOCK_END}\n\n## ELI5\nKeep this explanation.`)
    ).toBe(true)
    expect(updated.split(LOC_BLOCK_START)).toHaveLength(2)
    expect(updated).not.toContain('Old totals')
    expect(updated).toContain('## Testing\nKeep these results.')
    expect(updated.indexOf(LOC_BLOCK_START)).toBeLessThan(updated.indexOf('## Testing'))
  })
})

describe('Orca release selection', () => {
  it('uses publication time and includes the exact 72-hour boundary', () => {
    const eligible = release('v1.4.223')
    expect(
      selectOrcaRelease(
        [release('v1.4.224', AGE - 1, { created_at: '2020-01-01T00:00:00Z' }), eligible],
        { now: NOW }
      )
    ).toBe(eligible)
  })

  it('selects the highest version regardless of API order or backfilled publication dates', () => {
    const highest = release('v1.10.1', AGE * 3)
    expect(
      selectOrcaRelease([release('v1.9.99'), highest, release('v1.10.0'), release('v1.4.999')], {
        now: NOW
      })
    ).toBe(highest)
  })

  it('excludes mobile, prereleases, drafts, unpublished and malformed versions', () => {
    expect(
      selectOrcaRelease(
        [
          release('mobile-v9.9.9'),
          release('v9.9.9-rc.1'),
          release('v9.9.9', AGE, { draft: true }),
          release('v9.9.8', AGE, { prerelease: true }),
          release('v9.9.7', AGE, { published_at: null }),
          release('v9.9.6', AGE, { published_at: 'invalid' }),
          release('v01.2.3'),
          release('v999999999999999999.2.3'),
          release('v1.2.3', AGE - 1)
        ],
        { now: NOW }
      )
    ).toBeNull()
  })

  it('allows an explicit published stable version to bypass the wait', () => {
    const young = release('v1.4.224', 1)
    expect(selectOrcaRelease([young], { now: NOW, overrideTag: young.tag_name })).toBe(young)
    expect(() => selectOrcaRelease([], { overrideTag: 'main; echo injected' })).toThrow(
      'stable desktop'
    )
    expect(() => selectOrcaRelease([], { overrideTag: 'v1.4.224' })).toThrow('No published')
    expect(() =>
      selectOrcaRelease([release('v1.4.224', 1, { draft: true })], {
        overrideTag: 'v1.4.224'
      })
    ).toThrow('No published')
  })
})

describe('Orca release action', () => {
  it.each(['refs/heads/feature', 'refs/tags/v1.4.224'])(
    'rejects manual runs from %s before Git or API calls',
    async (ref) => {
      const exec = { getExecOutput: vi.fn() }
      const github = { paginate: vi.fn() }
      const context = { ref, payload: { repository: { default_branch: 'main' } } }
      await expect(runOrcaReleaseAction({ github, exec, context, core: {} })).rejects.toThrow(
        'must run from the default branch'
      )
      expect(exec.getExecOutput).not.toHaveBeenCalled()
      expect(github.paginate).not.toHaveBeenCalled()
    }
  )

  it('runs a manual release override from the default branch and reports the result', async () => {
    const f = fixture()
    f.setReleases([release('v1.4.223', 1)])
    vi.stubEnv('RUNNER_TEMP', f.checkout)
    vi.stubEnv('OVERRIDE_TAG', 'v1.4.223')
    const exec = { getExecOutput: vi.fn(async (_program, args) => f.git(args.slice(4))) }
    const summary = { addRaw: vi.fn().mockReturnThis(), write: vi.fn() }
    const core = { info: vi.fn(), summary }
    const context = {
      ref: 'refs/heads/main',
      eventName: 'workflow_dispatch',
      repo: { owner: 'phocassoftware', repo: 'phorca' },
      payload: { repository: { default_branch: 'main' } }
    }
    await runOrcaReleaseAction({ github: f.github, exec, context, core })
    expect(f.github.rest.repos.getReleaseByTag).toHaveBeenCalledWith({
      owner: 'stablyai',
      repo: 'orca',
      tag: 'v1.4.223'
    })
    expect(exec.getExecOutput).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining([
        `core.hooksPath=${join(f.checkout, 'orca-sync-disabled-hooks')}`,
        'commit.gpgSign=false'
      ]),
      { ignoreReturnCode: true, silent: true }
    )
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Created'))
    expect(summary.addRaw).toHaveBeenCalledWith(expect.stringContaining('Created'))
    expect(summary.write).toHaveBeenCalledOnce()
  })
})
