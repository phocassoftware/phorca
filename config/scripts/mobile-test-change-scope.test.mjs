import { expect, it } from 'vitest'
import { shouldRunMobileTests } from './mobile-test-change-scope.mjs'

it.each([
  'docs/ci.md',
  'mobile/docs/release.md',
  'mobile/README.md',
  'mobile/Gemfile.lock',
  'mobile/fastlane/Fastfile',
  '.github/workflows/mobile-ios-release.yml',
  'config/scripts/pr-code-change-scope.mjs',
  'config/scripts/mobile-release-check-scope.test.mjs'
])('skips only known non-test inputs: %s', (file) => {
  expect(shouldRunMobileTests([file])).toBe(false)
  expect(shouldRunMobileTests([file, 'mobile/src/changed.ts'])).toBe(true)
})

it.each([
  'mobile/src/view.tsx',
  'mobile/app/_layout.tsx',
  'mobile/scripts/check.ts',
  'mobile/rpc-foundation/goldens/recording.json',
  'mobile/vitest.config.ts',
  'mobile/vitest.setup.ts',
  'mobile/pnpm-lock.yaml',
  'pnpm-lock.yaml',
  'src/main/runtime/runtime-rpc.ts',
  'src/shared/protocol-version.ts',
  '.github/workflows/mobile.yml',
  '.github/actions/install-node-dependencies/action.yml',
  'config/scripts/mobile-test-change-scope.mjs',
  'unknown-input',
  'mobile/docs/../../src/source.ts'
])('retains source, fixtures, toolchain, selector and unknown changes: %s', (file) => {
  expect(shouldRunMobileTests([file])).toBe(true)
})

it('retains tests on missing evidence and a move out of the source tree', () => {
  expect(shouldRunMobileTests([])).toBe(true)
  expect(shouldRunMobileTests(['mobile/src/deleted.ts', 'mobile/docs/moved.ts'])).toBe(true)
})
