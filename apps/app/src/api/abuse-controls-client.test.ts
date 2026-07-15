import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getAbuseControls,
  getEdgeSecurityPosture,
  updateAbuseControls
} from './abuse-controls-client'

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

describe('abuse-controls-client', () => {
  it('getAbuseControls GETs the abuse-controls route and unwraps the envelope', async () => {
    const report = { orgId: 'o1', source: 'org' }
    const fn = mockFetch({ data: report })
    const result = await getAbuseControls()
    const call = lastCall(fn)
    expect(call.url).toBe('/api/v1/admin/abuse-controls')
    expect(call.method).toBeUndefined()
    expect(result).toEqual(report)
  })

  it('updateAbuseControls PATCHes the abuse-controls route with the given body', async () => {
    const fn = mockFetch({ data: { orgId: 'o1' } })
    await updateAbuseControls({
      suspension: { suspended: true, reasonCode: 'fraud' },
      entitlements: { enforceBillingStatus: true, allowedBillingStatuses: ['active'] },
      killSwitches: { toolIds: ['tool.a'] }
    })
    const call = lastCall(fn)
    expect(call.url).toBe('/api/v1/admin/abuse-controls')
    expect(call.method).toBe('PATCH')
    expect(call.body).toEqual({
      suspension: { suspended: true, reasonCode: 'fraud' },
      entitlements: { enforceBillingStatus: true, allowedBillingStatuses: ['active'] },
      killSwitches: { toolIds: ['tool.a'] }
    })
  })

  it('updateAbuseControls forwards a null reasonCode to clear it', async () => {
    const fn = mockFetch({ data: { orgId: 'o1' } })
    await updateAbuseControls({ suspension: { suspended: false, reasonCode: null } })
    expect(lastCall(fn).body).toEqual({ suspension: { suspended: false, reasonCode: null } })
  })

  it('getEdgeSecurityPosture GETs the posture route and unwraps the envelope', async () => {
    const posture = { status: 'ready', orgId: 'o1' }
    const fn = mockFetch({ data: posture })
    const result = await getEdgeSecurityPosture()
    const call = lastCall(fn)
    expect(call.url).toBe('/api/v1/admin/edge-security/posture')
    expect(call.method).toBeUndefined()
    expect(result).toEqual(posture)
  })
})
