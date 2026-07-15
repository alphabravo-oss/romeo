import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getGaEvidencePosture,
  getJobsOperationalSummary,
  getPostgresOperationalPosture,
  getQuotasDistributedStatus
} from './posture-client'

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

describe('posture-client — read-only system posture GETs', () => {
  it('getGaEvidencePosture GETs the GA evidence posture route and unwraps data', async () => {
    const fn = mockFetch({ data: { schema: 'romeo.ga-evidence-posture.v1', status: 'passed' } })
    const report = await getGaEvidencePosture()
    const call = lastCall(fn)
    expect(call.url).toBe('/api/v1/admin/ga/evidence-posture')
    expect(call.method).toBeUndefined()
    expect(report).toEqual({ schema: 'romeo.ga-evidence-posture.v1', status: 'passed' })
  })

  it('getPostgresOperationalPosture GETs the postgres operational posture route', async () => {
    const fn = mockFetch({ data: { schema: 'romeo.postgres-operational-posture.v1', status: 'ready' } })
    const report = await getPostgresOperationalPosture()
    const call = lastCall(fn)
    expect(call.url).toBe('/api/v1/admin/postgres/operational-posture')
    expect(call.method).toBeUndefined()
    expect(report.status).toBe('ready')
  })

  it('getJobsOperationalSummary GETs the jobs operational-summary route', async () => {
    const fn = mockFetch({ data: { status: 'healthy', totals: { total: 3 } } })
    const summary = await getJobsOperationalSummary()
    const call = lastCall(fn)
    expect(call.url).toBe('/api/v1/jobs/operational-summary')
    expect(call.method).toBeUndefined()
    expect(summary.status).toBe('healthy')
  })

  it('getQuotasDistributedStatus GETs the quotas distributed-status route', async () => {
    const fn = mockFetch({ data: { driver: 'disabled', enabled: false, healthy: null } })
    const status = await getQuotasDistributedStatus()
    const call = lastCall(fn)
    expect(call.url).toBe('/api/v1/quotas/distributed-status')
    expect(call.method).toBeUndefined()
    expect(status.driver).toBe('disabled')
  })
})
