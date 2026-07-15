export type ImpersonationRequestStatus = 'pending' | 'approved' | 'rejected'

export interface ImpersonationRequest {
  id: string
  status: ImpersonationRequestStatus
  requestedByUserId: string
  targetUserId: string
  ttlMinutes: number
  createdAt: string
  approvedAt?: string
  approvedByUserId?: string
  rejectedAt?: string
  rejectedByUserId?: string
  sessionId?: string
  ticketRef?: string
  reasonHash?: string
  reasonLength?: number
}
