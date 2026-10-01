import { expect, it } from 'vitest'
import { z } from 'zod'
import schema from '../../../config/phorca-managed-policy.schema.json'
import example from '../../../config/phorca-managed-policy.example.json'
import { phorcaManagedPolicySchema } from './managed-policy'

it('keeps the deployment schema and restrictive example aligned with enforcement', () => {
  expect(schema).toEqual(z.toJSONSchema(phorcaManagedPolicySchema, { io: 'input' }))
  expect(phorcaManagedPolicySchema.parse(example)).toEqual(example)
})
