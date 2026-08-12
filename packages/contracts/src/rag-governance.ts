import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";

const identifier = z.string().trim().min(1).max(120);
const timestamp = z.iso.datetime();
const count = z.number().int().nonnegative();

export const RagPolicyTierSchema = z.enum([
  "user_private",
  "workspace",
  "org",
  "shared",
]);
export const RagVectorIsolationPolicySchema = z.enum([
  "knowledge_base",
  "none",
  "org",
  "workspace",
]);
export const RagPhysicalVectorIsolationModeSchema = z.enum([
  "dedicated_vector_store_per_org",
  "external_collection_per_org",
  "external_namespace_per_org",
  "pgvector_partitioned_by_org",
  "shared_row_scope",
]);
export const RagPhysicalVectorIsolationEnforcementSchema = z.enum([
  "advisory",
  "required",
]);
export const RagPolicyChangeJustificationCodeSchema = z.enum([
  "compliance_update",
  "incident_response",
  "manual_risk_reduction",
  "retrieval_replay_improvement",
]);
export const RagPolicyChangeRejectReasonCodeSchema = z.enum([
  "insufficient_evidence",
  "policy_conflict",
  "superseded",
  "unsafe_defaults",
]);

const RagPolicyBudgetSchema = z.strictObject({
  user_private: z.number().int().positive().max(20),
  workspace: z.number().int().positive().max(20),
  org: z.number().int().positive().max(20),
  shared: z.number().int().positive().max(20),
});
const RagPolicyBudgetPatchSchema = RagPolicyBudgetSchema.partial();
const RagPolicyProviderModelSchema = z.strictObject({
  providerId: identifier,
  model: z.string().trim().min(1).max(200),
});
const RagPolicyAssignmentsSchema = z.strictObject({
  org: z.array(identifier).max(500),
  shared: z.array(identifier).max(500),
});
const RagPolicyRetrievalSettingsSchema = z
  .strictObject({
    topK: z.number().int().min(1).max(20),
    similarityThreshold: z.number().min(0).max(1),
    hybridSearch: z.boolean(),
    hybridBm25Weight: z.number().min(0).max(1),
  })
  .openapi("RagPolicyRetrievalSettings");
const RagPolicyRetrievalSettingsPatchSchema =
  RagPolicyRetrievalSettingsSchema.partial();
const RagPolicyAgenticSettingsSchema = z
  .strictObject({
    enabled: z.boolean(),
    userMode: z.enum(["optional", "required"]),
  })
  .openapi("RagPolicyAgenticSettings");
const RagPolicyAgenticSettingsPatchSchema =
  RagPolicyAgenticSettingsSchema.partial();
const RagPolicyAssignmentsPatchSchema = RagPolicyAssignmentsSchema.partial();
const RagPolicyExternalVectorStorePatchSchema = z.strictObject({
  mode: z.enum(["deployment_managed", "disabled"]).optional(),
  namespacePolicy: RagVectorIsolationPolicySchema.optional(),
  partitioningPolicy: RagVectorIsolationPolicySchema.optional(),
  drStrategy: z.literal("postgres_authoritative_reindex").optional(),
  exportPolicy: z.literal("metadata_only").optional(),
});
const RagPolicyPhysicalIsolationPatchSchema = z.strictObject({
  mode: RagPhysicalVectorIsolationModeSchema.optional(),
  enforcement: RagPhysicalVectorIsolationEnforcementSchema.optional(),
});

export const UpdateRagPolicyRequestSchema = z
  .strictObject({
    enabledTiers: z.array(RagPolicyTierSchema).max(4).optional(),
    defaultMaxResultsPerTier: RagPolicyBudgetPatchSchema.optional(),
    maxResultsPerTier: RagPolicyBudgetPatchSchema.optional(),
    allowedEmbeddingProviderModels: z
      .array(RagPolicyProviderModelSchema)
      .max(100)
      .optional(),
    retrieval: RagPolicyRetrievalSettingsPatchSchema.optional(),
    agentic: RagPolicyAgenticSettingsPatchSchema.optional(),
    knowledgeBaseTierAssignments: RagPolicyAssignmentsPatchSchema.optional(),
    dataResidencyTags: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(80)
          .regex(/^[A-Za-z0-9_.:-]+$/u),
      )
      .max(50)
      .optional(),
    externalVectorStore: RagPolicyExternalVectorStorePatchSchema.optional(),
    physicalVectorIsolation: RagPolicyPhysicalIsolationPatchSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one RAG policy field is required.",
  })
  .openapi("UpdateRagPolicyRequest");

export const RagPolicyReportSchema = z
  .strictObject({
    orgId: identifier,
    source: z.enum(["default", "org"]),
    enabledTiers: z.array(RagPolicyTierSchema),
    defaultMaxResultsPerTier: RagPolicyBudgetSchema,
    maxResultsPerTier: RagPolicyBudgetSchema,
    allowedEmbeddingProviderModels: z.array(RagPolicyProviderModelSchema),
    retrieval: RagPolicyRetrievalSettingsSchema,
    agentic: RagPolicyAgenticSettingsSchema,
    knowledgeBaseTierAssignments: RagPolicyAssignmentsSchema,
    dataResidencyTags: z.array(z.string()),
    externalVectorStore: z.strictObject({
      mode: z.enum(["deployment_managed", "disabled"]),
      namespacePolicy: RagVectorIsolationPolicySchema,
      partitioningPolicy: RagVectorIsolationPolicySchema,
      configured: z.boolean(),
      drStrategy: z.literal("postgres_authoritative_reindex"),
      exportPolicy: z.literal("metadata_only"),
      restoreValidation: z.enum(["not_required", "required_when_enabled"]),
    }),
    physicalVectorIsolation: z.strictObject({
      mode: RagPhysicalVectorIsolationModeSchema,
      enforcement: RagPhysicalVectorIsolationEnforcementSchema,
      configured: z.boolean(),
      postgresAuthoritative: z.literal(true),
      liveEvidenceRequired: z.boolean(),
    }),
    retention: z.strictObject({
      deleteVectorsOnSourceDelete: z.literal(true),
      exportIncludesEmbeddingVectors: z.literal(false),
    }),
    enforcement: z.strictObject({
      tierBudgets: z.literal("enforced"),
      embeddingProviderModelAllowlist: z.enum(["enforced", "unrestricted"]),
    }),
    updatedAt: timestamp.optional(),
    updatedBy: identifier.optional(),
  })
  .openapi("RagPolicyReport");

const RagPolicyChangeEvidenceSummarySchema = z.strictObject({
  replayCaseCount: z.number().int().nonnegative().max(100_000).optional(),
  averagePrecision: z.number().min(0).max(1).optional(),
  averageRecall: z.number().min(0).max(1).optional(),
  averageLatencyMs: z.number().nonnegative().max(3_600_000).optional(),
  beforeAfterComparisonAttached: z.boolean().optional(),
});

export const CreateRagPolicyChangeRequestSchema = z
  .strictObject({
    policy: UpdateRagPolicyRequestSchema,
    justificationCode: RagPolicyChangeJustificationCodeSchema.optional(),
    evidenceSummary: RagPolicyChangeEvidenceSummarySchema.optional(),
  })
  .openapi("CreateRagPolicyChangeRequest");

export const ReviewRagPolicyChangeRequestSchema = z
  .strictObject({
    confirmRequestId: identifier,
    reasonCode: RagPolicyChangeRejectReasonCodeSchema.optional(),
  })
  .openapi("ReviewRagPolicyChangeRequest");

export const RagPolicyChangeRequestSchema = z
  .strictObject({
    schema: z.literal("romeo.rag-policy-change-request.v1"),
    orgId: identifier,
    requestId: identifier,
    status: z.enum(["approved", "pending", "rejected"]),
    requestedBy: identifier,
    requestedAt: timestamp,
    reviewedBy: identifier.optional(),
    reviewedAt: timestamp.optional(),
    rejectReasonCode: RagPolicyChangeRejectReasonCodeSchema.optional(),
    justificationCode: RagPolicyChangeJustificationCodeSchema.optional(),
    evidenceSummary: RagPolicyChangeEvidenceSummarySchema.optional(),
    changedFields: z.array(z.string()),
    policyPatch: UpdateRagPolicyRequestSchema,
    before: RagPolicyReportSchema,
    proposed: RagPolicyReportSchema,
    applied: RagPolicyReportSchema.optional(),
    redaction: z.strictObject({
      rawQueriesReturned: z.literal(false),
      rawCorpusReturned: z.literal(false),
      rawChunkTextReturned: z.literal(false),
      rawVectorValuesReturned: z.literal(false),
      secretRefsReturned: z.literal(false),
    }),
  })
  .openapi("RagPolicyChangeRequest");

const evidenceStatus = z.enum(["failed", "passed", "planned", "unknown"]);
const evidenceMode = z.enum(["dry-run", "live"]);
const evidenceInvalidReason = z.enum([
  "invalid_json",
  "read_failed",
  "schema_mismatch",
]);
const qdrantEvidenceRedaction = z.strictObject({
  apiKeyReturned: z.literal(false),
  collectionReturned: z.literal(false),
  endpointReturned: z.literal(false),
  evidenceFileBodyReturned: z.literal(false),
  namespaceValuesReturned: z.literal(false),
  partitionValuesReturned: z.literal(false),
  payloadValuesReturned: z.literal(false),
  pointIdsReturned: z.literal(false),
  rawEvidencePathReturned: z.literal(false),
  vectorValuesReturned: z.literal(false),
});
const QdrantLiveEvidenceSchema = z.strictObject({
  configured: z.boolean(),
  status: z.enum(["failed", "invalid", "not_configured", "satisfied"]),
  schemaVersion: z.literal("romeo.qdrant-live-evidence.v1").optional(),
  generatedAt: timestamp.optional(),
  evidenceStatus: evidenceStatus.optional(),
  evidenceMode: evidenceMode.optional(),
  invalidReason: evidenceInvalidReason.optional(),
  namespacePolicy: RagVectorIsolationPolicySchema.optional(),
  partitioningPolicy: RagVectorIsolationPolicySchema.optional(),
  collectionHealthRead: z.boolean(),
  scopedQueryReturnedExpectedPoint: z.boolean(),
  namespaceTrapExcluded: z.boolean(),
  partitionTrapExcluded: z.boolean(),
  foreignOrgTrapExcluded: z.boolean(),
  vectorsOmittedFromQuery: z.boolean(),
  scopedDeleteVerified: z.boolean(),
  cleanupAttempted: z.boolean(),
  redaction: qdrantEvidenceRedaction,
});
const PgvectorEvidenceSchema = z.strictObject({
  configured: z.boolean(),
  status: z.enum(["failed", "invalid", "not_configured", "satisfied"]),
  schemaVersion: z
    .literal("romeo.pgvector-physical-isolation-review.v1")
    .optional(),
  generatedAt: timestamp.optional(),
  evidenceStatus: evidenceStatus.optional(),
  evidenceMode: evidenceMode.optional(),
  invalidReason: evidenceInvalidReason.optional(),
  tablePartitioned: z.boolean(),
  partitionKeyIncludesOrgId: z.boolean(),
  partitionCount: count,
  hnswIndexCount: count,
  queryPlanReviewed: z.boolean(),
  redaction: z.strictObject({
    databaseUrlReturned: z.literal(false),
    evidenceFileBodyReturned: z.literal(false),
    rawEvidencePathReturned: z.literal(false),
    rawSqlReturned: z.literal(false),
    vectorValuesReturned: z.literal(false),
  }),
});

export const RagPostureReportSchema = z
  .strictObject({
    generatedAt: timestamp,
    orgId: identifier,
    status: z.enum(["degraded", "ready"]),
    vector: z.strictObject({
      driver: z.enum(["pgvector", "qdrant"]),
      authoritativeStore: z.literal("postgres"),
      isolationMode: RagPhysicalVectorIsolationModeSchema,
      pgvectorConfigured: z.boolean(),
      externalVectorStoreConfigured: z.boolean(),
      qdrantConfigured: z.boolean(),
      namespaceConfigured: z.boolean(),
      partitioningConfigured: z.boolean(),
      postureSource: z.literal("deployment_default"),
      externalStore: z.strictObject({
        driver: z.enum(["disabled", "qdrant"]),
        endpointConfigured: z.boolean(),
        collectionConfigured: z.boolean(),
        credentialRefConfigured: z.boolean(),
        credentialRefValid: z.boolean(),
        credentialRefScheme: z.string().optional(),
        namespacePolicy: RagVectorIsolationPolicySchema,
        partitioningPolicy: RagVectorIsolationPolicySchema,
        configured: z.boolean(),
        routingActive: z.boolean(),
        evidence: QdrantLiveEvidenceSchema,
      }),
      physicalIsolation: z.strictObject({
        policy: RagPolicyReportSchema.shape.physicalVectorIsolation,
        deploymentMode: RagPhysicalVectorIsolationModeSchema,
        deploymentMatched: z.boolean(),
        evidence: PgvectorEvidenceSchema,
        externalVectorEvidence: QdrantLiveEvidenceSchema,
        status: z.enum([
          "deployment_mismatch",
          "evidence_pending",
          "satisfied",
        ]),
      }),
    }),
    corpus: z.strictObject({
      workspaceCount: count,
      knowledgeBaseCount: count,
      sourceCount: count,
      indexedSourceCount: count,
      pendingSourceCount: count,
      failedSourceCount: count,
      chunkCount: count,
      embeddingCount: count,
      embeddedChunkCount: count,
      chunksMissingProviderEmbeddingCount: count,
      staleEmbeddingRecordCount: count,
      staleSourceCount: count,
      providerModelIndexCount: count,
    }),
    jobs: z.strictObject({
      failedEmbeddingIndexJobCount: count,
      failedExtractionJobCount: count,
      failedReindexJobCount: count,
      queuedKnowledgeJobCount: count,
      runningKnowledgeJobCount: count,
    }),
    fallback: z.strictObject({
      lexicalFallbackAvailable: z.boolean(),
      degraded: z.boolean(),
      reasonCodes: z.array(
        z.enum([
          "no_provider_embeddings",
          "partial_provider_embedding_coverage",
          "shared_pgvector_default",
        ]),
      ),
    }),
    readiness: z.strictObject({
      warnings: z.array(
        z.strictObject({
          code: z.enum([
            "failed_knowledge_jobs",
            "failed_knowledge_sources",
            "lexical_fallback_active",
            "physical_vector_isolation_evidence_pending",
            "physical_vector_isolation_mismatch",
            "stale_embedding_records",
            "stale_source_chunk_counts",
          ]),
          count,
          severity: z.enum(["info", "warning"]),
        }),
      ),
    }),
  })
  .openapi("RagPostureReport");

const metadata = { tags: ["RAG governance"], security: authenticationSecurity };
const requestIdParams = z.strictObject({ requestId: identifier });
const body = <T extends z.ZodType>(schema: T) => ({
  required: true as const,
  content: { "application/json": { schema } },
});

export const getRagPostureRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/admin/rag/posture",
  operationId: "ragGovernance.getPosture",
  summary: "Get sanitized RAG and vector posture",
  responses: {
    200: jsonResponse(
      "RAG posture report",
      dataEnvelope(RagPostureReportSchema),
    ),
    ...standardErrorResponses,
  },
});
export const getRagPolicyRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/admin/rag/policy",
  operationId: "ragGovernance.getPolicy",
  summary: "Get organization RAG policy",
  responses: {
    200: jsonResponse("RAG policy", dataEnvelope(RagPolicyReportSchema)),
    ...standardErrorResponses,
  },
});
export const updateRagPolicyRoute = createRoute({
  ...metadata,
  method: "patch",
  path: "/api/v1/admin/rag/policy",
  operationId: "ragGovernance.updatePolicy",
  summary: "Update organization RAG policy",
  request: { body: body(UpdateRagPolicyRequestSchema) },
  responses: {
    200: jsonResponse("RAG policy", dataEnvelope(RagPolicyReportSchema)),
    ...standardErrorResponses,
  },
});
export const getRagPolicyChangeRequestRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/admin/rag/policy/change-request",
  operationId: "ragGovernance.getPolicyChangeRequest",
  summary: "Get the latest organization RAG policy change request",
  responses: {
    200: jsonResponse(
      "Latest RAG policy change request",
      dataEnvelope(z.union([RagPolicyChangeRequestSchema, z.null()])),
    ),
    ...standardErrorResponses,
  },
});
export const createRagPolicyChangeRequestRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/admin/rag/policy/change-requests",
  operationId: "ragGovernance.createPolicyChangeRequest",
  summary: "Create a governed organization RAG policy change request",
  request: { body: body(CreateRagPolicyChangeRequestSchema) },
  responses: {
    201: jsonResponse(
      "RAG policy change request",
      dataEnvelope(RagPolicyChangeRequestSchema),
    ),
    ...standardErrorResponses,
  },
});
export const approveRagPolicyChangeRequestRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/admin/rag/policy/change-requests/{requestId}/approve",
  operationId: "ragGovernance.approvePolicyChangeRequest",
  summary:
    "Approve and apply a governed organization RAG policy change request",
  request: {
    params: requestIdParams,
    body: body(ReviewRagPolicyChangeRequestSchema),
  },
  responses: {
    200: jsonResponse(
      "Approved RAG policy change request",
      dataEnvelope(RagPolicyChangeRequestSchema),
    ),
    ...standardErrorResponses,
  },
});
export const rejectRagPolicyChangeRequestRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/admin/rag/policy/change-requests/{requestId}/reject",
  operationId: "ragGovernance.rejectPolicyChangeRequest",
  summary: "Reject a governed organization RAG policy change request",
  request: {
    params: requestIdParams,
    body: body(ReviewRagPolicyChangeRequestSchema),
  },
  responses: {
    200: jsonResponse(
      "Rejected RAG policy change request",
      dataEnvelope(RagPolicyChangeRequestSchema),
    ),
    ...standardErrorResponses,
  },
});

export const ragGovernanceRoutes = [
  getRagPostureRoute,
  getRagPolicyRoute,
  updateRagPolicyRoute,
  getRagPolicyChangeRequestRoute,
  createRagPolicyChangeRequestRoute,
  approveRagPolicyChangeRequestRoute,
  rejectRagPolicyChangeRequestRoute,
] as const;
