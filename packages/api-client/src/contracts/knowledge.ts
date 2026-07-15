import type { BackgroundJob } from "./admin";

export interface KnowledgeBase {
  id: string;
  orgId: string;
  workspaceId: string;
  name: string;
  description?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeSource {
  id: string;
  knowledgeBaseId: string;
  orgId: string;
  workspaceId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: "failed" | "indexed" | "pending";
  objectKey?: string;
  metadata: Record<string, unknown>;
  chunkCount?: number;
  contentHash?: string;
  indexedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RetrievalHit {
  id: string;
  content: string;
  score: number;
  citation: {
    documentId: string;
    chunkId: string;
    title: string;
    sourceUri?: string;
  };
  metadata: Record<string, unknown>;
}

export type KnowledgeRetrievalTier =
  | "org"
  | "shared"
  | "user_private"
  | "workspace";

export type KnowledgeRetrievalPermissionReason =
  | "admin_override"
  | "direct_use_grant"
  | "group_use_grant"
  | "service_account_use_grant";

export type KnowledgeRetrievalRouteMode =
  | "external_vector"
  | "legacy_rag_provider"
  | "lexical_fallback"
  | "pgvector";

export type KnowledgeRetrievalRouteFallbackReason =
  | "embedding_provider_unavailable"
  | "embedding_provider_use_grant_missing"
  | "external_vector_search_failed"
  | "missing_model_scope"
  | "no_allowed_embedding_index"
  | "no_authorized_vector_hits"
  | "no_visible_chunks";

export interface KnowledgeRetrievalRoute {
  mode: KnowledgeRetrievalRouteMode;
  vectorStoreDriver: "none" | "pgvector" | "qdrant";
  externalVectorStoreAttempted: boolean;
  externalVectorStoreUsed: boolean;
  providerId?: string;
  embeddingModel?: string;
  embeddingDimensions?: number;
  fallbackReason?: KnowledgeRetrievalRouteFallbackReason;
}

export interface KnowledgeRetrievalPlanEntry {
  knowledgeBaseId: string;
  orgId: string;
  workspaceId: string;
  tier: KnowledgeRetrievalTier;
  permissionReason: KnowledgeRetrievalPermissionReason;
  maxResults: number;
  sourceFilter: {
    mode: "authorized_visible_sources";
    connectorOwnerFiltered: boolean;
  };
  retrievalRoute?: KnowledgeRetrievalRoute;
  vectorScope: {
    driver: "pgvector" | "qdrant";
    isolationMode:
      | "dedicated_vector_store_per_org"
      | "external_collection_per_org"
      | "external_namespace_per_org"
      | "pgvector_partitioned_by_org"
      | "shared_row_scope";
    orgId: string;
    workspaceId: string;
    knowledgeBaseId: string;
  };
}

export interface KnowledgeRetrievalPlan {
  entries: KnowledgeRetrievalPlanEntry[];
  posture: {
    vectorDriver: "pgvector" | "qdrant";
    isolationMode:
      | "dedicated_vector_store_per_org"
      | "external_collection_per_org"
      | "external_namespace_per_org"
      | "pgvector_partitioned_by_org"
      | "shared_row_scope";
    externalVectorStoreDriver: "disabled" | "qdrant";
    externalVectorStoreConfigured: boolean;
    externalVectorStoreRoutingActive: boolean;
    namespaceConfigured: boolean;
    namespacePolicy: "knowledge_base" | "none" | "org" | "workspace";
    partitioningConfigured: boolean;
    partitioningPolicy: "knowledge_base" | "none" | "org" | "workspace";
  };
  policy: {
    source: "default" | "org";
    enabledTiers: KnowledgeRetrievalTier[];
    defaultMaxResultsPerTier: Record<KnowledgeRetrievalTier, number>;
    maxResultsPerTier: Record<KnowledgeRetrievalTier, number>;
    knowledgeBaseTierAssignments: {
      org: string[];
      shared: string[];
    };
    externalVectorStoreMode: "deployment_managed" | "disabled";
  };
  requestedCount: number;
  authorizedCount: number;
  skipped: {
    count: number;
    reasons: Array<{
      reason:
        | "missing_use_grant"
        | "not_found"
        | "outside_organization"
        | "outside_workspace"
        | "tier_disabled_by_policy";
      count: number;
    }>;
  };
}

export interface TieredRetrievalHit extends RetrievalHit {
  knowledgeBaseId: string;
  orgId: string;
  workspaceId: string;
  tier: KnowledgeRetrievalTier;
  permissionReason: KnowledgeRetrievalPermissionReason;
  retrievalRoute: KnowledgeRetrievalRoute;
}

export interface TieredKnowledgeQueryResult {
  hits: TieredRetrievalHit[];
  plan: KnowledgeRetrievalPlan;
}

export interface AgentKnowledgeBinding {
  id: string;
  orgId: string;
  agentId: string;
  knowledgeBaseId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  knowledgeBase?: KnowledgeBase;
}

export interface PresignedUpload {
  key: string;
  url: string;
  method: "PUT";
  expiresAt: string;
  headers: Record<string, string>;
}

export interface KnowledgeUploadRegistration {
  source: KnowledgeSource;
  upload: PresignedUpload;
}

export interface KnowledgeExtractionJobResult {
  job: BackgroundJob;
  source: KnowledgeSource;
}

export interface KnowledgeEmbeddingIndexResult {
  job: BackgroundJob;
  embeddingCount: number;
  dimensions: number | null;
  providerId: string;
  model: string;
}

export interface CreateKnowledgeBaseInput {
  workspaceId: string;
  name: string;
  description?: string;
}

export interface UpdateKnowledgeBaseInput {
  name?: string;
  description?: string | null;
}

export interface CreateKnowledgeSourceInput {
  knowledgeBaseId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  content?: string;
}

export interface CreateKnowledgeUploadInput {
  knowledgeBaseId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface ReindexKnowledgeSourceInput {
  knowledgeBaseId: string;
  sourceId: string;
  content: string;
  sizeBytes?: number;
}

export interface QueryKnowledgeBaseInput {
  knowledgeBaseId: string;
  query: string;
  maxResults?: number;
}

export interface QueryTieredKnowledgeInput {
  knowledgeBaseIds: string[];
  query: string;
  maxResultsPerTier?: Partial<Record<KnowledgeRetrievalTier, number>>;
}

export interface ReplayTieredKnowledgeInput {
  cases: Array<{
    id?: string;
    knowledgeBaseIds: string[];
    query: string;
    expectedChunkIds?: string[];
    maxResultsPerTier?: Partial<Record<KnowledgeRetrievalTier, number>>;
  }>;
}

export interface CompareTieredKnowledgeReplayInput {
  baseline: ReplayTieredKnowledgeInput["cases"];
  candidate: ReplayTieredKnowledgeInput["cases"];
}

export interface KnowledgeRetrievalReplayCaseResult {
  authorizedKnowledgeBaseCount: number;
  caseId?: string;
  expectedChunkCount: number;
  fallbackReasons: Partial<
    Record<KnowledgeRetrievalRouteFallbackReason, number>
  >;
  hitCount: number;
  latencyMs: number;
  matchedExpectedChunkCount: number;
  precision: number | null;
  recall: number | null;
  retrievalRouteModes: Record<KnowledgeRetrievalRouteMode, number>;
  skippedKnowledgeBaseCount: number;
  status: "failed" | "observed" | "passed";
}

export interface KnowledgeRetrievalReplayReport {
  caseCount: number;
  cases: KnowledgeRetrievalReplayCaseResult[];
  generatedAt: string;
  metrics: {
    averageLatencyMs: number;
    averagePrecision: number | null;
    averageRecall: number | null;
    expectedChunkCount: number;
    hitCount: number;
    matchedExpectedChunkCount: number;
  };
  orgId: string;
  redaction: {
    rawQueriesReturned: false;
    rawChunkTextReturned: false;
    rawExpectedChunkIdsReturned: false;
    rawHitIdsReturned: false;
    vectorValuesReturned: false;
  };
  status: "failed" | "observed" | "passed";
}

export interface KnowledgeRetrievalReplayComparisonReport {
  baseline: KnowledgeRetrievalReplayReport;
  candidate: KnowledgeRetrievalReplayReport;
  deltas: {
    averageLatencyMs: number;
    averagePrecision: number | null;
    averageRecall: number | null;
    expectedChunkCount: number;
    hitCount: number;
    matchedExpectedChunkCount: number;
  };
  generatedAt: string;
  orgId: string;
  outcome: "improved" | "observed" | "regressed" | "unchanged";
  redaction: {
    rawQueriesReturned: false;
    rawChunkTextReturned: false;
    rawExpectedChunkIdsReturned: false;
    rawHitIdsReturned: false;
    vectorValuesReturned: false;
  };
}

export interface IndexKnowledgeEmbeddingsInput {
  knowledgeBaseId: string;
  providerId: string;
  model: string;
  batchSize?: number;
}

export interface UpdateAgentKnowledgeBindingInput {
  enabled: boolean;
}
