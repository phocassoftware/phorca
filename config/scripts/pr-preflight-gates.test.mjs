import { expect, it } from 'vitest'
import { classifyPrJobs } from './pr-code-change-scope.mjs'

it.each([
  { changed: ['README.md'], static_analysis: false, typecheck: false, mobile_dependencies: false },
  {
    changed: ['mobile/src/App.tsx'],
    static_analysis: true,
    typecheck: false,
    mobile_dependencies: true
  },
  {
    changed: ['cloud/package.json'],
    static_analysis: false,
    typecheck: false,
    mobile_dependencies: false
  },
  {
    changed: ['src/main/index.ts'],
    static_analysis: true,
    typecheck: true,
    mobile_dependencies: false
  },
  {
    changed: ['mobile/src/App.tsx', 'src/main/index.ts'],
    static_analysis: true,
    typecheck: true,
    mobile_dependencies: true
  },
  { changed: [], static_analysis: true, typecheck: true, mobile_dependencies: true }
])('preserves exact phase selection for unrelated paths: $changed', ({ changed, ...expected }) => {
  const scope = classifyPrJobs(changed)
  expect({
    static_analysis: scope.static_analysis,
    typecheck: scope.typecheck,
    mobile_dependencies: scope.mobile_dependencies
  }).toEqual(expected)
  expect(scope.test).toBe(expected.typecheck)
})
