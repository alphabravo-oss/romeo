import { apiJson } from './http'
import type { Envelope } from './types'
import type { LocalAuthStatus, TotpEnrollment } from './auth-types'

export async function getLocalAuthStatus(): Promise<LocalAuthStatus> {
  const response = await apiJson<Envelope<LocalAuthStatus>>('/api/v1/auth/local/status')
  return response.data
}

export async function setLocalPassword(input: {
  newPassword: string
  currentPassword?: string
}): Promise<LocalAuthStatus> {
  const response = await apiJson<Envelope<LocalAuthStatus>>('/api/v1/auth/local/password', {
    method: 'POST',
    body: JSON.stringify(input)
  })
  return response.data
}

export async function startTotpEnrollment(input: { name?: string } = {}): Promise<TotpEnrollment> {
  const response = await apiJson<Envelope<TotpEnrollment>>('/api/v1/auth/local/mfa/totp/enroll', {
    method: 'POST',
    body: JSON.stringify(input)
  })
  return response.data
}

export async function confirmTotpEnrollment(input: {
  factorId: string
  code: string
}): Promise<LocalAuthStatus> {
  const response = await apiJson<Envelope<LocalAuthStatus>>('/api/v1/auth/local/mfa/totp/confirm', {
    method: 'POST',
    body: JSON.stringify(input)
  })
  return response.data
}

export async function disableTotpFactor(input: {
  factorId: string
  code?: string
}): Promise<LocalAuthStatus> {
  const { factorId, code } = input
  const response = await apiJson<Envelope<LocalAuthStatus>>(
    `/api/v1/auth/local/mfa/factors/${encodeURIComponent(factorId)}/disable`,
    { method: 'POST', body: JSON.stringify(code === undefined ? {} : { code }) }
  )
  return response.data
}
