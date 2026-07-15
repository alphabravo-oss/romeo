import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  deprovisionSsoOidcUser,
  triggerDirectorySync
} from './auth-provider-client'

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

describe('auth-provider-client — admin auth actions', () => {
  it('triggerDirectorySync POSTs the directory-sync route with the sent fields', async () => {
    const fn = mockFetch({ data: { schema: 'romeo.directory-sync.v1', mode: 'preview' } })
    await triggerDirectorySync({ source: 'scim', dryRun: true })
    const call = lastCall(fn)
    expect(call.url).toBe('/api/v1/admin/directory-sync')
    expect(call.method).toBe('POST')
    expect(call.body).toEqual({ source: 'scim', dryRun: true })
  })

  it('deprovisionSsoOidcUser POSTs the oidc deprovision route with subject + confirmation', async () => {
    const fn = mockFetch({ data: { status: 'disabled', user: { id: 'u1' } } })
    await deprovisionSsoOidcUser({ oidcSubject: 'subject-123', confirmOidcSubject: 'subject-123' })
    const call = lastCall(fn)
    expect(call.url).toBe('/api/v1/admin/sso/oidc/deprovision')
    expect(call.method).toBe('POST')
    expect(call.body).toEqual({ oidcSubject: 'subject-123', confirmOidcSubject: 'subject-123' })
  })

  it('deprovisionSsoOidcUser forwards an explicit issuerUrl when provided', async () => {
    const fn = mockFetch({ data: { status: 'already_disabled', user: { id: 'u1' } } })
    await deprovisionSsoOidcUser({
      oidcSubject: 'sub',
      confirmOidcSubject: 'sub',
      issuerUrl: 'https://idp.example.com'
    })
    expect(lastCall(fn).body).toEqual({
      oidcSubject: 'sub',
      confirmOidcSubject: 'sub',
      issuerUrl: 'https://idp.example.com'
    })
  })
})
