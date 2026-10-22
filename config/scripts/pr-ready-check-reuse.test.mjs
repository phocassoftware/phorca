import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  lookupReadyCheckRun,
  prCheckRunTitle,
  reusablePrCheckRun
} from './pr-ready-check-reuse.mjs'

const identity = {
  number: 42,
  sourceSha: 'a'.repeat(40),
  workflowSha: 'b'.repeat(40),
  headSha: 'c'.repeat(40),
  runId: '456'
}
const passed = {
  id: 123,
  path: '.github/workflows/pr.yml',
  event: 'pull_request',
  status: 'completed',
  conclusion: 'success',
  head_sha: identity.headSha,
  display_title: prCheckRunTitle(identity)
}
const event = {
  action: 'ready_for_review',
  pull_request: { number: 42, draft: false, head: { sha: identity.headSha } }
}
const env = {
  GITHUB_EVENT_NAME: 'pull_request',
  GITHUB_SHA: identity.sourceSha,
  PR_CHECK_WORKFLOW_SHA: identity.workflowSha,
  GITHUB_RUN_ID: identity.runId,
  GITHUB_REPOSITORY: 'stablyai/orca',
  GH_TOKEN: 'read-only-test-token'
}
const response = (runs) => ({ ok: true, json: async () => ({ workflow_runs: runs }) })

afterEach(() => vi.restoreAllMocks())

describe('ready-for-review required check reuse', () => {
  it('reuses a completed success only for the identical PR, merge source and workflow', () => {
    expect(reusablePrCheckRun([passed], identity)).toBe(passed)
    expect(reusablePrCheckRun([], identity)).toBeUndefined()
    expect(
      reusablePrCheckRun(
        [{ ...passed, display_title: prCheckRunTitle({ ...identity, unitMode: 'selected' }) }],
        identity
      )
    ).toBeUndefined()
    for (const key of ['number', 'sourceSha', 'workflowSha', 'headSha', 'runId']) {
      const changed = key === 'number' ? 43 : key === 'runId' ? '123' : 'd'.repeat(40)
      expect(reusablePrCheckRun([passed], { ...identity, [key]: changed }), key).toBeUndefined()
    }
    for (const key of ['number', 'sourceSha', 'workflowSha', 'headSha']) {
      expect(reusablePrCheckRun([passed], { ...identity, [key]: undefined }), key).toBeUndefined()
    }
  })

  it.each([
    { status: 'in_progress' },
    { status: 'queued' },
    { conclusion: 'failure' },
    { conclusion: 'cancelled' },
    { conclusion: 'skipped' },
    { event: 'push' },
    { path: '.github/workflows/other.yml' },
    { display_title: 'Previous workflow without source provenance' },
    { id: -1 }
  ])('rejects unusable evidence %j', (change) => {
    expect(reusablePrCheckRun([{ ...passed, ...change }], identity)).toBeUndefined()
  })

  it('bounds the read-only lookup to this workflow and PR head', async () => {
    const request = vi.fn(async () => response([passed]))
    expect(await lookupReadyCheckRun(env, event, request)).toBe(passed)
    expect(request).toHaveBeenCalledTimes(1)
    const [url, options] = request.mock.calls[0]
    expect(url.origin).toBe('https://api.github.com')
    expect(url.pathname).toBe('/repos/stablyai/orca/actions/workflows/pr.yml/runs')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      event: 'pull_request',
      head_sha: identity.headSha,
      status: 'success',
      per_page: '20'
    })
    expect(options.method).toBeUndefined()
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })

  it('runs ordinary pushes and draft checks without consulting old results', async () => {
    const request = vi.fn()
    for (const action of ['opened', 'synchronize', 'reopened', 'converted_to_draft']) {
      expect(await lookupReadyCheckRun(env, { ...event, action }, request)).toBeUndefined()
    }
    expect(
      await lookupReadyCheckRun(
        env,
        { ...event, pull_request: { ...event.pull_request, draft: true } },
        request
      )
    ).toBeUndefined()
    expect(await lookupReadyCheckRun({ ...env, GH_TOKEN: '' }, event, request)).toBeUndefined()
    expect(
      await lookupReadyCheckRun({ ...env, GITHUB_EVENT_NAME: 'push' }, event, request)
    ).toBeUndefined()
    expect(request).not.toHaveBeenCalled()
  })

  it('falls back to full checks when the API is unavailable or evidence is malformed', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    for (const request of [
      async () => ({ ok: false, status: 403 }),
      async () => ({ ok: false, status: 429 }),
      async () => ({ ok: true, json: async () => ({}) }),
      async () => {
        throw new Error('Network unavailable')
      }
    ]) {
      expect(await lookupReadyCheckRun(env, event, request)).toBeUndefined()
    }
    expect(await lookupReadyCheckRun(env, event, async () => response([]))).toBeUndefined()
  })
})
