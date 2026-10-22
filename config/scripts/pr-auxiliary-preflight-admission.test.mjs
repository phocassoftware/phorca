import { expect, it } from 'vitest'
import { classifyPrJobs } from './pr-code-change-scope.mjs'

it('selects the mobile-only bundle without unit work', () => {
  expect(classifyPrJobs(['mobile/src/App.tsx'])).toMatchObject({
    test: false,
    mobile_web_app: true
  })
})
