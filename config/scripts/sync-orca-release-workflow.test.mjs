import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { parse } from 'yaml'

it('runs only in Phorca, serializes scheduled/manual runs and executes trusted default-branch code', () => {
  const workflow = parse(readFileSync('.github/workflows/sync-orca-release.yml', 'utf8'))
  expect(workflow.on.schedule).toEqual([{ cron: '23 0 * * *' }])
  expect(workflow.concurrency['cancel-in-progress']).toBe(false)
  expect(workflow.jobs.sync.if).toContain("github.repository == 'phocassoftware/phorca'")
  expect(workflow.jobs.sync.if).toContain(
    "github.ref == format('refs/heads/{0}', github.event.repository.default_branch)"
  )
  expect(workflow.jobs.sync.if).toContain("vars.ORCA_SYNC_PAUSED != 'true'")
  const checkout = workflow.jobs.sync.steps.find((step) => step.uses === 'actions/checkout@v6')
  expect(checkout.with.ref).toBe('${{ github.event.repository.default_branch }}')
  expect(checkout.with.token).toBe('${{ secrets.GITHUB_TOKEN }}')
  const script = workflow.jobs.sync.steps.find((step) => step.uses === 'actions/github-script@v8')
  expect(script.with['github-token']).toBe('${{ secrets.GITHUB_TOKEN }}')
  expect(workflow.permissions).toEqual({ contents: 'write', 'pull-requests': 'write' })
  expect(JSON.stringify(workflow)).not.toContain('ORCA_SYNC_TOKEN')
  expect(script.with.script).toContain('sync-orca-release-action.mjs')
  expect(script.with.script).not.toContain('getExecOutput')
  expect(script.with.script).not.toContain('${{ inputs.tag }}')
})
