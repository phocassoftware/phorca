import { expect, it } from 'vitest'
import { shouldRunMobileReleaseChecks } from './mobile-release-check-scope.mjs'

it.each([
  'src/main/runtime/rpc/dispatcher.ts',
  'src/shared/rpc-contract/params.ts',
  'mobile/src/session/session.test.ts',
  'mobile/app/index.tsx',
  'mobile/src/theme.css',
  'mobile/src/session/README.md',
  'mobile/docs/release.md',
  'mobile/README.md',
  'docs/reference/mobile.md'
])('skips Ruby checks for application/documentation-only changes: %s', (file) => {
  expect(shouldRunMobileReleaseChecks([file])).toBe(false)
})

it.each([
  'mobile/fastlane/Fastfile',
  'mobile/fastlane/Appfile',
  'mobile/fastlane/ios_release_version.rb',
  'mobile/fastlane/ios_release_version_test.rb',
  'mobile/Gemfile',
  'mobile/Gemfile.lock',
  'mobile/.ruby-version',
  'mobile/.bundle/config',
  'mobile/app.json',
  'mobile/app.config.ts',
  'mobile/ios/Podfile',
  'mobile/package.json',
  'mobile/pnpm-lock.yaml',
  'mobile/scripts/release.mts',
  'mobile/src/release.rb',
  'mobile/src/release.json',
  'mobile/new-toolchain/input',
  'package.json',
  '.github/workflows/mobile.yml',
  '.github/workflows/mobile-ios-release.yml',
  '.github/actions/install-node-dependencies/action.yml',
  'config/scripts/mobile-release-check-scope.mjs',
  'config/scripts/mobile-release-check-scope.test.mjs'
])('retains Ruby release coverage for changed or unknown inputs: %s', (file) => {
  expect(shouldRunMobileReleaseChecks([file])).toBe(true)
  expect(shouldRunMobileReleaseChecks(['mobile/src/view.tsx', file])).toBe(true)
})

it('skips Ruby checks for a root lockfile change, which fastlane never reads', () => {
  expect(shouldRunMobileReleaseChecks(['pnpm-lock.yaml'])).toBe(false)
  expect(shouldRunMobileReleaseChecks(['pnpm-lock.yaml', 'mobile/fastlane/Fastfile'])).toBe(true)
})

it('runs Ruby checks when the changed-file evidence is empty', () => {
  expect(shouldRunMobileReleaseChecks([])).toBe(true)
})
