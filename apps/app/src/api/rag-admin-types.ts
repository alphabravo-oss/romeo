/**
 * Types for the admin RAG governance surface. Mirrors the backend zod schemas
 * and domain interfaces EXACTLY:
 *   - packages/core/src/domain/rag-policy.ts
 *   - packages/core/src/http/schemas.ts (updateRagPolicySchema, createRagPolicyChangeRequestSchema, reviewRagPolicyChangeRequestSchema, replayTieredKnowledgeSchema, compareTieredKnowledgeReplaySchema)
 *   - packages/core/src/services/rag-posture-service.ts (RagPostureReport)
 *   - packages/core/src/services/knowledge-service.ts (replay reports)
 *   - packages/core/src/services/knowledge-retrieval-route.ts (route modes / fallback reasons)
 * Do not invent fields — the panel derives every stat from these shapes.
 */

// ── Enum tuples (mirror domain/rag-policy.ts) ─────────────────────────────────

export const ragPolicyTiers = ['user_private', 'workspace', 'org', 'shared'] as const
export type RagPolicyTier = (typeof ragPolicyTiers)[number]

export const ragVectorIsolationPolicies = ['knowledge_base', 'none', 'org', 'workspace'] as const
export type RagVectorIsolationPolicy = (typeof ragVectorIsolationPolicies)[number]

export const ragPolicyExternalVectorModes = ['deployment_managed', 'disabled'] as const
export type RagPolicyExternalVectorMode = (typeof ragPolicyExternalVectorModes)[number]

export const ragPolicyExternalVectorDrStrategies = ['postgres_authoritative_reindex'] as const
export type RagPolicyExternalVectorDrStrategy = (typeof ragPolicyExternalVectorDrStrategies)[number]

export const ragPolicyExternalVectorExportPolicies = ['metadata_only'] as const
export type RagPolicyExternalVectorExportPolicy = (typeof ragPolicyExternalVectorExportPolicies)[number]

export const ragPolicyPhysicalVectorIsolationModes = [
  'dedicated_vector_store_per_org',
  'external_collection_per_org',
  'external_namespace_per_org',
  'pgvector_partitioned_by_org',
  'shared_row_scope'
] as const
export type RagPolicyPhysicalVectorIsolationMode = (typeof ragPolicyPhysicalVectorIsolationModes)[number]

export const ragPolicyPhysicalVectorIsolationEnforcements = ['advisory', 'required'] as const
export type RagPolicyPhysicalVectorIsolationEnforcement =
  (typeof ragPolicyPhysicalVectorIsolationEnforcements)[number]

export const ragPolicyChangeJustificationCodes = [
  'compliance_update',
  'incident_response',
  'manual_risk_reduction',
  'retrieval_replay_improvement'
] as const
export type RagPolicyChangeJustificationCode = (typeof ragPolicyChangeJustificationCodes)[number]

export const ragPolicyChangeRejectReasonCodes = [
  'insufficient_evidence',
  'policy_conflict',
  'superseded',
  'unsafe_defaults'
] as const
export type RagPolicyChangeRejectReasonCode = (typeof ragPolicyChangeRejectReasonCodes)[number]

export type RagPolicyChangeRequestStatus = 'approved' | 'pending' | 'rejected'

// ── Policy report (GET /admin/rag/policy) ─────────────────────────────────────

export type RagPolicyBudgetMap = Record<RagPolicyTier, number>

export interface RagPolicyProviderModel {
  providerId: string
  model: string
}

export interface RagPolicyKnowledgeBaseTierAssignments {
  org: string[]
  shared: string[]
}

export interface RagPolicyExternalVectorStore {
  mode: RagPolicyExternalVectorMode
  namespacePolicy: RagVectorIsolationPolicy
  partitioningPolicy: RagVectorIsolationPolicy
  configured: boolean
  drStrategy: RagPolicyExternalVectorDrStrategy
  exportPolicy: RagPolicyExternalVectorExportPolicy
  restoreValidation: 'not_required' | 'required_when_enabled'
}

export interface RagPolicyPhysicalVectorIsolation {
  mode: RagPolicyPhysicalVectorIsolationMode
  enforcement: RagPolicyPhysicalVectorIsolationEnforcement
  configured: boolean
  postgresAuthoritative: true
  liveEvidenceRequired: boolean
}

export interface RagPolicyReport {
  orgId: string
  source: 'default' | 'org'
  enabledTiers: RagPolicyTier[]
  defaultMaxResultsPerTier: RagPolicyBudgetMap
  maxResultsPerTier: RagPolicyBudgetMap
  allowedEmbeddingProviderModels: RagPolicyProviderModel[]
  knowledgeBaseTierAssignments: RagPolicyKnowledgeBaseTierAssignments
  dataResidencyTags: string[]
  externalVectorStore: RagPolicyExternalVectorStore
  physicalVectorIsolation: RagPolicyPhysicalVectorIsolation
  retention: {
    deleteVectorsOnSourceDelete: true
    exportIncludesEmbeddingVectors: false
  }
  enforcement: {
    tierBudgets: 'enforced'
    embeddingProviderModelAllowlist: 'enforced' | 'unrestricted'
  }
  updatedAt?: string
  updatedBy?: string
}

// ── Policy update request (PATCH /admin/rag/policy) ───────────────────────────

export interface UpdateRagPolicyExternalVectorStoreRequest {
  mode?: RagPolicyExternalVectorMode
  namespacePolicy?: RagVectorIsolationPolicy
  partitioningPolicy?: RagVectorIsolationPolicy
  drStrategy?: RagPolicyExternalVectorDrStrategy
  exportPolicy?: RagPolicyExternalVectorExportPolicy
}

export interface UpdateRagPolicyPhysicalVectorIsolationRequest {
  mode?: RagPolicyPhysicalVectorIsolationMode
  enforcement?: RagPolicyPhysicalVectorIsolationEnforcement
}

export interface UpdateRagPolicyRequest {
  enabledTiers?: RagPolicyTier[]
  defaultMaxResultsPerTier?: Partial<RagPolicyBudgetMap>
  maxResultsPerTier?: Partial<RagPolicyBudgetMap>
  allowedEmbeddingProviderModels?: RagPolicyProviderModel[]
  knowledgeBaseTierAssignments?: Partial<RagPolicyKnowledgeBaseTierAssignments>
  dataResidencyTags?: string[]
  externalVectorStore?: UpdateRagPolicyExternalVectorStoreRequest
  physicalVectorIsolation?: UpdateRagPolicyPhysicalVectorIsolationRequest
}

// ── Change requests (POST/GET .../change-request(s)) ──────────────────────────

export interface RagPolicyChangeEvidenceSummary {
  replayCaseCount?: number
  averagePrecision?: number
  averageRecall?: number
  averageLatencyMs?: number
  beforeAfterComparisonAttached?: boolean
}

export interface RagPolicyChangeRequest {
  schema: 'romeo.rag-policy-change-request.v1'
  orgId: string
  requestId: string
  status: RagPolicyChangeRequestStatus
  requestedBy: string
  requestedAt: string
  reviewedBy?: string
  reviewedAt?: string
  rejectReasonCode?: RagPolicyChangeRejectReasonCode
  justificationCode?: RagPolicyChangeJustificationCode
  evidenceSummary?: RagPolicyChangeEvidenceSummary
  changedFields: string[]
  policyPatch: UpdateRagPolicyRequest
  before: RagPolicyReport
  proposed: RagPolicyReport
  applied?: RagPolicyReport
  redaction: {
    rawQueriesReturned: false
    rawCorpusReturned: false
    rawChunkTextReturned: false
    rawVectorValuesReturned: false
    secretRefsReturned: false
  }
}

export interface CreateRagPolicyChangeRequestInput {
  policy: UpdateRagPolicyRequest
  justificationCode?: RagPolicyChangeJustificationCode
  evidenceSummary?: RagPolicyChangeEvidenceSummary
}

export interface ReviewRagPolicyChangeRequestInput {
  confirmRequestId: string
  reasonCode?: RagPolicyChangeRejectReasonCode
}

// ── Posture report (GET /admin/rag/posture) ───────────────────────────────────

export type RagPostureStatus = 'degraded' | 'ready'

export interface RagPostureWarning {
  code:
    | 'failed_knowledge_jobs'
    | 'failed_knowledge_sources'
    | 'lexical_fallback_active'
    | 'physical_vector_isolation_evidence_pending'
    | 'physical_vector_isolation_mismatch'
    | 'stale_embedding_records'
    | 'stale_source_chunk_counts'
  count: number
  severity: 'info' | 'warning'
}

export interface RagPostureReport {
  generatedAt: string
  orgId: string
  status: RagPostureStatus
  vector: {
    driver: 'none' | 'pgvector' | 'qdrant'
    authoritativeStore: 'postgres'
    isolationMode: RagPolicyPhysicalVectorIsolationMode
    pgvectorConfigured: boolean
    externalVectorStoreConfigured: boolean
    qdrantConfigured: boolean
    namespaceConfigured: boolean
    partitioningConfigured: boolean
    postureSource: 'deployment_default'
    physicalIsolation: {
      policy: RagPolicyPhysicalVectorIsolation
      deploymentMode: RagPolicyPhysicalVectorIsolationMode
      deploymentMatched: boolean
      status: 'deployment_mismatch' | 'evidence_pending' | 'satisfied'
    }
  }
  corpus: {
    workspaceCount: number
    knowledgeBaseCount: number
    sourceCount: number
    indexedSourceCount: number
    pendingSourceCount: number
    failedSourceCount: number
    chunkCount: number
    embeddingCount: number
    embeddedChunkCount: number
    chunksMissingProviderEmbeddingCount: number
    staleEmbeddingRecordCount: number
    staleSourceCount: number
    providerModelIndexCount: number
  }
  jobs: {
    failedEmbeddingIndexJobCount: number
    failedExtractionJobCount: number
    failedReindexJobCount: number
    queuedKnowledgeJobCount: number
    runningKnowledgeJobCount: number
  }
  fallback: {
    lexicalFallbackAvailable: boolean
    degraded: boolean
    reasonCodes: Array<
      'no_provider_embeddings' | 'partial_provider_embedding_coverage' | 'shared_pgvector_default'
    >
  }
  readiness: {
    warnings: RagPostureWarning[]
  }
}

// ── Replay (POST /admin/rag/replay and /replay/compare) ───────────────────────

export type KnowledgeRetrievalRouteMode =
  | 'external_vector'
  | 'legacy_rag_provider'
  | 'lexical_fallback'
  | 'pgvector'

export type KnowledgeRetrievalRouteFallbackReason =
  | 'embedding_provider_unavailable'
  | 'embedding_provider_use_grant_missing'
  | 'external_vector_search_failed'
  | 'missing_model_scope'
  | 'no_allowed_embedding_index'
  | 'no_authorized_vector_hits'
  | 'no_visible_chunks'

export type RagReplayTierBudget = Partial<Record<RagPolicyTier, number>>

export interface RagReplayCaseInput {
  id?: string
  knowledgeBaseIds: string[]
  query: string
  expectedChunkIds?: string[]
  maxResultsPerTier?: RagReplayTierBudget
}

export interface ReplayTieredKnowledgeRequest {
  cases: RagReplayCaseInput[]
}

export interface CompareTieredKnowledgeReplayRequest {
  baseline: RagReplayCaseInput[]
  candidate: RagReplayCaseInput[]
}

export interface KnowledgeRetrievalReplayCaseResult {
  authorizedKnowledgeBaseCount: number
  caseId?: string
  expectedChunkCount: number
  fallbackReasons: Partial<Record<KnowledgeRetrievalRouteFallbackReason, number>>
  hitCount: number
  latencyMs: number
  matchedExpectedChunkCount: number
  precision: number | null
  recall: number | null
  retrievalRouteModes: Record<KnowledgeRetrievalRouteMode, number>
  skippedKnowledgeBaseCount: number
  status: 'failed' | 'observed' | 'passed'
}

export interface KnowledgeRetrievalReplayMetrics {
  averageLatencyMs: number
  averagePrecision: number | null
  averageRecall: number | null
  expectedChunkCount: number
  hitCount: number
  matchedExpectedChunkCount: number
}

export interface KnowledgeRetrievalReplayReport {
  caseCount: number
  cases: KnowledgeRetrievalReplayCaseResult[]
  generatedAt: string
  metrics: KnowledgeRetrievalReplayMetrics
  orgId: string
  redaction: {
    rawQueriesReturned: false
    rawChunkTextReturned: false
    rawExpectedChunkIdsReturned: false
    rawHitIdsReturned: false
    vectorValuesReturned: false
  }
  status: 'failed' | 'observed' | 'passed'
}

export interface KnowledgeRetrievalReplayComparisonReport {
  baseline: KnowledgeRetrievalReplayReport
  candidate: KnowledgeRetrievalReplayReport
  deltas: KnowledgeRetrievalReplayMetrics
  generatedAt: string
  orgId: string
  outcome: 'improved' | 'observed' | 'regressed' | 'unchanged'
  redaction: {
    rawQueriesReturned: false
    rawChunkTextReturned: false
    rawExpectedChunkIdsReturned: false
    rawHitIdsReturned: false
    vectorValuesReturned: false
  }
}
