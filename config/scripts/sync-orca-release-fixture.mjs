import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, vi } from 'vitest'
import { runProcessSync } from '../../src/shared/child-process/run-process'
import { ORCA_SYNC_BRANCH, syncOrcaRelease } from './sync-orca-release.mjs'

export const NOW = Date.parse('2026-10-12T00:00:00Z')
export const AGE = 72 * 60 * 60 * 1000
export const release = (tag, age = AGE, extra = {}) => ({
  tag_name: tag,
  published_at: new Date(NOW - age).toISOString(),
  draft: false,
  prerelease: false,
  ...extra
})

const roots = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

export function fixture({ keepWorkflows = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'phorca-orca-sync-'))
  roots.push(root)
  const hooks = join(root, 'disabled-hooks')
  const globalConfig = join(root, 'empty-git-config')
  writeFileSync(globalConfig, '')
  const command = (cwd, args) => {
    const result = runProcessSync({
      program: 'git',
      args: ['-c', `core.hooksPath=${hooks}`, '-c', 'commit.gpgSign=false', ...args],
      cwd,
      timeoutMs: 10_000,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: globalConfig }
    })
    return { ...result, exitCode: result.code }
  }
  const checked = (cwd, args) => {
    const result = command(cwd, args)
    if (result.exitCode !== 0) {
      throw new Error(`git ${args.join(' ')}: ${result.stderr}`)
    }
    return result.stdout.trim()
  }
  const upstream = join(root, 'orca')
  checked(root, ['init', upstream])
  checked(upstream, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  for (const cwd of [upstream]) {
    checked(cwd, ['config', 'user.name', 'Test'])
    checked(cwd, ['config', 'user.email', 'test@example.com'])
  }
  writeFileSync(join(upstream, 'desktop.txt'), 'old\n')
  writeFileSync(
    join(upstream, 'package.json'),
    `${JSON.stringify({ name: 'orca', version: '1.4.197' }, null, 2)}\n`
  )
  const upstreamWorkflows = join(upstream, '.github', 'workflows')
  mkdirSync(upstreamWorkflows, { recursive: true })
  writeFileSync(join(upstreamWorkflows, 'ci.yml'), 'original Orca CI\n')
  writeFileSync(join(upstreamWorkflows, 'deleted-by-orca.yml'), 'keep in Phorca\n')
  writeFileSync(join(upstreamWorkflows, 'removed-by-phorca.yml'), 'removed in Phorca\n')
  checked(upstream, ['add', '.'])
  checked(upstream, ['commit', '-m', 'Initial Orca'])
  checked(upstream, ['tag', 'v1.4.197'])
  const origin = join(root, 'phorca.git')
  checked(root, ['init', '--bare', origin])
  const checkout = join(root, 'checkout')
  checked(root, ['clone', upstream, checkout])
  checked(checkout, ['config', 'user.name', 'Test'])
  checked(checkout, ['config', 'user.email', 'test@example.com'])
  checked(checkout, ['remote', 'set-url', 'origin', origin])
  writeFileSync(join(checkout, 'phorca.txt'), 'Codex and Claude customizations\n')
  const phorcaWorkflows = join(checkout, '.github', 'workflows')
  if (keepWorkflows) {
    writeFileSync(join(phorcaWorkflows, 'ci.yml'), 'Phorca CI\n')
    writeFileSync(join(phorcaWorkflows, 'phorca-only.yml'), 'Phorca sync workflow\n')
    rmSync(join(phorcaWorkflows, 'removed-by-phorca.yml'))
  } else {
    rmSync(phorcaWorkflows, { recursive: true })
  }
  checked(checkout, ['add', '.'])
  checked(checkout, ['commit', '-m', 'Phorca customizations'])
  checked(checkout, ['push', 'origin', 'main'])
  const addRelease = (tag, text) => {
    writeFileSync(join(upstream, 'desktop.txt'), `${text}\n`)
    writeFileSync(join(upstreamWorkflows, 'ci.yml'), `${tag} Orca CI\n`)
    writeFileSync(join(upstreamWorkflows, 'orca-only.yml'), `${tag} upstream workflow\n`)
    rmSync(join(upstreamWorkflows, 'deleted-by-orca.yml'), { force: true })
    checked(upstream, ['add', '.'])
    checked(upstream, ['commit', '-m', `Orca ${tag}`])
    writeFileSync(
      join(upstream, 'package.json'),
      `${JSON.stringify({ name: 'orca', version: tag.slice(1) }, null, 2)}\n`
    )
    checked(upstream, ['add', 'package.json'])
    checked(upstream, ['commit', '-m', `Release ${tag}`])
    checked(upstream, ['tag', tag])
  }
  addRelease('v1.4.223', 'new')

  const pulls = []
  let releases = [release('v1.4.223')]
  const github = {
    rest: {
      repos: {
        listReleases: vi.fn(),
        getReleaseByTag: vi.fn(async ({ tag }) => ({
          data: releases.find((item) => item.tag_name === tag)
        }))
      },
      pulls: {
        list: vi.fn(),
        create: vi.fn(async (options) => {
          const pull = {
            ...options,
            number: pulls.length + 1,
            state: 'open',
            merged_at: null,
            html_url: `https://github.test/phorca/pull/${pulls.length + 1}`
          }
          pulls.unshift(pull)
          return { data: pull }
        }),
        update: vi.fn(async (options) => {
          Object.assign(
            pulls.find((pull) => pull.number === options.pull_number),
            options
          )
        })
      }
    },
    paginate: vi.fn(async (endpoint) => (endpoint === github.rest.pulls.list ? pulls : releases))
  }
  const git = vi.fn(async (args) =>
    command(
      checkout,
      args.map((arg) => (arg === 'https://github.com/stablyai/orca.git' ? upstream : arg))
    )
  )
  const sync = (options = {}) =>
    syncOrcaRelease({
      github,
      git,
      repo: { owner: 'phocassoftware', repo: 'phorca' },
      base: 'main',
      now: NOW,
      ...options
    })
  const local = (args) => checked(checkout, args)
  const remoteHead = () => checked(origin, ['rev-parse', `refs/heads/${ORCA_SYNC_BRANCH}`])
  const replaceRemote = (tree, parent, message) => {
    const commit = local(['commit-tree', tree, '-p', parent, '-m', message])
    local(['push', '-f', 'origin', `${commit}:refs/heads/${ORCA_SYNC_BRANCH}`])
    return commit
  }
  return {
    checkout,
    upstream,
    pulls,
    github,
    git,
    sync,
    local,
    remoteHead,
    replaceRemote,
    addRelease,
    upstreamGit: (args) => checked(upstream, args),
    setReleases: (items) => {
      releases = items
    }
  }
}
