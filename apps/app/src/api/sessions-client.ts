import { apiJson } from './http'
import type { Envelope } from './types'
import type { Session } from './sessions-types'

export async function listSessions(): Promise<Session[]> {
  const response = await apiJson<Envelope<Session[]>>('/api/v1/sessions')
  return response.data
}

export async function revokeCurrentSession(): Promise<Session> {
  const response = await apiJson<Envelope<Session>>('/api/v1/sessions/current', {
    method: 'DELETE'
  })
  return response.data
}

export async function revokeSession(sessionId: string): Promise<Session> {
  const response = await apiJson<Envelope<Session>>(`/api/v1/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE'
  })
  return response.data
}

export async function revokeOtherSessions(): Promise<Session[]> {
  const response = await apiJson<Envelope<Session[]>>('/api/v1/sessions/revoke-others', {
    method: 'POST'
  })
  return response.data
}
