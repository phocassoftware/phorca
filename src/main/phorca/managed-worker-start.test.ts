import { expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from '../runtime/orca-runtime'
import { ORCHESTRATION_WORKER_START_METHODS } from '../runtime/rpc/methods/orchestration/worker/workers'
import { ORCHESTRATION_FEDERATION_ATTACH_METHODS } from '../runtime/rpc/methods/orchestration/federation/federation'

it('refuses local, outgoing and incoming remote worker starts before execution effects', async () => {
  vi.stubGlobal('PHORCA_MANAGED_BUILD', true)
  const runtime = new OrcaRuntimeService()
  const database = vi.spyOn(runtime, 'getOrchestrationDb')
  const worker = ORCHESTRATION_WORKER_START_METHODS[0]!
  for (const on of [undefined, 'remote-host']) {
    const params = worker.params.parse({
      from: 'term_coordinator',
      spec: 'Review',
      agent: 'claude',
      on
    })
    await expect(worker.handler(params, { runtime })).rejects.toThrow('administrator policy')
  }
  const attachment = ORCHESTRATION_FEDERATION_ATTACH_METHODS[0]!
  const params = attachment.params.parse({
    dispatchId: 'ctx_worker',
    taskId: 'task_worker',
    taskSpec: 'Review',
    protocolVersion: 1,
    worktree: 'id:folder',
    agent: 'codex'
  })
  await expect(attachment.handler(params, { runtime })).rejects.toThrow('administrator policy')
  expect(database).not.toHaveBeenCalled()
})
