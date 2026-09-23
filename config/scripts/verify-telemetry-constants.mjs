#!/usr/bin/env node

// Phorca builds omit the upstream telemetry identity and PostHog write key.
// This gate scans the files that actually ship: main JavaScript in app.asar and
// the chunked main files electron-builder places in app.asar.unpacked.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { extractFile, listPackage } from '@electron/asar'
import {
  BUILD_IDENTITY_RE,
  MINIFIED_TELEMETRY_RE,
  WRITE_KEY_RE
} from './telemetry-bundle-constant-patterns.mjs'

const distDir = resolve(process.argv[2] ?? 'dist')

const RAW_BUILD_IDENTITY_RE =
  /\b(?:ORCA_)?BUILD_IDENTITY\b\s*[:=]\s*["'`](?:stable|rc)["'`]/
const RAW_WRITE_KEY_RE =
  /\b(?:ORCA_)?(?:POSTHOG_)?WRITE_KEY\b\s*[:=]\s*["'`]phc_[A-Za-z0-9_-]+["'`]/
const TELEMETRY_PATTERNS = [
  ['BUILD_IDENTITY', BUILD_IDENTITY_RE],
  ['WRITE_KEY', WRITE_KEY_RE],
  ['minified telemetry constants', MINIFIED_TELEMETRY_RE],
  ['ORCA_BUILD_IDENTITY', RAW_BUILD_IDENTITY_RE],
  ['ORCA_POSTHOG_WRITE_KEY', RAW_WRITE_KEY_RE]
]

function walkFiles(rootDir, predicate, files = []) {
  let entries
  try {
    entries = readdirSync(rootDir, { withFileTypes: true })
  } catch {
    return files
  }
  for (const entry of entries) {
    const fullPath = join(rootDir, entry.name)
    if (entry.isDirectory()) {
      walkFiles(fullPath, predicate, files)
    } else if (entry.isFile() && predicate(fullPath, entry.name)) {
      files.push(fullPath)
    }
  }
  return files
}

function findPayloadPaths(rootDir) {
  const asars = walkFiles(rootDir, (filePath, name) => name === 'app.asar' && filePath.endsWith('app.asar'))
  const unpacked = []
  const stack = [rootDir]
  while (stack.length > 0) {
    const dir = stack.pop()
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'app.asar.unpacked') {
          unpacked.push(fullPath)
          continue
        }
        stack.push(fullPath)
      }
    }
  }
  return { asars, unpacked }
}

function readAsarSources(asarPath) {
  const sources = []
  const entries = listPackage(asarPath).filter((entry) => {
    const normalized = entry.replace(/\\/g, '/').replace(/^\/+/, '')
    return normalized.startsWith('out/main/') && normalized.endsWith('.js')
  })
  for (const entry of entries) {
    const normalized = entry.replace(/\\/g, '/').replace(/^\/+/, '')
    sources.push({
      path: `${asarPath}!/${normalized}`,
      text: extractFile(asarPath, entry.replace(/^[\\/]+/, '')).toString('utf8')
    })
  }
  return sources
}

function readUnpackedSources(unpackedPath) {
  const mainPath = join(unpackedPath, 'out', 'main')
  return walkFiles(mainPath, (filePath, name) => name.endsWith('.js')).map((filePath) => ({
    path: filePath,
    text: readFileSync(filePath, 'utf8')
  }))
}

function findTelemetryMatches(text) {
  return TELEMETRY_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name)
}

if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
  console.error(`::error::dist directory not found at ${distDir}`)
  process.exit(1)
}

const { asars, unpacked } = findPayloadPaths(distDir)
if (asars.length === 0 && unpacked.length === 0) {
  console.error(`::error::could not locate app.asar or app.asar.unpacked under ${distDir}`)
  process.exit(1)
}

const sources = []
try {
  for (const asarPath of asars) {
    sources.push(...readAsarSources(asarPath))
  }
  for (const unpackedPath of unpacked) {
    sources.push(...readUnpackedSources(unpackedPath))
  }
} catch (error) {
  console.error(`::error::could not scan packaged main code: ${error.message}`)
  process.exit(1)
}

if (sources.length === 0) {
  console.error('::error::no JavaScript files found under packaged out/main or app.asar.unpacked/out/main')
  process.exit(1)
}

console.log(`Scanning ${sources.length} packaged main JavaScript file(s) for telemetry constants.`)
const findings = []
for (const source of sources) {
  const matches = findTelemetryMatches(source.text)
  if (matches.length > 0) {
    findings.push({ path: source.path, matches })
  }
}

if (findings.length > 0) {
  for (const finding of findings) {
    console.error(`::error::telemetry constant(s) found in ${finding.path}: ${finding.matches.join(', ')}`)
  }
  process.exit(1)
}

console.log(`Telemetry constants absent across ${sources.length} packaged main JavaScript file(s).`)
