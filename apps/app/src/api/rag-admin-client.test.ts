import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  approveRagPolicyChangeRequest,
  compareRagReplay,
  createRagPolicyChangeRequest,
  getRagPolicy,
  getRagPolicyChangeRequest,
  getRagPosture,
  rejectRagPolicyChangeRequest,
  replayRag,
  updateRagPolicy
} from './rag-admin-client'

function mockFetch(returnBody: unknown = { data: {} }) {
  const fn = vi.fn(
    async (_url: string, _init?: RequestInit) => ({ ok: true, json: async () => returnBody }) as unknown as Response
  )
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

describe('rag-admin-client — policy', () => {
  it('getRagPolicy GETs the policy route (no method)', async () => {
    const fn = mockFetch({ data: { orgId: 'org', source: 'default' } })
    await getRagPolicy()
    const call = lastCall(fn)
    expect(call.url).toBe('/api/v1/admin/rag/policy')
    expect(call.method).toBeUndefined()
  })

  it('updateRagPolicy PATCHes the policy route with the patch body', async () => {
    const fn = mockFetch({ data: { orgId: 'org', source: 'org' } })
    await updateRagPolicy({ enabledTiers: ['org', 'shared'] })
    const call = lastCall(fn)
    expect(call.url).toBe('/api/v1/admin/rag/policy')
    expect(call.method).toBe('PATCH')
    expect(call.body).toEqual({ enabledTiers: ['org', 'shared'] })
  })

  it('getRagPosture GETs the posture route', async () => {
    const fn = mockFetch({ data: { orgId: 'org', status: 'ready' } })
    await getRagPosture()
    const call = lastCall(fn)
    expect(call.url).toBe('/api/v1/admin/rag/posture')
    expect(call.method).toBeUndefined()
  })
})

describe('rag-admin-client — change requests', () => {
  it('getRagPolicyChangeRequest GETs the change-request route and passes through null', async () => {
    const fn = mockFetch({ data: null })
    const result = await getRagPolicyChangeRequest()
    expect(lastCall(fn).url).toBe('/api/v1/admin/rag/policy/change-request')
    expect(result).toBeNull()
  })

  it('createRagPolicyChangeRequest POSTs the change-requests collection', async () => {
    const fn = mockFetch({ data: { requestId: 'req_1', status: 'pending' } })
    await createRagPolicyChangeRequest({
      policy: { dataResidencyTags: ['eu'] },
      justificationCode: 'compliance_update'
    })
    const call = lastCall(fn)
    expect(call.url).toBe('/api/v1/admin/rag/policy/change-requests')
    expect(call.method).toBe('POST')
    expect(call.body).toEqual({ policy: { dataResidencyTags: ['eu'] }, justificationCode: 'compliance_update' })
  })

  it('approveRagPolicyChangeRequest POSTs the approve route with confirmRequestId', async () => {
    const fn = mockFetch({ data: { requestId: 'req 1', status: 'approved' } })
    await approveRagPolicyChangeRequest('req 1', { confirmRequestId: 'req 1' })
    const call = lastCall(fn)
    expect(call.url).toBe('/api/v1/admin/rag/policy/change-requests/req%201/approve')
    expect(call.method).toBe('POST')
    expect(call.body).toEqual({ confirmRequestId: 'req 1' })
  })

  it('rejectRagPolicyChangeRequest POSTs the reject route with a reason code', async () => {
    const fn = mockFetch({ data: { requestId: 'req_2', status: 'rejected' } })
    await rejectRagPolicyChangeRequest('req_2', {
      confirmRequestId: 'req_2',
      reasonCode: 'insufficient_evidence'
    })
    const call = lastCall(fn)
    expect(call.url).toBe('/api/v1/admin/rag/policy/change-requests/req_2/reject')
    expect(call.method).toBe('POST')
    expect(call.body).toEqual({ confirmRequestId: 'req_2', reasonCode: 'insufficient_evidence' })
  })
})

describe('rag-admin-client — replay', () => {
  it('replayRag POSTs the replay route with cases', async () => {
    const fn = mockFetch({ data: { caseCount: 1, cases: [] } })
    await replayRag({ cases: [{ knowledgeBaseIds: ['kb_1'], query: 'hello' }] })
    const call = lastCall(fn)
    expect(call.url).toBe('/api/v1/admin/rag/replay')
    expect(call.method).toBe('POST')
    expect(call.body).toEqual({ cases: [{ knowledgeBaseIds: ['kb_1'], query: 'hello' }] })
  })

  it('compareRagReplay POSTs the compare route with baseline + candidate', async () => {
    const fn = mockFetch({ data: { outcome: 'unchanged' } })
    await compareRagReplay({
      baseline: [{ knowledgeBaseIds: ['kb_1'], query: 'a' }],
      candidate: [{ knowledgeBaseIds: ['kb_1'], query: 'a' }]
    })
    const call = lastCall(fn)
    expect(call.url).toBe('/api/v1/admin/rag/replay/compare')
    expect(call.method).toBe('POST')
    expect(call.body).toEqual({
      baseline: [{ knowledgeBaseIds: ['kb_1'], query: 'a' }],
      candidate: [{ knowledgeBaseIds: ['kb_1'], query: 'a' }]
    })
  })
})
