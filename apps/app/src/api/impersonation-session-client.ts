import { apiJson } from './http'
import type { Envelope } from './types'

export type ImpersonationSessionStatus = 'active' | 'expired' | 'revoked'

export interface ImpersonationSessionUserSummary {
  id: string
  orgId: string
  userId: string
  name: string
  scopes: string[]
  isAdmin: boolean
  expiresAt: string
  revokedAt?: string
  lastSeenAt?: string
  createdAt: string
}

export interface ImpersonationSession {
  session: ImpersonationSessionUserSummary
  status: ImpersonationSessionStatus
  adminUserId: string
  targetUserId: string
  approvalRequestId?: string
  requestedByUserId?: string
  ttlMinutes?: number
  ticketRef?: string
  reasonHash?: string
  reasonLength?: number
  createdAuditLogId: string
}

export async function listImpersonationSessions(): Promise<ImpersonationSession[]> {
  const response = await apiJson<Envelope<ImpersonationSession[]>>('/api/v1/admin/impersonation/sessions')
  return response.data
}

export async function revokeImpersonationSession(sessionId: string): Promise<ImpersonationSession> {
  const response = await apiJson<Envelope<ImpersonationSession>>(
    `/api/v1/admin/impersonation/sessions/${encodeURIComponent(sessionId)}/revoke`,
    { method: 'POST' }
  )
  return response.data
}
