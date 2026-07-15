import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  exportAdminAnalyticsSummaryCsv,
  getAdminAnalyticsSummary
} from './analytics-client'

function mockFetch(returnBody: unknown = { data: {} }) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, json: async () => returnBody, text: async () => returnBody }) as unknown as Response)
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

describe('analytics-client — admin analytics summary', () => {
  it('getAdminAnalyticsSummary GETs the summary route and unwraps the envelope', async () => {
    const fn = mockFetch({ data: { orgId: 'o1', status: 'healthy' } })
    const summary = await getAdminAnalyticsSummary()
    expect(lastCall(fn).url).toBe('/api/v1/admin/analytics/summary')
    expect(summary.orgId).toBe('o1')
  })

  it('exportAdminAnalyticsSummaryCsv fetches the .csv route with a text/csv accept header', async () => {
    const fn = mockFetch('category,dimension,id,metric,value\n')
    const csv = await exportAdminAnalyticsSummaryCsv()
    const call = fn.mock.calls.at(-1)
    expect(call?.[0]).toBe('/api/v1/admin/analytics/summary.csv')
    expect((call?.[1]?.headers as Record<string, string>).accept).toBe('text/csv')
    expect(csv).toBe('category,dimension,id,metric,value\n')
  })
})
