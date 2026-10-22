import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { runProcessSync } from './script-child-process.mjs'

const action = parse(readFileSync('.github/actions/prepare-orcad-prebuilds/action.yml', 'utf8'))
const actionSteps = action.runs.steps
const identity = actionSteps.find((step) => step.id === 'orcad-prebuild-cache-identity')
const restore = actionSteps.find((step) => step.id === 'orcad-prebuild-cache-restore')
const build = actionSteps.find((step) => step.name?.startsWith('Build and smoke this runner'))

describe('Windows server prebuild composite action', () => {
  it('restores only the exact key and keeps build failures fatal', () => {
    expect(identity['continue-on-error']).toBe(true)
    expect(identity.run).toBe('node config/scripts/orcad-windows-prebuild-cache.mjs --fingerprint')
    expect(restore.uses).toBe('actions/cache/restore@v5')
    expect(restore['continue-on-error']).toBe(true)
    expect(restore.with['restore-keys']).toBeUndefined()
    expect(action.outputs['cache-path'].value).toBe(restore.with.path)
    expect(action.outputs['cache-key'].value).toBe(restore.with.key)
    expect(restore.with.key).toBe('${{ steps.orcad-prebuild-cache-identity.outputs.key }}')
    expect(restore.with.path).toBe('${{ steps.orcad-prebuild-cache-identity.outputs.path }}')
    expect(actionSteps.indexOf(restore)).toBeLessThan(actionSteps.indexOf(build))
    expect(actionSteps.some((step) => step.uses === 'actions/cache/save@v5')).toBe(false)
    expect(build.if).toBeUndefined()
    expect(build['continue-on-error']).toBeUndefined()
  })
})

const commandMocks = `
node() {
  echo "node $*" >> "$COMMAND_LOG"
  case "$*" in
    *--validate)
      IFS= read -r verdict < out/orcad-prebuilds/manifest.json
      [ "$verdict" = valid ] ;;
    *--print-slot) echo win32-x64 ;;
    *) return 41 ;;
  esac
}
pnpm() {
  echo "pnpm $*" >> "$COMMAND_LOG"
  if [ "$*" = build:orcad-prebuilds ]; then
    if [ "$RUNNER_OS" = Windows ]; then
      [ ! -e out/orcad-prebuilds/old-payload ] || return 42
    fi
    [ "$COMPILE_STATUS" = 0 ] || return "$COMPILE_STATUS"
    mkdir -p out/orcad-prebuilds
    echo valid > out/orcad-prebuilds/manifest.json
  fi
}
`

function runBuild({ os = 'Windows', hit = '', outcome = '', manifest = 'valid', compile = '0' }) {
  const directory = mkdtempSync(join(tmpdir(), 'orca-windows-prebuild-workflow-'))
  const log = join(directory, 'commands')
  try {
    mkdirSync(join(directory, 'out/orcad-prebuilds'), { recursive: true })
    writeFileSync(join(directory, 'out/orcad-prebuilds/manifest.json'), `${manifest}\n`)
    writeFileSync(join(directory, 'out/orcad-prebuilds/old-payload'), 'old payload')
    writeFileSync(join(directory, 'out/preserve-other-output'), 'keep')
    writeFileSync(log, '')
    const result = runProcessSync({
      program: 'bash',
      args: ['-e', '-o', 'pipefail', '-c', `${commandMocks}\n${build.run}`],
      cwd: directory,
      env: {
        ...process.env,
        ORCA_BACKGROUND_LAUNCH: '1',
        RUNNER_OS: os,
        WINDOWS_PREBUILD_CACHE_HIT: hit,
        WINDOWS_PREBUILD_CACHE_RESTORE_OUTCOME: outcome,
        COMMAND_LOG: log,
        COMPILE_STATUS: compile
      },
      timeoutMs: 10_000
    })
    expect(readFileSync(join(directory, 'out/preserve-other-output'), 'utf8')).toBe('keep')
    return { result, commands: readFileSync(log, 'utf8').trim().split('\n') }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

describe.skipIf(process.platform === 'win32')('Windows prebuild Bash fallback', () => {
  it.each([
    ['warm valid', 'true', 'success', 'valid', false, true],
    ['invalid manifest', 'true', 'success', '{broken', true, true],
    ['restore error', 'true', 'failure', 'valid', true, false],
    ['cache miss', 'false', 'success', 'valid', true, false],
    ['missing identity', '', '', 'valid', true, false]
  ])('%s retains fresh gates', (_name, hit, outcome, manifest, compiles, validates) => {
    const { result, commands } = runBuild({ hit, outcome, manifest })
    expect(result.code).toBe(0)
    expect(commands.includes('pnpm build:orcad-prebuilds')).toBe(compiles)
    expect(
      commands.includes('node config/scripts/orcad-windows-prebuild-cache.mjs --validate')
    ).toBe(validates)
    expect(commands.slice(-3)).toEqual([
      'node config/scripts/build-orcad-prebuilds.mjs --print-slot',
      'pnpm build:orcad-prebuilds --require-slots win32-x64',
      'pnpm build:orcad-prebuilds --smoke'
    ])
  })

  it.each(['Linux', 'macOS'])('%s keeps its fresh compilation and other output', (os) => {
    const { result, commands } = runBuild({ os, hit: 'true', outcome: 'success' })
    expect(result.code).toBe(0)
    expect(commands[0]).toBe('pnpm build:orcad-prebuilds')
  })

  it('stops qualification when fallback compilation fails', () => {
    const { result, commands } = runBuild({
      hit: 'true',
      outcome: 'success',
      manifest: '{broken',
      compile: '9'
    })
    expect(result.code).toBe(9)
    expect(commands.at(-1)).toBe('pnpm build:orcad-prebuilds')
  })
})
