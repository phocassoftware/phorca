import { globSync } from 'node:fs'
import { defaultExclude } from 'vitest/config'
import { describe, expect, it } from 'vitest'
import { CROSS_VERSION_WIRE_DIR, UNIT_INCLUDE } from './ci-unit-files.mjs'

function posixPaths(files) {
  return files.map((file) => file.replaceAll('\\', '/'))
}

// Why module scope: globbing the unit tree costs seconds, and every test reads the same result.
const UNIT_FILES = posixPaths(globSync(UNIT_INCLUDE, { exclude: defaultExclude }))

describe('cross-version-wire unit discovery', () => {
  it('names every cross-version-wire test so the unit include picks it up', () => {
    // Why: a directory argument only reaches files the vitest include matches; any other name is silently skipped.
    const tests = posixPaths(
      globSync(`${CROSS_VERSION_WIRE_DIR}**/*.{test,spec}.{js,cjs,mjs,ts,tsx}`)
    )
    const included = new Set(UNIT_FILES)
    expect(tests.length).toBeGreaterThan(0)
    expect(tests.filter((file) => !included.has(file))).toEqual([])
  })
})
