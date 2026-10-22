import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

const dependencyAction = parse(
  readFileSync('.github/actions/install-node-dependencies/action.yml', 'utf8')
)
const nativeAction = parse(
  readFileSync('.github/actions/prepare-native-runtime/action.yml', 'utf8')
)
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
const pnpmWorkspace = parse(readFileSync('pnpm-workspace.yaml', 'utf8'))

describe('dependency preparation contracts', () => {
  it('projects the web client during desktop and release builds', () => {
    expect(packageJson.scripts['build:desktop']).toContain('pnpm run build:web-from-renderer')
    expect(packageJson.scripts['build:release']).toContain('pnpm run build:web-from-renderer')
  })

  it('restores the pnpm store before dependency installation', () => {
    const steps = dependencyAction.runs.steps
    const pnpmIndex = steps.findIndex((step) => step.name === 'Setup pnpm')
    const nodeIndex = steps.findIndex((step) => step.name === 'Setup Node.js')
    const requestedNodeIndex = steps.findIndex((step) => step.name === 'Setup requested Node.js')

    expect(pnpmIndex).toBeLessThan(nodeIndex)
    expect(pnpmIndex).toBeLessThan(requestedNodeIndex)
    const packageManagerVersion = /^pnpm@([^+]+)/.exec(packageJson.packageManager)?.[1]
    expect(packageManagerVersion).toBe('12.8.1')
    expect(steps[pnpmIndex].uses).toBe('pnpm/setup@v2')
    expect(steps[pnpmIndex].with.version).toBeUndefined()
    expect(steps[pnpmIndex].with.install).toBe(false)
    const saveOutsidePrs =
      "${{ github.event_name != 'pull_request' && inputs.cache-pnpm-store != 'false' && steps.pnpm-store-mode.outputs.lookup-only != 'true' && 'pnpm' || '' }}"
    expect(steps[nodeIndex].with.cache).toBe(saveOutsidePrs)
    expect(steps[nodeIndex].if).toBe("inputs.node-version == ''")
    expect(steps[requestedNodeIndex].if).toBe("inputs.node-version != ''")
    expect(steps[requestedNodeIndex].with['node-version']).toBe('${{ inputs.node-version }}')
    expect(steps[requestedNodeIndex].with.cache).toBe(saveOutsidePrs)
    const restoreIndex = steps.findIndex(
      (step) => step.name === 'Restore pnpm download store without saving'
    )
    expect(restoreIndex).toBeGreaterThan(requestedNodeIndex)
    expect(restoreIndex).toBeLessThan(
      steps.findIndex((step) => step.name === 'Install dependencies')
    )
    expect(steps[restoreIndex].uses).toBe('actions/cache/restore@v5')
    expect(steps[restoreIndex].if).toBe(
      "github.event_name == 'pull_request' && inputs.cache-pnpm-store != 'false' && !((runner.os == 'Linux' || runner.os == 'macOS') && (runner.arch == 'X64' || runner.arch == 'ARM64') && inputs.cache-dependency-path == 'pnpm-lock.yaml') && (runner.os != 'Windows' || !(runner.arch == 'X64' && contains(inputs.cache-dependency-path, 'mobile/pnpm-lock.yaml')) && !((runner.arch == 'X64' || runner.arch == 'ARM64') && inputs.cache-dependency-path == 'pnpm-lock.yaml'))"
    )
  })

  it('prepares native runtimes through the composite install action', () => {
    expect(dependencyAction.inputs['persist-native-cache'].default).toBe('true')
    expect(nativeAction.runs.steps.find((step) => step.name === 'Use external node-gyp').if).toBe(
      "runner.os == 'Linux' && inputs.native-runtime == 'node'"
    )
    const dependencyInstall = dependencyAction.runs.steps.find(
      (step) => step.name === 'Install dependencies'
    )
    // Why frozen: re-resolving the graph costs a minute per job and the `git diff`
    // guard below already fails the run when the lockfile is stale, so the slow
    // resolution can never legitimately change anything.
    expect(dependencyInstall.run).toContain('--frozen-lockfile')
    expect(dependencyInstall.run).not.toContain('--no-frozen-lockfile')
    expect(dependencyInstall.run).toContain(
      'git -C "$GITHUB_WORKSPACE" diff --exit-code -- package.json pnpm-lock.yaml pnpm-workspace.yaml'
    )
    expect(dependencyInstall.run).toContain('--ignore-scripts')
    expect(dependencyInstall.run).not.toContain('--os=')
    expect(dependencyInstall.run).not.toContain('--cpu=')
    expect(pnpmWorkspace.supportedArchitectures.os).toEqual(['current'])
    expect(pnpmWorkspace.supportedArchitectures.cpu).toEqual(['current'])
    const prepareRuntime = dependencyAction.runs.steps.find(
      (step) => step.name === 'Prepare native runtime'
    )
    expect(prepareRuntime.if).toBe("inputs.native-runtime != 'none'")
    expect(prepareRuntime.uses).toBe('./.github/actions/prepare-native-runtime')
    expect(prepareRuntime.with).toEqual({
      'native-runtime': '${{ inputs.native-runtime }}',
      'node-version':
        '${{ steps.requested-node.outputs.node-version || steps.default-node.outputs.node-version }}',
      'persist-native-cache': '${{ inputs.persist-native-cache }}'
    })
  })

  it('restores compiled native modules after the install that strips them', () => {
    const installerSteps = dependencyAction.runs.steps
    const installIndex = installerSteps.findIndex((step) => step.name === 'Install dependencies')
    const nativeIndex = installerSteps.findIndex((step) => step.id === 'native-runtime')
    expect(installIndex).toBeLessThan(nativeIndex)
    const steps = nativeAction.runs.steps
    const cacheIndex = steps.findIndex((step) => step.name === 'Restore compiled native modules')
    const prepareIndex = steps.findIndex((step) => step.name === 'Prepare native runtime')

    // `--ignore-scripts` leaves no build/, so a restore before the install would be
    // overwritten and one after the rebuild would never save a hit.
    expect(cacheIndex).toBeLessThan(prepareIndex)
    expect(steps[cacheIndex].if).toBe(
      "inputs.native-runtime != 'none' && inputs.persist-native-cache != 'false'"
    )
    const restoreOnly = steps.find(
      (step) => step.name === 'Restore compiled native modules without saving'
    )
    expect(restoreOnly.if).toBe(
      "inputs.native-runtime != 'none' && inputs.persist-native-cache == 'false'"
    )
    expect(restoreOnly.uses).toBe('actions/cache/restore@v5')
    // Native artifacts are ABI-bound: a key missing either dimension serves a build
    // that cannot load, and ensure-native-runtime would recompile it anyway.
    for (const cacheStep of [steps[cacheIndex], restoreOnly]) {
      expect(cacheStep.with.key).toBe('${{ steps.native-cache-scope.outputs.key }}')
      expect(cacheStep.with.path).not.toContain('${{')
      expect(cacheStep.with.path).toContain('node-pty@*/node_modules/node-pty/build')
      expect(cacheStep.with.path).toContain('native/windows-registry/build')
      expect(cacheStep.with.path).toContain('@vscode+windows-process-tre*')
      expect(cacheStep.with['restore-keys']).toBeUndefined()
    }
    expect(steps[cacheIndex].id).toBe('native-cache-restore')
    expect(restoreOnly.id).toBe('native-cache-restore-only')
    const cacheScope = steps.find((step) => step.name === 'Resolve native cache scope')
    expect(cacheScope.if).toBe("inputs.native-runtime != 'none'")
    expect(cacheScope.run).toContain('/etc/os-release')
    expect(nativeAction.outputs['cache-scope'].value).toBe(
      '${{ steps.native-cache-scope.outputs.scope }}'
    )
    expect(nativeAction.outputs['cache-hit'].value).toContain(
      'steps.native-cache-restore.outputs.cache-hit'
    )
    expect(nativeAction.outputs['cache-hit'].value).toContain(
      'steps.native-cache-restore-only.outputs.cache-hit'
    )
    for (const output of ['scope', 'hit', 'key', 'path']) {
      expect(dependencyAction.outputs[`native-cache-${output}`].value).toBe(
        `\${{ steps.native-runtime.outputs.cache-${output} }}`
      )
    }
    const electronCache = installerSteps.find(
      (step) => step.name === 'Cache Electron package archive'
    )
    const electronCacheResolution = installerSteps.find(
      (step) => step.name === 'Resolve Electron package cache'
    )
    expect(electronCacheResolution.if).toBe(
      "inputs.native-runtime == 'electron' || inputs.cache-electron-package == 'true'"
    )
    expect(electronCache.if).toBe(
      "(github.event_name != 'pull_request' || runner.os != 'Linux') && steps.electron-package-cache.outputs.version != ''"
    )
    expect(electronCache.uses).toBe('actions/cache@v5')
    expect(electronCache.with.key).toContain('steps.electron-package-cache.outputs.version')
    expect(dependencyAction.inputs['cache-electron-package'].default).toBe('false')
  })
})
