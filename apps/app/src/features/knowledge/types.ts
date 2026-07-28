export type {
  KnowledgeBase,
  KnowledgeEmbeddingIndexResult,
  KnowledgeExtractionJobResult,
  KnowledgeRetrievalPlan,
  KnowledgeRetrievalReplayComparisonReport,
  KnowledgeRetrievalReplayReport,
  KnowledgeRetrievalRoute,
  KnowledgeSource,
  KnowledgeUploadRegistration,
  RetrievalHit,
  TieredKnowledgeQueryResult,
  TieredRetrievalHit,
} from "@romeo/api-client/generated/sdk";

export type {
  KnowledgeRetrievalReplayComparisonRequest as CompareTieredKnowledgeReplayRequest,
  KnowledgeRetrievalReplayRequest as ReplayTieredKnowledgeRequest,
} from "@romeo/api-client/generated/sdk";

import type { KnowledgeRetrievalReplayRequest } from "@romeo/api-client/generated/sdk";

export type RagReplayCaseInput =
  KnowledgeRetrievalReplayRequest["cases"][number];
