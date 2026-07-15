import { afterEach, describe, expect, it, vi } from 'vitest'

import { createWorkflow, startWorkflowRun } from './workflows-client'
import type { WorkflowStep } from './workflows-types'

function mockFetch(returnBody: unknown = { data: {} }) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, json: async () => returnBody }) as unknown as Response)
  vi.stubGlobal('fetch', fn)
  return fn
}

function lastCall(fn: ReturnType<typeof mockFetch>) {
  const call = fn.mock.calls.at(-1)
  const url = call?.[0] ?? ''
  const init = call?.[1] ?? {}
  return {
    url,
    method: init.method,
    body: init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : undefined
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const agentRunStep: WorkflowStep = { id: 'step_1', type: 'agent_run', name: 'Run agent', agentId: 'agent-1' }
const sentStep = { type: 'agent_run', name: 'Run agent', agentId: 'agent-1' }

describe('workflows-client — create workflow', () => {
  it('createWorkflow POSTs /api/v1/workflows with the required fields only (step id stripped)', async () => {
    const fn = mockFetch({ data: { id: 'wf1' } })
    await createWorkflow({ workspaceId: 'ws1', name: 'My workflow', steps: [agentRunStep] })
    const call = lastCall(fn)
    expect(call.url).toBe('/api/v1/workflows')
    expect(call.method).toBe('POST')
    expect(call.body).toEqual({ workspaceId: 'ws1', name: 'My workflow', steps: [sentStep] })
  })

  it('createWorkflow includes description and schedule only when provided', async () => {
    const fn = mockFetch({ data: { id: 'wf2' } })
    const schedule = { enabled: true, intervalMinutes: 60, nextRunAt: '2026-07-03T00:00:00.000Z' }
    await createWorkflow({ workspaceId: 'ws1', name: 'Scheduled', description: 'desc', steps: [agentRunStep], schedule })
    const call = lastCall(fn)
    expect(call.body).toEqual({ workspaceId: 'ws1', name: 'Scheduled', steps: [sentStep], description: 'desc', schedule })
  })

  it('createWorkflow omits optional keys when undefined', async () => {
    const fn = mockFetch({ data: { id: 'wf3' } })
    await createWorkflow({ workspaceId: 'ws1', name: 'Minimal', steps: [agentRunStep] })
    const body = lastCall(fn).body ?? {}
    expect('description' in body).toBe(false)
    expect('schedule' in body).toBe(false)
  })
})

describe('workflows-client — start workflow run', () => {
  it('startWorkflowRun POSTs to the runs route (workflowId url-encoded)', async () => {
    const fn = mockFetch({ data: { id: 'run1' } })
    await startWorkflowRun({ workflowId: 'wf a' })
    const call = lastCall(fn)
    expect(call.url).toBe('/api/v1/workflows/wf%20a/runs')
    expect(call.method).toBe('POST')
    expect(call.body).toEqual({})
  })

  it('startWorkflowRun includes input only when provided', async () => {
    const fn = mockFetch({ data: { id: 'run2' } })
    await startWorkflowRun({ workflowId: 'wf1', input: { topic: 'x' } })
    const call = lastCall(fn)
    expect(call.body).toEqual({ input: { topic: 'x' } })
  })
})
