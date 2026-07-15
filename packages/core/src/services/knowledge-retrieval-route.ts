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

export function lexicalRetrievalRoute(
  fallbackReason: KnowledgeRetrievalRouteFallbackReason,
): KnowledgeRetrievalRoute {
  return {
    mode: "lexical_fallback",
    vectorStoreDriver: "none",
    externalVectorStoreAttempted: false,
    externalVectorStoreUsed: false,
    fallbackReason,
  };
}
