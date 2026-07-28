import { z } from "@hono/zod-openapi";

export const knowledgeIdentifier = z.string().trim().min(1).max(300);
const timestamp = z.iso.datetime();
const tier = z.enum(["user_private", "workspace", "org", "shared"]);
const permissionReason = z.enum([
  "admin_override",
  "direct_use_grant",
  "group_use_grant",
  "service_account_use_grant",
]);
const isolationMode = z.enum([
  "dedicated_vector_store_per_org",
  "external_collection_per_org",
  "external_namespace_per_org",
  "pgvector_partitioned_by_org",
  "shared_row_scope",
]);
const routeMode = z.enum([
  "external_vector",
  "legacy_rag_provider",
  "lexical_fallback",
  "pgvector",
]);
const fallbackReason = z.enum([
  "embedding_provider_unavailable",
  "embedding_provider_use_grant_missing",
  "external_vector_search_failed",
  "missing_model_scope",
  "no_allowed_embedding_index",
  "no_authorized_vector_hits",
  "no_visible_chunks",
]);

export const KnowledgeBaseSchema = z
  .strictObject({
    id: knowledgeIdentifier,
    orgId: knowledgeIdentifier,
    workspaceId: knowledgeIdentifier,
    name: z.string().min(1),
    description: z.string().optional(),
    createdBy: knowledgeIdentifier,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .openapi("KnowledgeBase");

export const KnowledgeSourceSchema = z
  .strictObject({
    id: knowledgeIdentifier,
    knowledgeBaseId: knowledgeIdentifier,
    orgId: knowledgeIdentifier,
    workspaceId: knowledgeIdentifier,
    fileName: z.string().min(1),
    mimeType: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    status: z.enum(["pending", "indexed", "failed"]),
    objectKey: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()),
    chunkCount: z.number().int().nonnegative().optional(),
    contentHash: z.string().optional(),
    indexedAt: timestamp.optional(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .openapi("KnowledgeSource");

export const RetrievalHitSchema = z
  .strictObject({
    id: knowledgeIdentifier,
    content: z.string(),
    score: z.number(),
    citation: z.strictObject({
      documentId: knowledgeIdentifier,
      chunkId: knowledgeIdentifier,
      title: z.string(),
      sourceUri: z.string().optional(),
    }),
    metadata: z.record(z.string(), z.unknown()),
  })
  .openapi("RetrievalHit");

const backgroundJob = z
  .strictObject({
    id: knowledgeIdentifier,
    orgId: knowledgeIdentifier,
    workspaceId: knowledgeIdentifier.optional(),
    type: z.string(),
    status: z.enum(["queued", "running", "completed", "failed"]),
    payload: z.record(z.string(), z.unknown()),
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: timestamp.optional(),
  })
  .openapi("BackgroundJob");

export const KnowledgeUploadRegistrationSchema = z
  .strictObject({
    source: KnowledgeSourceSchema,
    upload: z.strictObject({
      key: z.string(),
      url: z.string().min(1),
      method: z.literal("PUT"),
      expiresAt: timestamp,
      headers: z.record(z.string(), z.string()),
    }),
  })
  .openapi("KnowledgeUploadRegistration");

export const KnowledgeExtractionJobResultSchema = z
  .strictObject({ job: backgroundJob, source: KnowledgeSourceSchema })
  .openapi("KnowledgeExtractionJobResult");

export const KnowledgeEmbeddingIndexResultSchema = z
  .strictObject({
    job: backgroundJob,
    embeddingCount: z.number().int().nonnegative(),
    dimensions: z.union([z.number().int().positive(), z.null()]),
    providerId: knowledgeIdentifier,
    model: z.string().min(1),
  })
  .openapi("KnowledgeEmbeddingIndexResult");

const retrievalRoute = z
  .strictObject({
    mode: routeMode,
    vectorStoreDriver: z.enum(["none", "pgvector", "qdrant"]),
    externalVectorStoreAttempted: z.boolean(),
    externalVectorStoreUsed: z.boolean(),
    providerId: knowledgeIdentifier.optional(),
    embeddingModel: z.string().optional(),
    embeddingDimensions: z.number().int().positive().optional(),
    fallbackReason: fallbackReason.optional(),
  })
  .openapi("KnowledgeRetrievalRoute");

const budgetMap = z.strictObject({
  user_private: z.number().int().positive(),
  workspace: z.number().int().positive(),
  org: z.number().int().positive(),
  shared: z.number().int().positive(),
});

const retrievalPlan = z
  .strictObject({
    entries: z.array(
      z.strictObject({
        knowledgeBaseId: knowledgeIdentifier,
        orgId: knowledgeIdentifier,
        workspaceId: knowledgeIdentifier,
        tier,
        permissionReason,
        maxResults: z.number().int().min(1).max(20),
        sourceFilter: z.strictObject({
          mode: z.literal("authorized_visible_sources"),
          connectorOwnerFiltered: z.boolean(),
        }),
        retrievalRoute: retrievalRoute.optional(),
        vectorScope: z.strictObject({
          driver: z.enum(["pgvector", "qdrant"]),
          isolationMode,
          orgId: knowledgeIdentifier,
          workspaceId: knowledgeIdentifier,
          knowledgeBaseId: knowledgeIdentifier,
        }),
      }),
    ),
    posture: z.strictObject({
      vectorDriver: z.enum(["pgvector", "qdrant"]),
      isolationMode,
      externalVectorStoreDriver: z.enum(["disabled", "qdrant"]),
      externalVectorStoreConfigured: z.boolean(),
      externalVectorStoreRoutingActive: z.boolean(),
      namespaceConfigured: z.boolean(),
      namespacePolicy: z.enum(["knowledge_base", "none", "org", "workspace"]),
      partitioningConfigured: z.boolean(),
      partitioningPolicy: z.enum([
        "knowledge_base",
        "none",
        "org",
        "workspace",
      ]),
    }),
    policy: z.strictObject({
      source: z.enum(["default", "org"]),
      enabledTiers: z.array(tier),
      defaultMaxResultsPerTier: budgetMap,
      maxResultsPerTier: budgetMap,
      knowledgeBaseTierAssignments: z.strictObject({
        org: z.array(knowledgeIdentifier),
        shared: z.array(knowledgeIdentifier),
      }),
      externalVectorStoreMode: z.enum(["deployment_managed", "disabled"]),
    }),
    requestedCount: z.number().int().nonnegative(),
    authorizedCount: z.number().int().nonnegative(),
    skipped: z.strictObject({
      count: z.number().int().nonnegative(),
      reasons: z.array(
        z.strictObject({
          reason: z.enum([
            "missing_use_grant",
            "not_found",
            "outside_organization",
            "outside_workspace",
            "tier_disabled_by_policy",
          ]),
          count: z.number().int().positive(),
        }),
      ),
    }),
  })
  .openapi("KnowledgeRetrievalPlan");

const tieredHit = RetrievalHitSchema.extend({
  knowledgeBaseId: knowledgeIdentifier,
  orgId: knowledgeIdentifier,
  workspaceId: knowledgeIdentifier,
  tier,
  permissionReason,
  retrievalRoute,
}).openapi("TieredRetrievalHit");

export const TieredKnowledgeQueryResultSchema = z
  .strictObject({ hits: z.array(tieredHit), plan: retrievalPlan })
  .openapi("TieredKnowledgeQueryResult");

const replayCaseResult = z
  .strictObject({
    authorizedKnowledgeBaseCount: z.number().int().nonnegative(),
    caseId: z.string().optional(),
    expectedChunkCount: z.number().int().nonnegative(),
    fallbackReasons: z.strictObject({
      embedding_provider_unavailable: z.number().int().nonnegative().optional(),
      embedding_provider_use_grant_missing: z
        .number()
        .int()
        .nonnegative()
        .optional(),
      external_vector_search_failed: z.number().int().nonnegative().optional(),
      missing_model_scope: z.number().int().nonnegative().optional(),
      no_allowed_embedding_index: z.number().int().nonnegative().optional(),
      no_authorized_vector_hits: z.number().int().nonnegative().optional(),
      no_visible_chunks: z.number().int().nonnegative().optional(),
    }),
    hitCount: z.number().int().nonnegative(),
    latencyMs: z.number().int().nonnegative(),
    matchedExpectedChunkCount: z.number().int().nonnegative(),
    precision: z.union([z.number(), z.null()]),
    recall: z.union([z.number(), z.null()]),
    retrievalRouteModes: z.strictObject({
      external_vector: z.number().int().nonnegative(),
      legacy_rag_provider: z.number().int().nonnegative(),
      lexical_fallback: z.number().int().nonnegative(),
      pgvector: z.number().int().nonnegative(),
    }),
    skippedKnowledgeBaseCount: z.number().int().nonnegative(),
    status: z.enum(["failed", "observed", "passed"]),
  })
  .openapi("KnowledgeRetrievalReplayCaseResult");

const replayRedaction = z.strictObject({
  rawQueriesReturned: z.literal(false),
  rawChunkTextReturned: z.literal(false),
  rawExpectedChunkIdsReturned: z.literal(false),
  rawHitIdsReturned: z.literal(false),
  vectorValuesReturned: z.literal(false),
});
const replayMetrics = z.strictObject({
  averageLatencyMs: z.number(),
  averagePrecision: z.union([z.number(), z.null()]),
  averageRecall: z.union([z.number(), z.null()]),
  expectedChunkCount: z.number().int(),
  hitCount: z.number().int(),
  matchedExpectedChunkCount: z.number().int(),
});

export const KnowledgeRetrievalReplayReportSchema = z
  .strictObject({
    caseCount: z.number().int().positive(),
    cases: z.array(replayCaseResult),
    generatedAt: timestamp,
    metrics: replayMetrics,
    orgId: knowledgeIdentifier,
    redaction: replayRedaction,
    status: z.enum(["failed", "observed", "passed"]),
  })
  .openapi("KnowledgeRetrievalReplayReport");

export const KnowledgeRetrievalReplayComparisonReportSchema = z
  .strictObject({
    baseline: KnowledgeRetrievalReplayReportSchema,
    candidate: KnowledgeRetrievalReplayReportSchema,
    deltas: replayMetrics,
    generatedAt: timestamp,
    orgId: knowledgeIdentifier,
    outcome: z.enum(["improved", "observed", "regressed", "unchanged"]),
    redaction: replayRedaction,
  })
  .openapi("KnowledgeRetrievalReplayComparisonReport");

export const CreateKnowledgeBaseSchema = z
  .strictObject({
    workspaceId: knowledgeIdentifier,
    name: z.string().min(1),
    description: z.string().min(1).optional(),
  })
  .openapi("CreateKnowledgeBaseRequest");
export const UpdateKnowledgeBaseSchema = z
  .strictObject({
    name: z.string().min(1).optional(),
    description: z.union([z.string().min(1).max(2_000), z.null()]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one knowledge base field is required.",
  })
  .openapi("UpdateKnowledgeBaseRequest");
export const CreateKnowledgeSourceSchema = z
  .strictObject({
    fileName: z.string().min(1),
    mimeType: z.string().min(1),
    sizeBytes: z.number().int().positive(),
    content: z.string().min(1).max(200_000).optional(),
  })
  .openapi("CreateKnowledgeSourceRequest");
export const CreateKnowledgeUploadSchema = z
  .strictObject({
    fileName: z.string().min(1),
    mimeType: z.string().min(1),
    sizeBytes: z.number().int().positive(),
  })
  .openapi("CreateKnowledgeUploadRequest");
export const ReindexKnowledgeSourceSchema = z
  .strictObject({
    content: z.string().min(1).max(200_000),
    sizeBytes: z.number().int().positive().optional(),
  })
  .openapi("ReindexKnowledgeSourceRequest");
export const QueryKnowledgeBaseSchema = z
  .strictObject({
    query: z.string().min(1),
    maxResults: z.number().int().positive().max(20).optional(),
  })
  .openapi("QueryKnowledgeBaseRequest");
const partialBudget = z.strictObject({
  user_private: z.number().int().positive().max(20).optional(),
  workspace: z.number().int().positive().max(20).optional(),
  org: z.number().int().positive().max(20).optional(),
  shared: z.number().int().positive().max(20).optional(),
});
export const QueryTieredKnowledgeSchema = z
  .strictObject({
    knowledgeBaseIds: z.array(knowledgeIdentifier).min(1).max(25),
    query: z.string().min(1),
    maxResultsPerTier: partialBudget.optional(),
  })
  .openapi("TieredKnowledgeQueryRequest");
const replayCase = z.strictObject({
  id: z.string().min(1).max(120).optional(),
  knowledgeBaseIds: z.array(knowledgeIdentifier).min(1).max(25),
  query: z.string().min(1).max(4_000),
  expectedChunkIds: z.array(knowledgeIdentifier).max(50).optional(),
  maxResultsPerTier: partialBudget.optional(),
});
export const ReplayTieredKnowledgeSchema = z
  .strictObject({ cases: z.array(replayCase).min(1).max(50) })
  .openapi("KnowledgeRetrievalReplayRequest");
export const CompareTieredKnowledgeReplaySchema = z
  .strictObject({
    baseline: z.array(replayCase).min(1).max(50),
    candidate: z.array(replayCase).min(1).max(50),
  })
  .openapi("KnowledgeRetrievalReplayComparisonRequest");
export const IndexKnowledgeEmbeddingsSchema = z
  .strictObject({
    providerId: knowledgeIdentifier,
    model: z.string().min(1).max(200),
    batchSize: z.number().int().positive().max(64).optional(),
  })
  .openapi("IndexKnowledgeEmbeddingsRequest");
