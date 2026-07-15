import { apiJson } from './http'
import type { Envelope } from './types'
import type {
  DelegatedOAuthConnectionSummary,
  DelegatedOAuthPostureReport,
  DelegatedOAuthProvider,
  DelegatedOAuthStartResult,
  StartDelegatedOAuthInput
} from './delegated-oauth-types'

export async function listDelegatedOAuthProviders(): Promise<DelegatedOAuthProvider[]> {
  const response = await apiJson<Envelope<DelegatedOAuthProvider[]>>('/api/v1/delegated-oauth/providers')
  return response.data
}

export async function listDelegatedOAuthConnections(workspaceId?: string): Promise<DelegatedOAuthConnectionSummary[]> {
  const query = workspaceId !== undefined ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''
  const response = await apiJson<Envelope<DelegatedOAuthConnectionSummary[]>>(`/api/v1/delegated-oauth/connections${query}`)
  return response.data
}

export async function startDelegatedOAuth(input: StartDelegatedOAuthInput): Promise<DelegatedOAuthStartResult> {
  const response = await apiJson<Envelope<DelegatedOAuthStartResult>>('/api/v1/delegated-oauth/start', {
    method: 'POST',
    body: JSON.stringify(input)
  })
  return response.data
}

export async function getDelegatedOauthPosture(): Promise<DelegatedOAuthPostureReport> {
  const response = await apiJson<Envelope<DelegatedOAuthPostureReport>>('/api/v1/admin/delegated-oauth/posture')
  return response.data
}

export async function revokeDelegatedOAuthConnection(connectionId: string): Promise<DelegatedOAuthConnectionSummary> {
  const response = await apiJson<Envelope<DelegatedOAuthConnectionSummary>>(
    `/api/v1/delegated-oauth/connections/${encodeURIComponent(connectionId)}/revoke`,
    { method: 'POST' }
  )
  return response.data
}
