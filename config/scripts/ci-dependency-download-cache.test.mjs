import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const read = (path) => parse(readFileSync(path, 'utf8'))
const action = read('.github/actions/install-node-dependencies/action.yml')

describe('CI dependency download caches', () => {
  it('scopes dependency stores to the requested lockfiles', () => {
    expect(action.inputs['cache-dependency-path'].default).toBe('pnpm-lock.yaml')
    for (const step of action.runs.steps.filter((step) => step.uses === 'actions/setup-node@v6')) {
      expect(step.with.cache).toBe(
        "${{ github.event_name != 'pull_request' && inputs.cache-pnpm-store != 'false' && steps.pnpm-store-mode.outputs.lookup-only != 'true' && 'pnpm' || '' }}"
      )
      expect(step.with['cache-dependency-path']).toBe('${{ inputs.cache-dependency-path }}')
      expect(step.with['package-manager-cache']).toBe(false)
    }
    const install = action.runs.steps.find((step) => step.name === 'Install dependencies')
    expect(install.if).toBeUndefined()
    expect(install.run).toContain('pnpm install --frozen-lockfile --ignore-scripts')
    expect(install.run).toContain(
      'diff --exit-code -- package.json pnpm-lock.yaml pnpm-workspace.yaml'
    )
  })

  it('restores PR stores except measured Windows, Linux and macOS installs, without a post-job save', () => {
    const resolve = action.runs.steps.find((step) => step.id === 'pnpm-store')
    const restore = action.runs.steps.find(
      (step) => step.name === 'Restore pnpm download store without saving'
    )
    expect(restore.if).toBe(
      "github.event_name == 'pull_request' && inputs.cache-pnpm-store != 'false' && !((runner.os == 'Linux' || runner.os == 'macOS') && (runner.arch == 'X64' || runner.arch == 'ARM64') && inputs.cache-dependency-path == 'pnpm-lock.yaml') && (runner.os != 'Windows' || !(runner.arch == 'X64' && contains(inputs.cache-dependency-path, 'mobile/pnpm-lock.yaml')) && !((runner.arch == 'X64' || runner.arch == 'ARM64') && inputs.cache-dependency-path == 'pnpm-lock.yaml'))"
    )
    expect(resolve.if).toBe(
      `${restore.if} || (github.event_name != 'pull_request' && inputs.cache-pnpm-store != 'false' && steps.pnpm-store-mode.outputs.lookup-only == 'true')`
    )
    expect(restore.uses).toBe('actions/cache/restore@v5')
    expect(restore.with.path).toBe('${{ steps.pnpm-store.outputs.path }}')
    expect(restore.with.key).toBe(
      'node-cache-${{ runner.os }}-${{ steps.pnpm-store.outputs.arch }}-pnpm-${{ hashFiles(inputs.cache-dependency-path) }}'
    )
    expect(restore.with['restore-keys']).toBeUndefined()
    expect(resolve.env.LOCKFILE_HASH).toBe('${{ hashFiles(inputs.cache-dependency-path) }}')
    expect(action.runs.steps.indexOf(resolve)).toBeLessThan(action.runs.steps.indexOf(restore))
    expect(action.runs.steps.indexOf(restore)).toBeLessThan(
      action.runs.steps.findIndex((step) => step.name === 'Install dependencies')
    )
    const saves = action.runs.steps.filter((step) => step.uses === 'actions/cache/save@v5')
    expect(saves).toHaveLength(1)
    expect(saves[0].name).toBe('Save pnpm verification record on main')
    expect(saves[0].if).toContain("github.ref == 'refs/heads/main'")
    expect(saves[0].if).toContain("github.event_name != 'pull_request'")
    expect(saves[0].with.path).toBe('${{ steps.verification-cache.outputs.path }}')
  })

  it('keeps producer lookup optional and compatible with the existing store archive', () => {
    const lookup = action.runs.steps.find((step) => step.id === 'pnpm-store-lookup')
    const restore = action.runs.steps.find((step) => step.id === 'pnpm-store-restore')
    expect(action.inputs['cache-pnpm-store-lookup-only'].default).toBe('auto')
    expect(lookup.uses).toBe('actions/cache@v5')
    expect(lookup.if).toBe("steps.pnpm-store-mode.outputs.lookup-only == 'true'")
    expect(lookup.with).toEqual({
      path: '${{ env.ORCA_PNPM_STORE_CACHE_PATH }}',
      key: restore.with.key,
      'lookup-only': true
    })
    expect(action.runs.steps.indexOf(lookup)).toBeLessThan(
      action.runs.steps.findIndex((step) => step.name === 'Install dependencies')
    )
    expect(action.outputs['pnpm-store-cache-hit'].value).toBe(
      '${{ steps.pnpm-store-lookup.outputs.cache-hit || steps.pnpm-store-restore.outputs.cache-hit || steps.requested-node.outputs.cache-hit || steps.default-node.outputs.cache-hit }}'
    )
  })

  it.each([
    ['Windows x64 mixed PR', 'pull_request', 'Windows', 'X64', true, false, ''],
    ['Windows ARM64 mixed PR', 'pull_request', 'Windows', 'ARM64', true, true, ''],
    ['Windows x86 mixed PR', 'pull_request', 'Windows', 'X86', true, true, ''],
    ['Windows x64 root-only PR', 'pull_request', 'Windows', 'X64', false, false, ''],
    ['Windows ARM64 root-only PR', 'pull_request', 'Windows', 'ARM64', false, false, ''],
    ['Windows x86 root-only PR', 'pull_request', 'Windows', 'X86', false, true, ''],
    ['Windows x64 custom PR', 'pull_request', 'Windows', 'X64', 'cloud/pnpm-lock.yaml', true, ''],
    [
      'Windows ARM64 custom PR',
      'pull_request',
      'Windows',
      'ARM64',
      'cloud/pnpm-lock.yaml',
      true,
      ''
    ],
    ['Windows ARM64 root-only push', 'push', 'Windows', 'ARM64', false, false, 'pnpm'],
    [
      'Windows ARM64 root-only manual run',
      'workflow_dispatch',
      'Windows',
      'ARM64',
      false,
      false,
      'pnpm'
    ],
    ['Explicit Linux PR opt-out', 'pull_request', 'Linux', 'X64', false, false, '', 'false'],
    ['Explicit Windows push opt-out', 'push', 'Windows', 'ARM64', false, false, '', 'false'],
    [
      'Explicit Windows manual opt-out',
      'workflow_dispatch',
      'Windows',
      'X64',
      false,
      false,
      '',
      'false'
    ],
    [
      'Explicit custom-store opt-out',
      'pull_request',
      'Windows',
      'X64',
      'cloud/pnpm-lock.yaml',
      false,
      '',
      'false'
    ],
    ['Windows x64 root-only push', 'push', 'Windows', 'X64', false, false, 'pnpm'],
    ['Linux x64 root-only PR', 'pull_request', 'Linux', 'X64', false, false, ''],
    ['Linux ARM64 root-only PR', 'pull_request', 'Linux', 'ARM64', false, false, ''],
    ['Linux x86 root-only PR', 'pull_request', 'Linux', 'X86', false, true, ''],
    ['Linux ARM root-only PR', 'pull_request', 'Linux', 'ARM', false, true, ''],
    ['Linux x64 custom PR', 'pull_request', 'Linux', 'X64', 'cloud/pnpm-lock.yaml', true, ''],
    ['Linux x64 root-only push', 'push', 'Linux', 'X64', false, false, 'pnpm'],
    ['Linux ARM64 root-only manual', 'workflow_dispatch', 'Linux', 'ARM64', false, false, 'pnpm'],
    ['macOS x64 root-only PR', 'pull_request', 'macOS', 'X64', false, false, ''],
    ['macOS ARM64 root-only PR', 'pull_request', 'macOS', 'ARM64', false, false, ''],
    ['macOS x86 root-only PR', 'pull_request', 'macOS', 'X86', false, true, ''],
    ['macOS x64 mixed PR', 'pull_request', 'macOS', 'X64', true, true, ''],
    ['macOS ARM64 mixed PR', 'pull_request', 'macOS', 'ARM64', true, true, ''],
    ['macOS ARM64 custom PR', 'pull_request', 'macOS', 'ARM64', 'cloud/pnpm-lock.yaml', true, ''],
    ['macOS ARM64 opted-out PR', 'pull_request', 'macOS', 'ARM64', true, false, '', 'false'],
    ['macOS x64 root-only push', 'push', 'macOS', 'X64', false, false, 'pnpm'],
    ['macOS ARM64 root-only manual', 'workflow_dispatch', 'macOS', 'ARM64', false, false, 'pnpm'],
    ['Linux x64 mixed PR', 'pull_request', 'Linux', 'X64', true, true, ''],
    ['Linux ARM64 mixed PR', 'pull_request', 'Linux', 'ARM64', true, true, ''],
    ['Windows x64 mixed push', 'push', 'Windows', 'X64', true, false, 'pnpm'],
    ['Windows x64 mixed manual run', 'workflow_dispatch', 'Windows', 'X64', true, false, 'pnpm'],
    ['Windows x64 lookup producer', 'push', 'Windows', 'X64', false, false, '', 'true', 'true'],
    [
      'Windows ARM64 lookup producer',
      'schedule',
      'Windows',
      'ARM64',
      false,
      false,
      '',
      'true',
      'true'
    ],
    ['macOS ARM64 lookup producer', 'push', 'macOS', 'ARM64', false, false, '', 'true', 'true'],
    [
      'Linux x64 lookup producer',
      'workflow_dispatch',
      'Linux',
      'X64',
      false,
      false,
      '',
      'true',
      'true'
    ],
    ['Opted-out lookup producer', 'push', 'Windows', 'ARM64', false, false, '', 'false', 'true'],
    [
      'macOS root PR lookup flag',
      'pull_request',
      'macOS',
      'ARM64',
      false,
      false,
      '',
      'true',
      'true'
    ],
    ['macOS mixed PR lookup flag', 'pull_request', 'macOS', 'ARM64', true, true, '', 'true', 'true']
  ])(
    '%s keeps its scoped store policy',
    (_name, event, os, arch, mixed, restore, cache, storeCache = 'true', lookupOnly = 'false') => {
      const context = {
        github: { event_name: event },
        runner: { os, arch },
        steps: {
          'pnpm-store-mode': {
            outputs: {
              'lookup-only':
                event !== 'pull_request' && storeCache !== 'false' && lookupOnly === 'true'
                  ? 'true'
                  : ''
            }
          }
        },
        inputs: {
          'cache-pnpm-store': storeCache,
          'cache-pnpm-store-lookup-only': lookupOnly,
          'cache-dependency-path':
            typeof mixed === 'string'
              ? mixed
              : mixed
                ? 'pnpm-lock.yaml\nmobile/pnpm-lock.yaml'
                : 'pnpm-lock.yaml'
        },
        contains: (value, search) => value.toLowerCase().includes(search.toLowerCase())
      }
      const evaluate = (expression) =>
        runInNewContext(
          expression
            .replaceAll(
              'steps.pnpm-store-mode.outputs.lookup-only',
              'steps["pnpm-store-mode"].outputs["lookup-only"]'
            )
            .replaceAll(
              'inputs.cache-pnpm-store-lookup-only',
              'inputs["cache-pnpm-store-lookup-only"]'
            )
            .replaceAll('inputs.cache-dependency-path', 'inputs["cache-dependency-path"]')
            .replaceAll('inputs.cache-pnpm-store', 'inputs["cache-pnpm-store"]'),
          context
        )
      for (const step of action.runs.steps.filter(
        (step) =>
          step.id === 'pnpm-store' || step.name === 'Restore pnpm download store without saving'
      )) {
        expect(evaluate(step.if)).toBe(
          restore ||
            (step.id === 'pnpm-store' &&
              event !== 'pull_request' &&
              storeCache !== 'false' &&
              lookupOnly === 'true')
        )
      }
      expect(evaluate(action.runs.steps.find((step) => step.id === 'pnpm-store-lookup').if)).toBe(
        event !== 'pull_request' && storeCache !== 'false' && lookupOnly === 'true'
      )
      for (const step of action.runs.steps.filter(
        (step) => step.uses === 'actions/setup-node@v6'
      )) {
        expect(evaluate(step.with.cache.slice(3, -2))).toBe(cache)
        expect(step.with['package-manager-cache']).toBe(false)
      }
    }
  )

  it('enables the pnpm store cache by default', () => {
    expect(action.inputs['cache-pnpm-store'].default).toBe('true')
  })
})

it('shares Electron archives with PRs without uploading PR-local copies', () => {
  const save = action.runs.steps.find((step) => step.name === 'Cache Electron package archive')
  const restore = action.runs.steps.find(
    (step) => step.name === 'Restore Electron package archive without saving'
  )
  expect(save.if).toContain("github.event_name != 'pull_request' || runner.os != 'Linux'")
  expect(restore.if).toContain("github.event_name == 'pull_request' && runner.os == 'Linux'")
  expect(save.if).toContain("steps.electron-package-cache.outputs.version != ''")
  expect(restore.if).toContain("steps.electron-package-cache.outputs.version != ''")
  expect(save.uses).toBe('actions/cache@v5')
  expect(restore.uses).toBe('actions/cache/restore@v5')
  expect(restore.with).toEqual(save.with)
})

describe('release install targets', () => {
  const macCpuFlag = '--cpu=current,x64,arm64'
  it('offers the mac CPU targets for local packaging without touching the lockfile', () => {
    const script = JSON.parse(readFileSync('package.json', 'utf8')).scripts['install:release']
    expect(script).toContain('--frozen-lockfile')
    expect(script).toContain(macCpuFlag)
  })
})
