import { pathId, withQuery } from "../path";
import type { RomeoTransport } from "../transport";
import type {
  CreateKnowledgeBaseInput,
  CreateKnowledgeSourceInput,
  CreateKnowledgeUploadInput,
  CompareTieredKnowledgeReplayInput,
  IndexKnowledgeEmbeddingsInput,
  KnowledgeBase,
  KnowledgeEmbeddingIndexResult,
  KnowledgeExtractionJobResult,
  KnowledgeSource,
  KnowledgeUploadRegistration,
  QueryKnowledgeBaseInput,
  QueryTieredKnowledgeInput,
  ReindexKnowledgeSourceInput,
  ReplayTieredKnowledgeInput,
  RetrievalHit,
  KnowledgeRetrievalReplayComparisonReport,
  KnowledgeRetrievalReplayReport,
  TieredKnowledgeQueryResult,
  UpdateKnowledgeBaseInput,
} from "../types";

export function createKnowledgeResource(transport: RomeoTransport) {
  return {
    listBases: (workspaceId?: string) =>
      transport.data<KnowledgeBase[]>(
        "GET",
        withQuery("/api/v1/knowledge-bases", { workspaceId }),
      ),
    createBase: (input: CreateKnowledgeBaseInput) =>
      transport.data<KnowledgeBase>("POST", "/api/v1/knowledge-bases", input),
    getBase: (knowledgeBaseId: string) =>
      transport.data<KnowledgeBase>(
        "GET",
        `/api/v1/knowledge-bases/${pathId(knowledgeBaseId)}`,
      ),
    updateBase: (
      knowledgeBaseId: string,
      input: UpdateKnowledgeBaseInput,
    ) =>
      transport.data<KnowledgeBase>(
        "PATCH",
        `/api/v1/knowledge-bases/${pathId(knowledgeBaseId)}`,
        input,
      ),
    listSources: (knowledgeBaseId: string) =>
      transport.data<KnowledgeSource[]>(
        "GET",
        `/api/v1/knowledge-bases/${pathId(knowledgeBaseId)}/sources`,
      ),
    createSource: (input: CreateKnowledgeSourceInput) => {
      const { knowledgeBaseId, ...body } = input;
      return transport.data<KnowledgeSource>(
        "POST",
        `/api/v1/knowledge-bases/${pathId(knowledgeBaseId)}/sources`,
        body,
      );
    },
    createUpload: (input: CreateKnowledgeUploadInput) => {
      const { knowledgeBaseId, ...body } = input;
      return transport.data<KnowledgeUploadRegistration>(
        "POST",
        `/api/v1/knowledge-bases/${pathId(knowledgeBaseId)}/uploads`,
        body,
      );
    },
    completeUpload: (knowledgeBaseId: string, sourceId: string) =>
      transport.data<KnowledgeSource>(
        "POST",
        `/api/v1/knowledge-bases/${pathId(knowledgeBaseId)}/sources/${pathId(sourceId)}/complete`,
      ),
    extractUpload: (knowledgeBaseId: string, sourceId: string) =>
      transport.data<KnowledgeExtractionJobResult>(
        "POST",
        `/api/v1/knowledge-bases/${pathId(knowledgeBaseId)}/sources/${pathId(sourceId)}/extract`,
      ),
    indexEmbeddings: (input: IndexKnowledgeEmbeddingsInput) => {
      const { knowledgeBaseId, ...body } = input;
      return transport.data<KnowledgeEmbeddingIndexResult>(
        "POST",
        `/api/v1/knowledge-bases/${pathId(knowledgeBaseId)}/embeddings`,
        body,
      );
    },
    deleteSource: (knowledgeBaseId: string, sourceId: string) =>
      transport.data<KnowledgeSource>(
        "DELETE",
        `/api/v1/knowledge-bases/${pathId(knowledgeBaseId)}/sources/${pathId(sourceId)}`,
      ),
    reindexSource: (input: ReindexKnowledgeSourceInput) => {
      const { knowledgeBaseId, sourceId, ...body } = input;
      return transport.data<KnowledgeSource>(
        "POST",
        `/api/v1/knowledge-bases/${pathId(knowledgeBaseId)}/sources/${pathId(sourceId)}/reindex`,
        body,
      );
    },
    query: (input: QueryKnowledgeBaseInput) => {
      const { knowledgeBaseId, ...body } = input;
      return transport.data<RetrievalHit[]>(
        "POST",
        `/api/v1/knowledge-bases/${pathId(knowledgeBaseId)}/query`,
        body,
      );
    },
    queryTiered: (input: QueryTieredKnowledgeInput) => {
      return transport.data<TieredKnowledgeQueryResult>(
        "POST",
        "/api/v1/knowledge-bases/query",
        input,
      );
    },
    replayTiered: (input: ReplayTieredKnowledgeInput) => {
      return transport.data<KnowledgeRetrievalReplayReport>(
        "POST",
        "/api/v1/admin/rag/replay",
        input,
      );
    },
    compareTieredReplay: (input: CompareTieredKnowledgeReplayInput) => {
      return transport.data<KnowledgeRetrievalReplayComparisonReport>(
        "POST",
        "/api/v1/admin/rag/replay/compare",
        input,
      );
    },
  };
}
