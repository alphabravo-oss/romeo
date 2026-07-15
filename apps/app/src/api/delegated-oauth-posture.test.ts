import { afterEach, describe, expect, it, vi } from 'vitest'

import { getDelegatedOauthPosture } from './delegated-oauth-client'
import type { DelegatedOAuthPostureReport } from './delegated-oauth-types'

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

const postureReport: DelegatedOAuthPostureReport = {
  connectorTypes: [
    {
      connectorType: 'github',
      connectionCounts: {
        active: 1,
        expiredAccessToken: 0,
        expiringAccessToken: 1,
        reauthorizationRequired: 1,
        revoked: 1,
        total: 3,
        unused: 1
      }
    }
  ],
  generatedAt: '2026-07-02T00:00:00.000Z',
  orgId: 'org_default',
  providers: [
    {
      authorizationHost: 'github.com',
      configured: true,
      connectorTypes: ['github'],
      connectionCounts: {
        active: 1,
        expiredAccessToken: 0,
        expiringAccessToken: 1,
        reauthorizationRequired: 1,
        revoked: 1,
        total: 3,
        unused: 1
      },
      defaultScopeCount: 2,
      displayName: 'GitHub',
      id: 'github',
      pkceRequired: true,
      tokenHost: 'github.com'
    }
  ],
  redaction: {
    rawAccessTokensReturned: false,
    rawClientSecretsReturned: false,
    rawProviderAccountIdsReturned: false,
    rawProviderAccountLoginsReturned: false,
    rawProviderUrlsReturned: false,
    rawRefreshTokensReturned: false
  },
  schema: 'romeo.delegated-oauth-posture.v1',
  status: 'attention_required',
  warnings: [
    'delegated_oauth_access_token_expiring:github',
    'delegated_oauth_reauthorization_required:github',
    'delegated_oauth_revoked_connections_present:github'
  ]
}

describe('delegated-oauth-client — admin posture oversight', () => {
  it('getDelegatedOauthPosture GETs the admin posture route', async () => {
    const fn = mockFetch({ data: postureReport })
    await getDelegatedOauthPosture()
    const call = lastCall(fn)
    expect(call.url).toBe('/api/v1/admin/delegated-oauth/posture')
    expect(call.method).toBeUndefined()
  })

  it('getDelegatedOauthPosture unwraps the envelope data', async () => {
    const fn = mockFetch({ data: postureReport })
    const report = await getDelegatedOauthPosture()
    expect(fn).toHaveBeenCalledOnce()
    expect(report.schema).toBe('romeo.delegated-oauth-posture.v1')
    expect(report.status).toBe('attention_required')
    expect(report.providers[0]?.connectionCounts.total).toBe(3)
    expect(report.warnings).toHaveLength(3)
  })
})
