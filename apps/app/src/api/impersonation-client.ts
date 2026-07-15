import { apiJson } from './http'
import type { Envelope } from './types'
import type { ImpersonationRequest } from './impersonation-types'

export async function listImpersonationRequests(): Promise<ImpersonationRequest[]> {
  const response = await apiJson<Envelope<ImpersonationRequest[]>>('/api/v1/admin/impersonation/requests')
  return response.data
}

export async function approveImpersonationRequest(requestId: string): Promise<ImpersonationRequest> {
  const response = await apiJson<Envelope<ImpersonationRequest>>(
    `/api/v1/admin/impersonation/requests/${encodeURIComponent(requestId)}/approve`,
    { method: 'POST' }
  )
  return response.data
}

export async function rejectImpersonationRequest(requestId: string): Promise<ImpersonationRequest> {
  const response = await apiJson<Envelope<ImpersonationRequest>>(
    `/api/v1/admin/impersonation/requests/${encodeURIComponent(requestId)}/reject`,
    { method: 'POST' }
  )
  return response.data
}
