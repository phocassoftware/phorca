import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts

describe('shared E2E CLI capability', () => {
  it('uses the same preparation for locally compiled and downloaded CLI output', () => {
    expect(scripts['build:cli']).toContain('&& pnpm run prepare:cli-output')
    expect(scripts['prepare:cli-output']).toBe(
      'node config/scripts/verify-cli-bin.mjs --fix-executable --fix-package-json && node config/scripts/install-dev-cli.mjs'
    )
  })
})
