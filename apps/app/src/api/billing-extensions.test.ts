import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  enforceBillingLifecycle,
  getBillingEntitlements,
  getBillingLifecycle,
  reconcileBillingEntitlements
} from './billing-client'

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

describe('billing-client — entitlements', () => {
  it('getBillingEntitlements GETs the entitlements route and unwraps the report', async () => {
    const report = {
      orgId: 'o1',
      generatedAt: '2026-01-01T00:00:00.000Z',
      status: 'healthy',
      billingPlanConfigured: true,
      quotaTemplateCount: 1,
      unmanagedOrgQuotaCount: 0,
      warnings: [],
      quotas: []
    }
    const fn = mockFetch({ data: report })
    const result = await getBillingEntitlements()
    const call = lastCall(fn)
    expect(call.url).toBe('/api/v1/billing/entitlements')
    expect(call.method).toBeUndefined()
    expect(result).toEqual(report)
  })

  it('reconcileBillingEntitlements POSTs the reconcile route', async () => {
    const fn = mockFetch({ data: { before: {}, after: {}, actions: { createdQuotaIds: [], updatedQuotaIds: [], unchangedQuotaIds: [] } } })
    const result = await reconcileBillingEntitlements()
    const call = lastCall(fn)
    expect(call.url).toBe('/api/v1/billing/entitlements/reconcile')
    expect(call.method).toBe('POST')
    expect(call.body).toBeUndefined()
    expect(result.actions.createdQuotaIds).toEqual([])
  })
})

describe('billing-client — lifecycle', () => {
  it('getBillingLifecycle GETs the lifecycle route and unwraps the report', async () => {
    const report = {
      orgId: 'o1',
      generatedAt: '2026-01-01T00:00:00.000Z',
      status: 'attention_required',
      billingPlanConfigured: true,
      warnings: ['trial_expired'],
      recommendedAction: 'mark_past_due',
      lifecycle: {}
    }
    const fn = mockFetch({ data: report })
    const result = await getBillingLifecycle()
    const call = lastCall(fn)
    expect(call.url).toBe('/api/v1/billing/lifecycle')
    expect(call.method).toBeUndefined()
    expect(result).toEqual(report)
  })

  it('enforceBillingLifecycle POSTs the enforce route', async () => {
    const fn = mockFetch({ data: { before: {}, after: {}, action: { type: 'mark_canceled', statusChanged: true, previousStatus: 'active', newStatus: 'canceled' } } })
    const result = await enforceBillingLifecycle()
    const call = lastCall(fn)
    expect(call.url).toBe('/api/v1/billing/lifecycle/enforce')
    expect(call.method).toBe('POST')
    expect(call.body).toBeUndefined()
    expect(result.action.statusChanged).toBe(true)
  })
})
