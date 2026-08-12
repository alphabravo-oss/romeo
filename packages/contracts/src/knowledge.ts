import { createRoute, z } from "@hono/zod-openapi";

import {
  CompareTieredKnowledgeReplaySchema,
  CreateKnowledgeBaseSchema,
  CreateKnowledgeSourceSchema,
  CreateKnowledgeUploadSchema,
  IndexKnowledgeEmbeddingsSchema,
  KnowledgeBaseSchema,
  KnowledgeEmbeddingIndexResultSchema,
  KnowledgeExtractionJobResultSchema,
  KnowledgeRetrievalReplayComparisonReportSchema,
  KnowledgeRetrievalReplayReportSchema,
  KnowledgeSourceSchema,
  KnowledgeUploadRegistrationSchema,
  QueryKnowledgeBaseSchema,
  QueryTieredKnowledgeSchema,
  ReindexKnowledgeSourceSchema,
  ReplayTieredKnowledgeSchema,
  RetrievalHitSchema,
  TieredKnowledgeQueryResultSchema,
  UpdateKnowledgeBaseSchema,
  knowledgeIdentifier,
} from "./knowledge-schemas";
import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";

export * from "./knowledge-schemas";
const metadata = { tags: ["Knowledge"], security: authenticationSecurity };
const errors = {
  400: standardErrorResponses[400],
  401: standardErrorResponses[401],
  403: standardErrorResponses[403],
  404: standardErrorResponses[404],
  409: standardErrorResponses[409],
  500: standardErrorResponses[500],
} as const;
const basePath = z.strictObject({ knowledgeBaseId: knowledgeIdentifier });
const sourcePath = basePath.extend({ sourceId: knowledgeIdentifier });

export const AgenticRagSettingsSchema = z
  .strictObject({
    enabled: z.boolean(),
    userMode: z.enum(["optional", "required"]),
  })
  .openapi("AgenticRagSettings");

export const KnowledgeIngestReadinessSchema = z
  .strictObject({
    ready: z.boolean(),
    reason: z
      .enum(["embedding_unset", "tiers_disabled", "vector_unconfigured"])
      .optional(),
  })
  .openapi("KnowledgeIngestReadiness");

export const getKnowledgeIngestReadinessRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/knowledge/ingest-readiness",
  operationId: "knowledge.getIngestReadiness",
  summary: "Whether this org can upload and embed knowledge sources",
  responses: {
    200: jsonResponse(
      "Knowledge ingest readiness",
      dataEnvelope(KnowledgeIngestReadinessSchema),
    ),
    ...errors,
  },
});

export const getAgenticRagSettingsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/knowledge/agentic",
  operationId: "knowledge.getAgenticSettings",
  summary: "Get whether agentic RAG is available for this organization",
  responses: {
    200: jsonResponse(
      "Agentic RAG settings",
      dataEnvelope(AgenticRagSettingsSchema),
    ),
    ...errors,
  },
});

export const listKnowledgeBasesRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/knowledge-bases",
  operationId: "knowledge.listBases",
  summary: "List knowledge bases in a workspace",
  request: {
    query: z.strictObject({ workspaceId: knowledgeIdentifier.optional() }),
  },
  responses: {
    200: jsonResponse(
      "Knowledge bases",
      dataEnvelope(z.array(KnowledgeBaseSchema)),
    ),
    ...errors,
  },
});
export const createKnowledgeBaseRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/knowledge-bases",
  operationId: "knowledge.createBase",
  summary: "Create a knowledge base",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: CreateKnowledgeBaseSchema } },
    },
  },
  responses: {
    201: jsonResponse(
      "Created knowledge base",
      dataEnvelope(KnowledgeBaseSchema),
    ),
    ...errors,
  },
});
export const getKnowledgeBaseRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/knowledge-bases/{knowledgeBaseId}",
  operationId: "knowledge.getBase",
  summary: "Get a knowledge base",
  request: { params: basePath },
  responses: {
    200: jsonResponse("Knowledge base", dataEnvelope(KnowledgeBaseSchema)),
    ...errors,
  },
});
export const updateKnowledgeBaseRoute = createRoute({
  ...metadata,
  method: "patch",
  path: "/api/v1/knowledge-bases/{knowledgeBaseId}",
  operationId: "knowledge.updateBase",
  summary: "Update a knowledge base",
  request: {
    params: basePath,
    body: {
      required: true,
      content: { "application/json": { schema: UpdateKnowledgeBaseSchema } },
    },
  },
  responses: {
    200: jsonResponse(
      "Updated knowledge base",
      dataEnvelope(KnowledgeBaseSchema),
    ),
    ...errors,
  },
});
export const listKnowledgeSourcesRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/knowledge-bases/{knowledgeBaseId}/sources",
  operationId: "knowledge.listSources",
  summary: "List knowledge sources",
  request: { params: basePath },
  responses: {
    200: jsonResponse(
      "Knowledge sources",
      dataEnvelope(z.array(KnowledgeSourceSchema)),
    ),
    ...errors,
  },
});
export const createKnowledgeSourceRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/knowledge-bases/{knowledgeBaseId}/sources",
  operationId: "knowledge.createSource",
  summary: "Register a knowledge source",
  request: {
    params: basePath,
    body: {
      required: true,
      content: { "application/json": { schema: CreateKnowledgeSourceSchema } },
    },
  },
  responses: {
    202: jsonResponse(
      "Created knowledge source",
      dataEnvelope(KnowledgeSourceSchema),
    ),
    ...errors,
  },
});
export const createKnowledgeUploadRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/knowledge-bases/{knowledgeBaseId}/uploads",
  operationId: "knowledge.createUpload",
  summary: "Create a presigned knowledge source upload",
  request: {
    params: basePath,
    body: {
      required: true,
      content: { "application/json": { schema: CreateKnowledgeUploadSchema } },
    },
  },
  responses: {
    202: jsonResponse(
      "Knowledge upload registration",
      dataEnvelope(KnowledgeUploadRegistrationSchema),
    ),
    ...errors,
  },
});

export const completeKnowledgeUploadRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/knowledge-bases/{knowledgeBaseId}/sources/{sourceId}/complete",
  operationId: "knowledge.completeUpload",
  summary: "Complete a knowledge upload",
  request: { params: sourcePath },
  responses: {
    200: jsonResponse(
      "Completed knowledge source",
      dataEnvelope(KnowledgeSourceSchema),
    ),
    ...errors,
  },
});

export const extractKnowledgeSourceRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/knowledge-bases/{knowledgeBaseId}/sources/{sourceId}/extract",
  operationId: "knowledge.extractSource",
  summary: "Extract an uploaded knowledge source",
  request: { params: sourcePath },
  responses: {
    200: jsonResponse(
      "Knowledge extraction result",
      dataEnvelope(KnowledgeExtractionJobResultSchema),
    ),
    ...errors,
  },
});

export const deleteKnowledgeSourceRoute = createRoute({
  ...metadata,
  method: "delete",
  path: "/api/v1/knowledge-bases/{knowledgeBaseId}/sources/{sourceId}",
  operationId: "knowledge.deleteSource",
  summary: "Delete a knowledge source",
  request: { params: sourcePath },
  responses: {
    200: jsonResponse(
      "Deleted knowledge source",
      dataEnvelope(KnowledgeSourceSchema),
    ),
    ...errors,
  },
});

export const reindexKnowledgeSourceRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/knowledge-bases/{knowledgeBaseId}/sources/{sourceId}/reindex",
  operationId: "knowledge.reindexSource",
  summary: "Reindex a knowledge source",
  request: {
    params: sourcePath,
    body: {
      required: true,
      content: { "application/json": { schema: ReindexKnowledgeSourceSchema } },
    },
  },
  responses: {
    200: jsonResponse("Reindexed source", dataEnvelope(KnowledgeSourceSchema)),
    ...errors,
  },
});
export const indexKnowledgeEmbeddingsRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/knowledge-bases/{knowledgeBaseId}/embeddings",
  operationId: "knowledge.indexEmbeddings",
  summary: "Index provider embeddings for knowledge chunks",
  request: {
    params: basePath,
    body: {
      required: true,
      content: {
        "application/json": { schema: IndexKnowledgeEmbeddingsSchema },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "Embedding index result",
      dataEnvelope(KnowledgeEmbeddingIndexResultSchema),
    ),
    ...errors,
  },
});
export const queryKnowledgeBaseRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/knowledge-bases/{knowledgeBaseId}/query",
  operationId: "knowledge.queryBase",
  summary: "Query a knowledge base",
  request: {
    params: basePath,
    body: {
      required: true,
      content: { "application/json": { schema: QueryKnowledgeBaseSchema } },
    },
  },
  responses: {
    200: jsonResponse(
      "Retrieval hits",
      dataEnvelope(z.array(RetrievalHitSchema)),
    ),
    ...errors,
  },
});
export const queryTieredKnowledgeRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/knowledge-bases/query",
  operationId: "knowledge.queryTiered",
  summary: "Query authorized knowledge bases with a tiered plan",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: QueryTieredKnowledgeSchema } },
    },
  },
  responses: {
    200: jsonResponse(
      "Tiered query result",
      dataEnvelope(TieredKnowledgeQueryResultSchema),
    ),
    ...errors,
  },
});
export const replayTieredKnowledgeRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/admin/rag/replay",
  operationId: "knowledge.replayTiered",
  summary: "Replay tiered retrieval cases",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: ReplayTieredKnowledgeSchema } },
    },
  },
  responses: {
    200: jsonResponse(
      "Replay report",
      dataEnvelope(KnowledgeRetrievalReplayReportSchema),
    ),
    ...errors,
  },
});
export const compareTieredKnowledgeReplayRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/admin/rag/replay/compare",
  operationId: "knowledge.compareTieredReplay",
  summary: "Compare tiered retrieval replay metrics",
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: CompareTieredKnowledgeReplaySchema },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "Replay comparison",
      dataEnvelope(KnowledgeRetrievalReplayComparisonReportSchema),
    ),
    ...errors,
  },
});

export const knowledgeRoutes = [
  getAgenticRagSettingsRoute,
  getKnowledgeIngestReadinessRoute,
  listKnowledgeBasesRoute,
  createKnowledgeBaseRoute,
  getKnowledgeBaseRoute,
  updateKnowledgeBaseRoute,
  listKnowledgeSourcesRoute,
  createKnowledgeSourceRoute,
  createKnowledgeUploadRoute,
  completeKnowledgeUploadRoute,
  extractKnowledgeSourceRoute,
  indexKnowledgeEmbeddingsRoute,
  deleteKnowledgeSourceRoute,
  reindexKnowledgeSourceRoute,
  queryKnowledgeBaseRoute,
  queryTieredKnowledgeRoute,
  replayTieredKnowledgeRoute,
  compareTieredKnowledgeReplayRoute,
] as const;
