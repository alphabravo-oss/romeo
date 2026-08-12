export const ragPolicyTiers = [
  "user_private",
  "workspace",
  "org",
  "shared",
] as const;

export type RagPolicyTier = (typeof ragPolicyTiers)[number];

export type RagPolicyBudgetMap = Record<RagPolicyTier, number>;

export const ragVectorIsolationPolicies = [
  "knowledge_base",
  "none",
  "org",
  "workspace",
] as const;

export type RagVectorIsolationPolicy =
  (typeof ragVectorIsolationPolicies)[number];

export const ragPolicyExternalVectorModes = [
  "deployment_managed",
  "disabled",
] as const;

export type RagPolicyExternalVectorMode =
  (typeof ragPolicyExternalVectorModes)[number];

export const ragPolicyExternalVectorDrStrategies = [
  "postgres_authoritative_reindex",
] as const;

export type RagPolicyExternalVectorDrStrategy =
  (typeof ragPolicyExternalVectorDrStrategies)[number];

export const ragPolicyExternalVectorExportPolicies = ["metadata_only"] as const;

export type RagPolicyExternalVectorExportPolicy =
  (typeof ragPolicyExternalVectorExportPolicies)[number];

export const ragPolicyPhysicalVectorIsolationModes = [
  "dedicated_vector_store_per_org",
  "external_collection_per_org",
  "external_namespace_per_org",
  "pgvector_partitioned_by_org",
  "shared_row_scope",
] as const;

export type RagPolicyPhysicalVectorIsolationMode =
  (typeof ragPolicyPhysicalVectorIsolationModes)[number];

export const ragPolicyPhysicalVectorIsolationEnforcements = [
  "advisory",
  "required",
] as const;

export type RagPolicyPhysicalVectorIsolationEnforcement =
  (typeof ragPolicyPhysicalVectorIsolationEnforcements)[number];

export interface RagPolicyProviderModel {
  providerId: string;
  model: string;
}

export interface RagPolicyRetrievalSettings {
  /** Chunks kept after ranking. Shared across enabled tiers as the default budget. */
  topK: number;
  /** Minimum cosine similarity for a vector hit (0–1). */
  similarityThreshold: number;
  /** When true, merge lexical (BM25-style) hits with vector hits. */
  hybridSearch: boolean;
  /** Lexical share of hybrid rank fusion (0–1). Vector weight is the remainder. */
  hybridBm25Weight: number;
}

export const ragPolicyAgenticUserModes = ["optional", "required"] as const;

export type RagPolicyAgenticUserMode =
  (typeof ragPolicyAgenticUserModes)[number];

export interface RagPolicyAgenticSettings {
  /** When false, retrieval stays one-shot regardless of the user toggle. */
  enabled: boolean;
  /**
   * `optional` lets the member turn agentic retrieval on per turn.
   * `required` forces it for every knowledge-backed run.
   */
  userMode: RagPolicyAgenticUserMode;
}

export interface RagPolicyKnowledgeBaseTierAssignments {
  org: string[];
  shared: string[];
}

export interface RagPolicyExternalVectorStore {
  mode: RagPolicyExternalVectorMode;
  namespacePolicy: RagVectorIsolationPolicy;
  partitioningPolicy: RagVectorIsolationPolicy;
  configured: boolean;
  drStrategy: RagPolicyExternalVectorDrStrategy;
  exportPolicy: RagPolicyExternalVectorExportPolicy;
  restoreValidation: "not_required" | "required_when_enabled";
}

export interface RagPolicyPhysicalVectorIsolation {
  mode: RagPolicyPhysicalVectorIsolationMode;
  enforcement: RagPolicyPhysicalVectorIsolationEnforcement;
  configured: boolean;
  postgresAuthoritative: true;
  liveEvidenceRequired: boolean;
}

export interface RagPolicyReport {
  orgId: string;
  source: "default" | "org";
  enabledTiers: RagPolicyTier[];
  defaultMaxResultsPerTier: RagPolicyBudgetMap;
  maxResultsPerTier: RagPolicyBudgetMap;
  allowedEmbeddingProviderModels: RagPolicyProviderModel[];
  retrieval: RagPolicyRetrievalSettings;
  agentic: RagPolicyAgenticSettings;
  knowledgeBaseTierAssignments: RagPolicyKnowledgeBaseTierAssignments;
  dataResidencyTags: string[];
  externalVectorStore: RagPolicyExternalVectorStore;
  physicalVectorIsolation: RagPolicyPhysicalVectorIsolation;
  retention: {
    deleteVectorsOnSourceDelete: true;
    exportIncludesEmbeddingVectors: false;
  };
  enforcement: {
    tierBudgets: "enforced";
    embeddingProviderModelAllowlist: "enforced" | "unrestricted";
  };
  updatedAt?: string;
  updatedBy?: string;
}

export interface UpdateRagPolicyExternalVectorStoreRequest {
  mode?: RagPolicyExternalVectorMode;
  namespacePolicy?: RagVectorIsolationPolicy;
  partitioningPolicy?: RagVectorIsolationPolicy;
  drStrategy?: RagPolicyExternalVectorDrStrategy;
  exportPolicy?: RagPolicyExternalVectorExportPolicy;
}

export interface UpdateRagPolicyPhysicalVectorIsolationRequest {
  mode?: RagPolicyPhysicalVectorIsolationMode;
  enforcement?: RagPolicyPhysicalVectorIsolationEnforcement;
}

export interface UpdateRagPolicyRequest {
  enabledTiers?: RagPolicyTier[];
  defaultMaxResultsPerTier?: Partial<RagPolicyBudgetMap>;
  maxResultsPerTier?: Partial<RagPolicyBudgetMap>;
  allowedEmbeddingProviderModels?: RagPolicyProviderModel[];
  retrieval?: Partial<RagPolicyRetrievalSettings>;
  agentic?: Partial<RagPolicyAgenticSettings>;
  knowledgeBaseTierAssignments?: Partial<RagPolicyKnowledgeBaseTierAssignments>;
  dataResidencyTags?: string[];
  externalVectorStore?: UpdateRagPolicyExternalVectorStoreRequest;
  physicalVectorIsolation?: UpdateRagPolicyPhysicalVectorIsolationRequest;
}

export const ragPolicyChangeJustificationCodes = [
  "compliance_update",
  "incident_response",
  "manual_risk_reduction",
  "retrieval_replay_improvement",
] as const;

export type RagPolicyChangeJustificationCode =
  (typeof ragPolicyChangeJustificationCodes)[number];

export const ragPolicyChangeRejectReasonCodes = [
  "insufficient_evidence",
  "policy_conflict",
  "superseded",
  "unsafe_defaults",
] as const;

export type RagPolicyChangeRejectReasonCode =
  (typeof ragPolicyChangeRejectReasonCodes)[number];

export type RagPolicyChangeRequestStatus = "approved" | "pending" | "rejected";

export interface RagPolicyChangeEvidenceSummary {
  replayCaseCount?: number;
  averagePrecision?: number;
  averageRecall?: number;
  averageLatencyMs?: number;
  beforeAfterComparisonAttached?: boolean;
}

export interface RagPolicyChangeRequest {
  schema: "romeo.rag-policy-change-request.v1";
  orgId: string;
  requestId: string;
  status: RagPolicyChangeRequestStatus;
  requestedBy: string;
  requestedAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  rejectReasonCode?: RagPolicyChangeRejectReasonCode;
  justificationCode?: RagPolicyChangeJustificationCode;
  evidenceSummary?: RagPolicyChangeEvidenceSummary;
  changedFields: string[];
  policyPatch: UpdateRagPolicyRequest;
  before: RagPolicyReport;
  proposed: RagPolicyReport;
  applied?: RagPolicyReport;
  redaction: {
    rawQueriesReturned: false;
    rawCorpusReturned: false;
    rawChunkTextReturned: false;
    rawVectorValuesReturned: false;
    secretRefsReturned: false;
  };
}

export interface CreateRagPolicyChangeRequest {
  policy: UpdateRagPolicyRequest;
  justificationCode?: RagPolicyChangeJustificationCode;
  evidenceSummary?: RagPolicyChangeEvidenceSummary;
}
