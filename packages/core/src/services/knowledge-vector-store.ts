import type {
  KnowledgeChunkEmbedding,
  KnowledgeChunkEmbeddingSearchHit,
} from "../domain/entities";

export interface KnowledgeVectorStoreSearchInput {
  dimensions: number;
  embeddingModel: string;
  embeddingProvider: string;
  knowledgeBaseId: string;
  maxResults: number;
  orgId: string;
  queryEmbedding: number[];
  sourceIds: string[];
  workspaceId: string;
}

export interface KnowledgeVectorStoreReadinessReport {
  collectionStatus?: string;
  failureCode?: string;
  httpStatus?: number;
  optimizerStatus?: string;
  status: "available" | "unavailable";
}

export interface KnowledgeVectorStoreReadinessProbe {
  checkReadiness(): Promise<KnowledgeVectorStoreReadinessReport>;
}

export interface KnowledgeVectorStore {
  deleteEmbeddingsForSource(input: {
    knowledgeBaseId: string;
    orgId: string;
    sourceId: string;
    workspaceId: string;
  }): Promise<void>;
  search(
    input: KnowledgeVectorStoreSearchInput,
  ): Promise<KnowledgeChunkEmbeddingSearchHit[]>;
  upsertEmbeddings(embeddings: KnowledgeChunkEmbedding[]): Promise<void>;
}
