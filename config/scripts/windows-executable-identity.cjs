const { existsSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

function appendExeExtension(value, description) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing Windows executable ${description}.`)
  }
  const trimmed = value.trim()
  return trimmed.toLowerCase().endsWith('.exe') ? trimmed : `${trimmed}.exe`
}

function resolveWindowsExecutableName(packager) {
  // appInfo.productFilename is electron-builder's resolved, filesystem-safe executable basename.
  // Reading the raw win.executableName would disagree with the emitted file when sanitization applies.
  return appendExeExtension(packager?.appInfo?.productFilename, 'name')
}

function writeWindowsExecutableIdentity({ appOutDir, resourcesDir, packager }) {
  const executableName = resolveWindowsExecutableName(packager)
  const executablePath = join(appOutDir, executableName)
  if (!existsSync(executablePath)) {
    throw new Error(`Missing packaged Windows executable: ${executablePath}`)
  }
  writeFileSync(join(resourcesDir, 'app-executable-name.txt'), `${executableName}\n`)
  return executableName
}

module.exports = { resolveWindowsExecutableName, writeWindowsExecutableIdentity }
