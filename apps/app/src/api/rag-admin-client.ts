import { apiJson } from './http'
import type { Envelope } from './types'
import type {
  CompareTieredKnowledgeReplayRequest,
  CreateRagPolicyChangeRequestInput,
  KnowledgeRetrievalReplayComparisonReport,
  KnowledgeRetrievalReplayReport,
  RagPolicyChangeRequest,
  RagPolicyReport,
  RagPostureReport,
  ReplayTieredKnowledgeRequest,
  ReviewRagPolicyChangeRequestInput,
  UpdateRagPolicyRequest
} from './rag-admin-types'

export async function getRagPolicy(): Promise<RagPolicyReport> {
  const response = await apiJson<Envelope<RagPolicyReport>>('/api/v1/admin/rag/policy')
  return response.data
}

export async function updateRagPolicy(input: UpdateRagPolicyRequest): Promise<RagPolicyReport> {
  const response = await apiJson<Envelope<RagPolicyReport>>('/api/v1/admin/rag/policy', {
    method: 'PATCH',
    body: JSON.stringify(input)
  })
  return response.data
}

export async function getRagPosture(): Promise<RagPostureReport> {
  const response = await apiJson<Envelope<RagPostureReport>>('/api/v1/admin/rag/posture')
  return response.data
}

/** Current pending/last change request, or `null` when none exists. */
export async function getRagPolicyChangeRequest(): Promise<RagPolicyChangeRequest | null> {
  const response = await apiJson<Envelope<RagPolicyChangeRequest | null>>(
    '/api/v1/admin/rag/policy/change-request'
  )
  return response.data
}

export async function createRagPolicyChangeRequest(
  input: CreateRagPolicyChangeRequestInput
): Promise<RagPolicyChangeRequest> {
  const response = await apiJson<Envelope<RagPolicyChangeRequest>>(
    '/api/v1/admin/rag/policy/change-requests',
    {
      method: 'POST',
      body: JSON.stringify(input)
    }
  )
  return response.data
}

export async function approveRagPolicyChangeRequest(
  requestId: string,
  input: ReviewRagPolicyChangeRequestInput
): Promise<RagPolicyChangeRequest> {
  const response = await apiJson<Envelope<RagPolicyChangeRequest>>(
    `/api/v1/admin/rag/policy/change-requests/${encodeURIComponent(requestId)}/approve`,
    {
      method: 'POST',
      body: JSON.stringify(input)
    }
  )
  return response.data
}

export async function rejectRagPolicyChangeRequest(
  requestId: string,
  input: ReviewRagPolicyChangeRequestInput
): Promise<RagPolicyChangeRequest> {
  const response = await apiJson<Envelope<RagPolicyChangeRequest>>(
    `/api/v1/admin/rag/policy/change-requests/${encodeURIComponent(requestId)}/reject`,
    {
      method: 'POST',
      body: JSON.stringify(input)
    }
  )
  return response.data
}

export async function replayRag(
  input: ReplayTieredKnowledgeRequest
): Promise<KnowledgeRetrievalReplayReport> {
  const response = await apiJson<Envelope<KnowledgeRetrievalReplayReport>>('/api/v1/admin/rag/replay', {
    method: 'POST',
    body: JSON.stringify(input)
  })
  return response.data
}

export async function compareRagReplay(
  input: CompareTieredKnowledgeReplayRequest
): Promise<KnowledgeRetrievalReplayComparisonReport> {
  const response = await apiJson<Envelope<KnowledgeRetrievalReplayComparisonReport>>(
    '/api/v1/admin/rag/replay/compare',
    {
      method: 'POST',
      body: JSON.stringify(input)
    }
  )
  return response.data
}
