const { chmodSync, existsSync, readdirSync, readFileSync, writeFileSync } = require('node:fs')
const { execFileSync } = require('node:child_process')
const { join, resolve } = require('node:path')
const electronBuilderNativeRebuild = require('./scripts/electron-builder-native-rebuild.cjs')
const {
  assertPackagedDaemonEntryExists,
  verifyPackagedDaemonEntryBoots
} = require('./scripts/verify-packaged-daemon-entry.cjs')
const {
  assertPackagedNativeVariantsInstalled,
  createPackagedRuntimeNodeModuleResources,
  prunePackagedRuntimeNodeModules,
  verifyPackagedMainRuntimeDeps
} = require('./packaged-runtime-node-modules.cjs')
const { writeMacBuildCompatibility } = require('./scripts/mac-build-compatibility.cjs')
const {
  MOBILE_WEB_BUNDLE_DIR,
  assertMobileWebBundleBuilt
} = require('./scripts/verify-packaged-mobile-web-bundle.cjs')
const { verifyPackagedPluginResources } = require('./scripts/verify-packaged-plugin-resources.cjs')
const {
  verifyPackagedWindowsNodePty
} = require('./scripts/verify-packaged-node-pty-job-ownership.cjs')
const { verifySkillsCliRuntime } = require('./scripts/verify-skills-cli-runtime.cjs')
const {
  PHORCA_PACKAGE_IDENTITY,
  assertPhorcaIdentityResolved,
  getPhorcaArtifactNames
} = require('./scripts/phorca-package-identity.cjs')
assertPhorcaIdentityResolved()

// Release-control owns version allocation; these channel variables remain only
// for compatibility with local build wrappers that inject an allocated version.
const isMacHourly = process.env.ORCA_MAC_HOURLY === '1'
const isMacDaily = process.env.ORCA_MAC_DAILY === '1'
const isMacAdhoc = process.env.ORCA_MAC_ADHOC === '1'
const isWinHourly = process.env.ORCA_WIN_HOURLY === '1'
const isWinDaily = process.env.ORCA_WIN_DAILY === '1'
const isWinAdhoc = process.env.ORCA_WIN_ADHOC === '1'
const isWinDevChannel = isWinHourly || isWinDaily || isWinAdhoc
const isMacRelease = process.env.ORCA_MAC_RELEASE === '1' || isMacHourly || isMacDaily || isMacAdhoc
const localBuildVersion =
  isMacRelease || isWinDevChannel ? undefined : process.env.ORCA_LOCAL_BUILD_VERSION
const isHourlyChannel = isMacHourly || isWinHourly
const isDailyChannel = isMacDaily || isWinDaily
const isAdhocChannel = isMacAdhoc || isWinAdhoc
const devChannelBuildVersion = isHourlyChannel
  ? process.env.ORCA_HOURLY_BUILD_VERSION
  : isDailyChannel
    ? process.env.ORCA_DAILY_BUILD_VERSION
    : isAdhocChannel
      ? process.env.ORCA_ADHOC_BUILD_VERSION
      : undefined
const PHORCA_ARTIFACT_NAMES = getPhorcaArtifactNames()
const featureWallResources = {
  from: 'resources/onboarding/feature-wall',
  to: 'onboarding/feature-wall'
}
// Why: freshness detection needs immutable identity metadata from this exact
// app build, but never needs the skill package bytes or a runtime network read.
const skillFreshnessResources = {
  from: 'resources/skills',
  to: 'skills'
}
// Why: SSH relay deploy resolves bundles from process.resourcesPath in packaged
// apps. Keeping relay assets as extraResources makes them real directories
// instead of paths hidden inside app.asar.
const relayExtraResource = {
  from: 'out/relay',
  to: 'relay'
}
// Why: bundled plugins are immutable install inputs and must remain ordinary
// directories so the startup bootstrap can verify and publish exact bytes.
const bundledPluginResources = {
  from: 'resources/plugins/launch',
  to: 'plugins/launch'
}
// Why: the main bundle, packaged CLI, SSH paths, and speech worker all execute
// from package directories where pnpm's symlink farm is absent. Copy the exact
// runtime dependency closure to Resources/node_modules so bare require() calls
// do not fall through to a developer checkout's node_modules.
// Why the single file rather than the package root: app.asar carries no node_modules, so main's
// lazy require in deferred-emoji-shortcode-dataset.ts resolves only out of Resources/node_modules,
// but emojibase-data is 49 MB of locale datasets and worktree naming reads exactly this 166 KB file.
const emojiShortcodeDatasetResource = {
  from: 'node_modules/emojibase-data/en/shortcodes/emojibase.json',
  to: 'node_modules/emojibase-data/en/shortcodes/emojibase.json'
}
const commonExtraResources = [
  relayExtraResource,
  bundledPluginResources,
  skillFreshnessResources,
  emojiShortcodeDatasetResource
]
// Why: native speech addons must be real files outside app.asar; copy only the
// package matching the artifact target instead of every optional variant.
const macSpeechNativeResource = {
  from: 'node_modules/sherpa-onnx-darwin-${arch}',
  to: 'node_modules/sherpa-onnx-darwin-${arch}'
}
const winSpeechNativeResource = {
  from: 'node_modules/sherpa-onnx-win-x64',
  to: 'node_modules/sherpa-onnx-win-x64'
}

// Why mirrored, not imported: this config is CJS loaded by electron-builder outside the TS build.
// Keep in sync with isMarkdownDocumentName() in src/main/ipc/markdown-documents.ts and with
// config/nsis/orca-installer-hooks.nsh, which registers the same set on Windows.
const MARKDOWN_FILE_EXTENSIONS = ['md', 'markdown', 'mdx']

// Why: the config must load on a host-only install without resolving unused Windows addons.
// This is load-time tolerance only; beforePack enforces that the target's natives are installed.
// Why one package: @vscode/windows-process-tree is the only os: win32 npm addon;
// @orca/windows-registry is a workspace link present on every host, so its presence proves nothing.
const windowsRuntimeResources = existsSync(
  join(__dirname, '..', 'node_modules', '@vscode', 'windows-process-tree', 'package.json')
)
  ? createPackagedRuntimeNodeModuleResources('win32')
  : []

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: PHORCA_PACKAGE_IDENTITY.appId,
  productName: PHORCA_PACKAGE_IDENTITY.productName,
  protocols: [{ name: 'Orca', schemes: ['orca'] }],
  ...(devChannelBuildVersion
    ? { extraMetadata: { version: devChannelBuildVersion } }
    : localBuildVersion
      ? { extraMetadata: { version: localBuildVersion } }
      : {}),
  directories: {
    buildResources: 'resources/build'
  },
  files: [
    '!**/.vscode/*',
    // Why: these repo-only inputs are either bundled into out/ or copied via
    // extraResources. Shipping them in app.asar bloats the desktop bundle.
    '!src{,/**/*}',
    '!config{,/**/*}',
    '!docs{,/**/*}',
    '!mobile{,/**/*}',
    '!native{,/**/*}',
    '!skills{,/**/*}',
    // Why: guide/stub authoring sources are compiled into runtime artifacts; shipping
    // either source tree would duplicate content without a runtime consumer.
    '!skill-guides{,/**/*}',
    '!skill-stubs{,/**/*}',
    '!tests{,/**/*}',
    // Why: examples/ is plugin authoring documentation with no runtime consumer —
    // bundled plugins ship via extraResources from resources/plugins/launch/. It also
    // carries hostile-panel, the adversarial fixture the containment tests point at,
    // which must never reach a user's install.
    '!examples{,/**/*}',
    // Why: pr-evidence/ is a local e2e screenshot output (ORCA_CAPTURE_EVIDENCE);
    // it is gitignored, but exclude it defensively so a stray local capture at
    // package time never bloats app.asar.
    '!pr-evidence{,/**/*}',
    // Why: local agent/tooling directories may contain worktree symlink loops;
    // they are never runtime inputs and must not be traversed by electron-builder.
    '!{.claude,.grok,.agents,.codex}{,/**/*}',
    '!Casks{,/**/*}',
    '!{AGENTS.md,CLAUDE.md,DEVELOPING.md,bundle-size-progress.md,ORCHESTRATION_IMPLEMENTATION_CHECKLIST.md,ORCHESTRATION_STRUCTURED_OUTPUT_DESIGN.md}',
    '!out/**/*.test.js',
    // Why: main builds with sourcemap:'hidden' so release CI can publish maps
    // for decoding minified crash traces. The app never loads them (no
    // sourceMappingURL is emitted), and packing them would add ~34MB to app.asar.
    '!out/**/*.map',
    // Why: Vite's manifest is only used to project the paired web client.
    '!out/renderer/.vite{,/**/*}',
    // Why: out/electron-dev caches `pnpm dev`'s per-branch Electron.app copies (~270MB each).
    // CI never creates it, but packaging on a machine that has run dev would pack them all.
    '!out/electron-dev{,/**/*}',
    '!electron.vite.config.{js,ts,mjs,cjs}',
    '!{.eslintcache,eslint.config.mjs,.prettierignore,.prettierrc.yaml,CHANGELOG.md,README.md}',
    '!{.env,.env.*,.npmrc,pnpm-lock.yaml}',
    '!tsconfig.json',
    // Why: feature-wall media is copied via extraResources so runtime can read
    // it from process.resourcesPath; exclude the source copy from app.asar.
    '!resources/onboarding/feature-wall/**',
    '!resources/skills/**',
    // Why: bundled plugins ship via extraResources to resources/plugins/launch;
    // packing the source tree into app.asar would duplicate those exact bytes.
    '!resources/plugins/launch/**',
    // Why: speech packages are copied selectively through the platform
    // extraResources entry below; keeping them in app.asar would ship every
    // native variant (and duplicate the selected one).
    '!node_modules/sherpa-onnx*{,/**/*}',
    // Why: the Windows CLI shim ships via extraResources to resources/bin/orca.cmd
    // (beside the native resources/bin/orca.exe). Packing the source tree into
    // app.asar too lets asarUnpack:['resources/**'] extract a second copy at
    // app.asar.unpacked/resources/win32/bin/orca.cmd with no adjacent orca.exe,
    // which fails to launch the CLI (#7351).
    '!resources/win32{,/**/*}'
  ],
  // Why: the CLI entry-point lives in out/cli/ but imports shared modules
  // from out/shared/ and local hook mutators from out/main/. These paths must be
  // unpacked so that Node's require() can resolve the cross-directory imports
  // when the CLI runs outside the asar archive.
  // Why: daemon-entry.js is forked as a separate Node.js process and must be
  // accessible on disk (not inside the asar archive) for child_process.fork().
  // Why: the CLI is compiled by tsc (not bundled), so its runtime imports
  // resolve at runtime via Node's normal module lookup. The shim launches
  // the CLI with ELECTRON_RUN_AS_NODE, which bypasses Electron's asar
  // integration — dependencies inside the asar archive are invisible to
  // require(). Unpack CLI runtime deps so they resolve from
  // app.asar.unpacked/node_modules/.
  // Why: remote runtime connections use WebSocket + E2EE from the packaged CLI
  // before the GUI process starts, so those deps need the same treatment.
  // Why: out/package.json pins compiled output to CommonJS so parent
  // package.json files with type=module cannot change the packaged CLI loader.
  // Why: the OpenCode SQLite worker entry is also spawned by the scanner
  // service, which runs under ELECTRON_RUN_AS_NODE and so cannot see into
  // app.asar. Left packed, that spawn fails closed and every OpenCode session
  // disappears from Agent Session History in packaged builds only. Worker
  // entries reached solely from the Electron main process stay packed, since
  // asar redirects their app.asar paths.
  asarUnpack: [
    'out/package.json',
    'out/cli/**',
    'out/shared/**',
    'out/main/agent-hooks/**',
    'out/main/antigravity/**',
    'out/main/claude/**',
    'out/main/claude-accounts/keychain.js',
    'out/main/codex/**',
    'out/main/copilot/**',
    'out/main/cursor/**',
    'out/main/droid/**',
    'out/main/gemini/**',
    'out/main/grok/**',
    'out/main/hermes/**',
    'out/main/daemon-entry.js',
    'out/main/session-scanner-service-entry.js',
    'out/main/wsl-transcript-fs-process-entry.js',
    'out/main/session-scanner-opencode-sqlite-worker-entry.js',
    'out/main/plugin-host-entry.js',
    'out/main/computer-sidecar.js',
    'out/main/parcel-watcher-process-entry.js',
    'out/main/chunks/**',
    'resources/**',
    'node_modules/ws/**',
    'node_modules/tweetnacl/**',
    'node_modules/zod/**',
    'node_modules/yaml/**'
  ],
  // electron-builder calls this with the context alone. The second parameter is the bundle root,
  // so a test can point the guard at a scratch bundle instead of needing the repo's out/ built.
  beforePack: (context, mobileWebBundleDir = MOBILE_WEB_BUNDLE_DIR) => {
    assertPackagedNativeVariantsInstalled(context.electronPlatformName, context.arch)
    assertMobileWebBundleBuilt(mobileWebBundleDir)
  },
  afterPack: async (context) => {
    const resourcesDir =
      context.electronPlatformName === 'darwin'
        ? join(
            context.appOutDir,
            `${context.packager.appInfo.productFilename}.app`,
            'Contents',
            'Resources'
          )
        : join(context.appOutDir, 'resources')
    if (!existsSync(resourcesDir)) {
      throw new Error(`Missing packaged resources directory: ${resourcesDir}`)
    }
    if (context.electronPlatformName === 'darwin') {
      const architectureByEnum = { 1: 'x64', 3: 'arm64' }
      const architecture = architectureByEnum[context.arch]
      if (!architecture) {
        throw new Error(`Unsupported local-build compatibility architecture: ${context.arch}`)
      }
      const version = context.packager.appInfo.version
      let commit = process.env.ORCA_BUILD_COMMIT || process.env.GITHUB_SHA || 'unknown'
      if (commit === 'unknown') {
        try {
          commit = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
            encoding: 'utf8'
          }).trim()
        } catch {
          // Source archives can still produce a signed build with an explicit version.
        }
      }
      writeMacBuildCompatibility(resourcesDir, { version, commit, architecture })
    }
    stampPackagedCliVersion(resourcesDir, context.packager.appInfo.version)
    prunePackagedRuntimeNodeModules(resourcesDir, context.electronPlatformName, context.arch)
    verifyPackagedMainRuntimeDeps(resourcesDir)
    // Why: boot the packaged daemon-entry under plain Node, but only for the
    // slice matching the packaging host's arch — daemon-entry.js is JS, yet it
    // require()s the native (N-API) node-pty for the TARGET arch, which the host
    // Node cannot load cross-arch. `Arch` enum: ia32=0, x64=1, armv7l=2,
    // arm64=3, universal=4 (universal contains the host slice, so run it).
    const archEnumByNodeArch = { ia32: 0, x64: 1, armv7l: 2, arm64: 3 }
    const hostArchEnum = archEnumByNodeArch[process.arch]
    const canExecuteTargetArch = context.arch === hostArchEnum || context.arch === 4
    if (context.electronPlatformName === 'win32') {
      verifyPackagedWindowsNodePty(resourcesDir, context.arch, { canExecuteTargetArch })
    }
    verifySkillsCliRuntime(join(resourcesDir, 'app.asar.unpacked', 'out'), resourcesDir, {
      executeCommands: canExecuteTargetArch
    })
    if (!canExecuteTargetArch) {
      console.log(
        `[verify-skills-cli-runtime] skipped command probes on cross-arch slice (target ${context.arch}, host ${process.arch})`
      )
    }
    if (canExecuteTargetArch) {
      verifyPackagedDaemonEntryBoots(resourcesDir)
    } else {
      // Why: a cross-arch slice can't be booted by the host Node, but the
      // unpacked entry must still exist — its absence is a layout regression
      // regardless of arch, so only the boot is skipped, not the check.
      assertPackagedDaemonEntryExists(resourcesDir)
      console.log(
        `[verify-packaged-daemon-entry] skipped boot on cross-arch slice (target ${context.arch}, host ${process.arch})`
      )
    }
    // Why: inspect electron-builder's real output so a broken extraResources
    // mapping fails packaging before bundled content reaches users.
    verifyPackagedPluginResources(resourcesDir)
    chmodUnixCliLaunchers(resourcesDir, context.electronPlatformName)
    chmodMacServeSimHelpers(resourcesDir, context.electronPlatformName)
    for (const filename of readdirSync(resourcesDir)) {
      if (!filename.startsWith('agent-browser-')) {
        continue
      }
      // Why: the upstream package has inconsistent executable bits across
      // platform binaries (notably darwin-x64). child_process.execFile needs
      // the copied binary to be executable in packaged apps.
      chmodSync(join(resourcesDir, filename), 0o755)
    }
    if (context.electronPlatformName === 'darwin') {
      await signMacComputerUseHelper(join(resourcesDir, 'Orca Computer Use.app'))
      await signMacStandaloneHelper(
        join(resourcesDir, '..', 'MacOS', 'orca-notification-status'),
        'orca-notification-status'
      )
      await signMacStandaloneHelper(
        join(resourcesDir, '..', 'MacOS', 'orca-keyboard-layout'),
        'orca-keyboard-layout'
      )
    }
  },
  win: {
    executableName: 'Orca',
    // No signtool, publisher name, or custom uninstaller hook is configured:
    // the single NSIS installer and every Windows payload are intentionally
    // unsigned.
    target: ['nsis'],
    extraResources: [
      ...commonExtraResources,
      ...windowsRuntimeResources,
      winSpeechNativeResource,
      {
        from: 'resources/win32/bin/orca.cmd',
        to: 'bin/orca.cmd'
      },
      {
        from: 'native/windows-cli-launcher/.build/orca.exe',
        to: 'bin/orca.exe'
      },
      {
        from: 'node_modules/agent-browser/bin/agent-browser-win32-x64.exe',
        to: 'agent-browser-win32-x64.exe'
      },
      {
        from: 'native/computer-use-windows/runtime.ps1',
        to: 'computer-use-windows/runtime.ps1'
      },
      featureWallResources
    ]
  },
  nsis: {
    artifactName: `${PHORCA_ARTIFACT_NAMES.windowsInstaller}.\${ext}`,
    shortcutName: '${productName}',
    uninstallDisplayName: '${productName}',
    createDesktopShortcut: 'always',
    // Why: electron-builder allows one include, so both Windows installer hooks live in it -
    // the relocated-daemon uninstall sweep (guarded by ${isUpdated} so it never runs during an
    // update's uninstallOldVersion) and the additive markdown "Open with" registration.
    // Windows markdown association is deliberately NOT done via `fileAssociations`; see the
    // header comment in that file for why that would steal the user's default .md handler.
    include: resolve(__dirname, 'nsis', 'orca-installer-hooks.nsh')
  },
  mac: {
    // Identity "-" asks codesign/electron-builder for an identity-less
    // ad-hoc signature. It is signing, not disabled signing, and works without
    // an Apple Developer ID certificate or notarization ticket.
    identity: '-',
    // Why rank Alternate: Orca joins Finder's "Open With" list for Markdown without claiming
    // LSHandlerRank ownership, so whichever editor the user already prefers stays the default.
    // Why one entry per extension: app-builder-lib globs `*.${ext}`, which an array would break.
    fileAssociations: MARKDOWN_FILE_EXTENSIONS.map((ext) => ({
      ext,
      name: 'Markdown Document',
      description: 'Markdown Document',
      role: 'Editor',
      rank: 'Alternate'
    })),
    icon: 'resources/build/icon.icns',
    entitlements: 'resources/build/entitlements.mac.plist',
    entitlementsInherit: 'resources/build/entitlements.mac.plist',
    extendInfo: {
      NSAppleEventsUsageDescription:
        'Orca allows terminal-launched developer tools to automate local apps when you request it.',
      NSBluetoothAlwaysUsageDescription:
        'Orca allows terminal-launched developer tools to access Bluetooth devices when you request it.',
      NSBluetoothPeripheralUsageDescription:
        'Orca allows terminal-launched developer tools to access Bluetooth devices when you request it.',
      NSCameraUsageDescription: "Application requests access to the device's camera.",
      NSLocationUsageDescription:
        'Orca allows terminal-launched developer tools to access location when you request it.',
      NSLocalNetworkUsageDescription:
        'Orca allows terminal-launched developer tools to discover and connect to local development servers when you request it.',
      NSMicrophoneUsageDescription: "Application requests access to the device's microphone.",
      NSAudioCaptureUsageDescription:
        'Orca allows terminal-launched developer tools to capture desktop audio when you request it.',
      NSBonjourServices: ['_http._tcp', '_https._tcp'],
      NSDocumentsFolderUsageDescription:
        "Application requests access to the user's Documents folder.",
      NSDownloadsFolderUsageDescription:
        "Application requests access to the user's Downloads folder."
    },
    extraResources: [
      ...commonExtraResources,
      ...createPackagedRuntimeNodeModuleResources('darwin'),
      macSpeechNativeResource,
      {
        from: 'resources/darwin/bin/orca',
        to: 'bin/orca'
      },
      {
        from: 'node_modules/agent-browser/bin/agent-browser-darwin-${arch}',
        to: 'agent-browser-darwin-${arch}'
      },
      {
        from: 'native/computer-use-macos/.build/release/Orca Computer Use.app',
        to: 'Orca Computer Use.app'
      },
      featureWallResources
    ],
    // Why: the notification-status helper must execute from Contents/MacOS —
    // on macOS 26 UNUserNotificationCenter aborts (bundleProxyForCurrentProcess
    // is nil) for executables launched out of Contents/Resources (#7929).
    extraFiles: [
      {
        from: 'native/notification-status-macos/.build/release/orca-notification-status',
        to: 'MacOS/orca-notification-status'
      },
      {
        from: 'native/keyboard-layout-macos/.build/release/orca-keyboard-layout',
        to: 'MacOS/orca-keyboard-layout'
      }
    ],
    target: [
      {
        target: 'dmg',
        arch: ['x64', 'arm64']
      }
    ]
  },
  dmg: {
    artifactName: `${PHORCA_ARTIFACT_NAMES.macDmg}-\${arch}.\${ext}`
  },
  beforeBuild: electronBuilderNativeRebuild,
  // Why: must be true so that electron-builder rebuilds native modules
  // (node-pty) for each target architecture when producing dual-arch macOS
  // builds (x64 + arm64). With npmRebuild disabled, CI on an arm64 runner
  // packages arm64 binaries into the x64 DMG, causing "posix_spawnp failed"
  // on Intel Macs. The beforeBuild hook performs Orca's targeted rebuild and
  // returns false so electron-builder does not rebuild optional cpu-features.
  npmRebuild: true,
}

// Stamp the effective channel version where node-mode CLI code can read it.
function stampPackagedCliVersion(resourcesDir, version) {
  const packageJsonPath = join(resourcesDir, 'app.asar.unpacked', 'out', 'package.json')
  if (!existsSync(packageJsonPath)) {
    throw new Error(`Missing unpacked CLI package boundary: ${packageJsonPath}`)
  }
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  writeFileSync(packageJsonPath, `${JSON.stringify({ ...packageJson, version }, null, 2)}\n`)
}

function chmodUnixCliLaunchers(resourcesDir, electronPlatformName) {
  if (electronPlatformName === 'win32') {
    return
  }
  for (const launcherName of ['orca', 'orca-ide']) {
    const launcherPath = join(resourcesDir, 'bin', launcherName)
    if (!existsSync(launcherPath)) {
      continue
    }
    // Why: packaged Unix installs expose these extraResources as public shell
    // commands, and source/packager mode drift must not ship a non-executable CLI.
    chmodSync(launcherPath, 0o755)
  }
}

function chmodMacServeSimHelpers(resourcesDir, electronPlatformName) {
  if (electronPlatformName !== 'darwin') {
    return
  }
  const helperPaths = [
    join(resourcesDir, 'serve-sim', 'bin', 'serve-sim-bin'),
    join(resourcesDir, 'serve-sim', 'dist', 'simcam', 'serve-sim-camera-helper'),
    join(resourcesDir, 'node_modules', 'serve-sim', 'bin', 'serve-sim-bin'),
    join(resourcesDir, 'node_modules', 'serve-sim', 'dist', 'simcam', 'serve-sim-camera-helper')
  ]
  for (const helperPath of helperPaths) {
    if (existsSync(helperPath)) {
      chmodSync(helperPath, 0o755)
    }
  }
}

async function signMacComputerUseHelper(helperAppPath) {
  if (!existsSync(helperAppPath)) {
    if (isMacRelease) {
      throw new Error(`Missing Orca Computer Use helper app at ${helperAppPath}`)
    }
    return
  }
  // Nested helpers must use the same identity-less signature as the outer app.
  execFileSync('codesign', codesignArgs(helperAppPath), { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', helperAppPath], {
    stdio: 'inherit'
  })
}

async function signMacStandaloneHelper(helperPath, helperName) {
  if (!existsSync(helperPath)) {
    if (isMacRelease) {
      throw new Error(`Missing ${helperName} helper at ${helperPath}`)
    }
    return
  }
  // Nested executables must be signed before the outer app bundle is sealed.
  execFileSync('codesign', ['--force', '--sign', '-', helperPath], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--strict', helperPath], { stdio: 'inherit' })
}

function codesignArgs(targetPath) {
  return ['--force', '--deep', '--sign', '-', targetPath]
}
