import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  confirmTotpEnrollment,
  disableTotpFactor,
  setLocalPassword,
  startTotpEnrollment
} from './auth-client'
import {
  createManagedSecret,
  getAuthProviderCatalog,
  getAuthProviderSettings,
  testAuthProviderConnection,
  updateAuthProviderSettings
} from './auth-provider-client'
import { updateMyProfile } from './bootstrap-client'
import { disableUser, setUserPassword, updateUserRole } from './users-client'

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

describe('users-client — admin user modification', () => {
  it('updateUserRole PATCHes the role route and sets the confirmUserId guard', async () => {
    const fn = mockFetch({ data: { id: 'u1', role: 'org_admin' } })
    await updateUserRole({ userId: 'u1', role: 'org_admin' })
    const call = lastCall(fn)
    expect(call.url).toBe('/api/v1/users/u1/role')
    expect(call.method).toBe('PATCH')
    expect(call.body).toEqual({ confirmUserId: 'u1', role: 'org_admin' })
  })

  it('setUserPassword POSTs local-password with the confirmUserId guard', async () => {
    const fn = mockFetch({ data: {} })
    await setUserPassword({ userId: 'u2', newPassword: 'correcthorsebattery' })
    const call = lastCall(fn)
    expect(call.url).toBe('/api/v1/users/u2/local-password')
    expect(call.method).toBe('POST')
    expect(call.body).toEqual({ confirmUserId: 'u2', newPassword: 'correcthorsebattery' })
  })

  it('disableUser POSTs the disable route', async () => {
    const fn = mockFetch({ data: { id: 'u3' } })
    await disableUser('u3')
    expect(lastCall(fn).url).toBe('/api/v1/users/u3/disable')
    expect(lastCall(fn).method).toBe('POST')
  })
})

describe('auth-client — local password + MFA', () => {
  it('setLocalPassword posts to /auth/local/password', async () => {
    const fn = mockFetch({ data: {} })
    await setLocalPassword({ newPassword: 'correcthorsebattery' })
    expect(lastCall(fn).url).toBe('/api/v1/auth/local/password')
    expect(lastCall(fn).body).toEqual({ newPassword: 'correcthorsebattery' })
  })

  it('startTotpEnrollment posts to the enroll route', async () => {
    const fn = mockFetch({ data: { factor: {}, otpauthUri: 'otpauth://x', secret: 'ABC' } })
    await startTotpEnrollment({})
    expect(lastCall(fn).url).toBe('/api/v1/auth/local/mfa/totp/enroll')
    expect(lastCall(fn).method).toBe('POST')
  })

  it('confirmTotpEnrollment posts factorId + code', async () => {
    const fn = mockFetch({ data: {} })
    await confirmTotpEnrollment({ factorId: 'f1', code: '123456' })
    expect(lastCall(fn).url).toBe('/api/v1/auth/local/mfa/totp/confirm')
    expect(lastCall(fn).body).toEqual({ factorId: 'f1', code: '123456' })
  })

  it('disableTotpFactor posts to the factor disable route (id url-encoded)', async () => {
    const fn = mockFetch({ data: {} })
    await disableTotpFactor({ factorId: 'f 2' })
    expect(lastCall(fn).url).toBe('/api/v1/auth/local/mfa/factors/f%202/disable')
  })
})

describe('bootstrap-client — self profile', () => {
  it('updateMyProfile PATCHes /me with the provided fields', async () => {
    const fn = mockFetch({ data: {} })
    await updateMyProfile({ name: 'New Name', email: 'a@b.com' })
    const call = lastCall(fn)
    expect(call.url).toBe('/api/v1/me')
    expect(call.method).toBe('PATCH')
    expect(call.body).toEqual({ name: 'New Name', email: 'a@b.com' })
  })
})

describe('auth-provider-client — SSO app store', () => {
  it('getAuthProviderCatalog GETs the catalog', async () => {
    const fn = mockFetch({ data: [] })
    await getAuthProviderCatalog()
    expect(lastCall(fn).url).toBe('/api/v1/admin/auth-providers/catalog')
  })

  it('getAuthProviderSettings GETs the settings', async () => {
    const fn = mockFetch({ data: { global: { providers: [] }, orgOverride: { orgId: 'o', providers: [] }, effective: { orgId: 'o', providers: [] }, notes: [] } })
    await getAuthProviderSettings()
    expect(lastCall(fn).url).toBe('/api/v1/admin/auth-providers/settings')
  })

  it('updateAuthProviderSettings PATCHes settings with the scope envelope', async () => {
    const fn = mockFetch({ data: {} })
    await updateAuthProviderSettings({ global: { providers: [{ providerId: 'okta', enabled: true }] } })
    const call = lastCall(fn)
    expect(call.url).toBe('/api/v1/admin/auth-providers/settings')
    expect(call.method).toBe('PATCH')
    expect(call.body).toEqual({ global: { providers: [{ providerId: 'okta', enabled: true }] } })
  })

  it('testAuthProviderConnection POSTs to the test route', async () => {
    const fn = mockFetch({ data: { status: 'passed', checks: [] } })
    await testAuthProviderConnection({ providerId: 'okta' })
    expect(lastCall(fn).url).toBe('/api/v1/admin/auth-providers/settings/test')
    expect(lastCall(fn).method).toBe('POST')
  })

  it('createManagedSecret POSTs to /admin/secrets and returns the ref', async () => {
    const fn = mockFetch({ data: { secretRef: 'romeo-secret://abc' } })
    const ref = await createManagedSecret({ purpose: 'auth_provider_client_secret', value: 'shh', scope: 'global' })
    expect(lastCall(fn).url).toBe('/api/v1/admin/secrets')
    expect(lastCall(fn).method).toBe('POST')
    expect(ref.secretRef).toBe('romeo-secret://abc')
  })
})
