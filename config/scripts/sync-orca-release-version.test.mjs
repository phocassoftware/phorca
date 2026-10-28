import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runProcessSync } from '../../src/shared/child-process/run-process'
import { assertOrcaReleaseVersion } from './orca-release-version.mjs'
import { fixture, release } from './sync-orca-release-fixture.mjs'
import { ORCA_SYNC_BRANCH } from './sync-orca-release.mjs'

function commitVersion(f, version) {
  const path = join(f.checkout, 'package.json')
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  writeFileSync(path, `${JSON.stringify({ ...manifest, version }, null, 2)}\n`)
  f.local(['add', 'package.json'])
  f.local(['commit', '-m', 'Resolve package version'])
}

describe('Orca package version validation', () => {
  it.each(['1.4.214', '1.4.240-rc.1', '01.4.240', undefined, 240])(
    'rejects obsolete or invalid package versions: %s',
    (version) => {
      expect(() => assertOrcaReleaseVersion(JSON.stringify({ version }), 'v1.4.240')).toThrow(
        'expected 1.4.240'
      )
    }
  )

  it('requires the selected version, allowing newer versions only for already included releases', () => {
    const contents = JSON.stringify({ version: '1.4.240' })
    expect(() => assertOrcaReleaseVersion(contents, 'v1.4.240')).not.toThrow()
    expect(() => assertOrcaReleaseVersion(contents, 'v1.4.224')).toThrow('Do not downgrade')
    expect(() => assertOrcaReleaseVersion(contents, 'v1.4.224', { allowNewer: true })).not.toThrow()
  })

  it('imports a release-only version bump along with its source', async () => {
    const f = fixture()
    expect(JSON.parse(f.upstreamGit(['show', 'v1.4.223^:package.json'])).version).toBe('1.4.197')
    await f.sync()
    expect(JSON.parse(f.local(['show', 'HEAD:package.json'])).version).toBe('1.4.223')
    f.local(['checkout', 'main'])
    f.local(['merge', '--no-edit', ORCA_SYNC_BRANCH])
    expect(JSON.parse(f.local(['show', 'HEAD:package.json'])).version).toBe('1.4.223')
    expect(readFileSync(join(f.checkout, 'phorca.txt'), 'utf8')).toContain('Codex and Claude')
  })

  it.each([true, false])(
    'rejects a stale resolved version on an existing branch (eligible release: %s)',
    async (eligible) => {
      const f = fixture()
      await f.sync()
      commitVersion(f, '1.4.214')
      f.local(['push', 'origin', ORCA_SYNC_BRANCH])
      const head = f.remoteHead()
      const body = f.pulls[0].body
      f.setReleases(eligible ? [release('v1.4.223')] : [])
      await expect(f.sync()).rejects.toThrow('expected 1.4.223')
      expect(f.remoteHead()).toBe(head)
      expect(f.pulls[0].body).toBe(body)
      commitVersion(f, '1.4.223')
      f.local(['push', 'origin', ORCA_SYNC_BRANCH])
      expect(await f.sync()).toContain('Kept')
    }
  )

  it.each([false, true])(
    'checks the merged base before reporting already included (branch deleted: %s)',
    async (deleted) => {
      const f = fixture()
      await f.sync()
      f.local(['checkout', 'main'])
      f.local(['merge', '--no-edit', ORCA_SYNC_BRANCH])
      commitVersion(f, '1.4.214')
      f.local(['push', 'origin', 'main', ...(deleted ? [`:refs/heads/${ORCA_SYNC_BRANCH}`] : [])])
      f.pulls[0].state = 'closed'
      f.pulls[0].merged_at = '2026-10-12T00:00:00Z'
      await expect(f.sync()).rejects.toThrow('expected 1.4.223 or newer')
      expect(f.pulls).toHaveLength(1)
      commitVersion(f, '1.4.223')
      f.local(['push', 'origin', 'main'])
      expect(await f.sync()).toContain('already includes')
    }
  )

  it('validates against a newer manual selection rather than the older eligible release', async () => {
    const f = fixture()
    f.addRelease('v1.4.240', 'newer source')
    f.setReleases([release('v1.4.223'), release('v1.4.240', 1)])
    await f.sync({ manual: true, overrideTag: 'v1.4.240' })
    commitVersion(f, '1.4.223')
    f.local(['push', 'origin', ORCA_SYNC_BRANCH])
    const head = f.remoteHead()
    await expect(f.sync()).rejects.toThrow('expected 1.4.240')
    expect(f.remoteHead()).toBe(head)
    expect(f.pulls[0].title).toContain('v1.4.240')
  })

  it('rejects a release tag with mismatched package metadata before creating a branch', async () => {
    const f = fixture()
    f.upstreamGit(['tag', '-f', 'v1.4.223', 'v1.4.223^'])
    await expect(f.sync()).rejects.toThrow('expected 1.4.223')
    expect(f.git.mock.calls.some(([args]) => args[0] === 'push')).toBe(false)
    expect(f.pulls).toEqual([])
  })

  it('checks actual imported source and the working manifest before a build', async () => {
    const f = fixture()
    const check = () =>
      runProcessSync({
        program: process.env.ORCA_TEST_NODE_EXECUTABLE || process.execPath,
        args: [
          fileURLToPath(new URL('./check-orca-release-version.mjs', import.meta.url)),
          'v1.4.223'
        ],
        cwd: f.checkout,
        timeoutMs: 10_000
      })
    f.local(['fetch', f.upstream, 'refs/tags/v1.4.223:refs/tags/v1.4.223'])
    expect(check().code).not.toBe(0)
    await f.sync()
    expect(check().code).toBe(0)
    writeFileSync(join(f.checkout, 'package.json'), JSON.stringify({ version: '1.4.214' }))
    const stale = check()
    expect(stale.code).not.toBe(0)
    expect(stale.stderr).toContain('expected 1.4.223')
  })
})
