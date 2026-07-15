import { hasGrant, hasScope, type AuthSubject } from "@romeo/auth";
import {
  getEmbeddingAdapter,
  type EmbeddingProviderAdapter,
} from "@romeo/providers";
import type { RetrievalHit } from "@romeo/rag";

import type {
  KnowledgeBase,
  KnowledgeChunk,
  KnowledgeChunkEmbedding,
  KnowledgeChunkEmbeddingSearchHit,
  KnowledgeSource,
  ProviderInstance,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { mergeHybridRetrievalHits } from "./knowledge-hybrid-retrieval";
import {
  retrievalHitFromIndexedChunk,
  retrieveKnowledgeChunks,
  toIndexedKnowledgeChunks,
} from "./knowledge-ingestion";
import {
  lexicalRetrievalRoute,
  type KnowledgeRetrievalRoute,
  type KnowledgeRetrievalRouteFallbackReason,
} from "./knowledge-retrieval-route";
import {
  assertEmbeddingProviderModelAllowed,
  isEmbeddingProviderModelAllowed,
  readRagPolicy,
} from "./rag-policy-service";
import type { KnowledgeVectorStore } from "./knowledge-vector-store";

export interface PersistedVectorRetrievalInput {
  adapter?: EmbeddingProviderAdapter;
  fetchImpl?: typeof fetch;
  knowledgeBase: KnowledgeBase;
  chunks: KnowledgeChunk[];
  maxResults?: number;
  query: string;
  repository: RomeoRepository;
  sources: KnowledgeSource[];
  subject: AuthSubject;
  vectorStore?: KnowledgeVectorStore;
}

interface EmbeddingIndexSelection {
  policy: Awaited<ReturnType<typeof readRagPolicy>>;
  provider: ProviderInstance;
  model: string;
  dimensions: number;
}

interface EmbeddingIndexSelectionUnavailable {
  fallbackReason: KnowledgeRetrievalRouteFallbackReason;
}

export interface PersistedVectorRetrievalResult {
  hits: RetrievalHit[];
  route: KnowledgeRetrievalRoute;
}

const defaultMaxResults = 5;

export async function retrievePersistedVectorHits(
  input: PersistedVectorRetrievalInput,
): Promise<RetrievalHit[]> {
  return (await retrievePersistedVectorHitsWithRoute(input)).hits;
}

export async function retrievePersistedVectorHitsWithRoute(
  input: PersistedVectorRetrievalInput,
): Promise<PersistedVectorRetrievalResult> {
  const selectionResult = await selectEmbeddingIndex(input);
  if ("fallbackReason" in selectionResult) {
    const maxResults = input.maxResults ?? defaultMaxResults;
    return {
      hits: retrieveKnowledgeChunks(
        input.chunks,
        input.sources,
        input.query,
        maxResults,
      ),
      route: lexicalRetrievalRoute(selectionResult.fallbackReason),
    };
  }
  const { selection } = selectionResult;

  const embedRequest = {
    provider: selection.provider,
    model: selection.model,
    texts: [input.query],
  };
  const result = await (
    input.adapter ?? getEmbeddingAdapter(selection.provider.type)
  ).embedTexts(
    input.fetchImpl === undefined
      ? embedRequest
      : { ...embedRequest, fetchImpl: input.fetchImpl },
  );
  assertEmbeddingProviderModelAllowed(
    selection.policy,
    selection.provider.id,
    result.model,
  );
  if (result.dimensions !== selection.dimensions) {
    throw new ApiError(
      "embedding_dimensions_unsupported",
      "Query embedding dimensions do not match the persisted knowledge index.",
      422,
      {
        dimensions: result.dimensions,
        expectedDimensions: selection.dimensions,
      },
    );
  }
  const queryEmbedding = result.embeddings[0];
  if (queryEmbedding === undefined) {
    return {
      hits: retrieveKnowledgeChunks(
        input.chunks,
        input.sources,
        input.query,
        input.maxResults ?? defaultMaxResults,
      ),
      route: routeForSelectedIndex(selection, {
        fallbackReason: "no_authorized_vector_hits",
        mode: "lexical_fallback",
        vectorStoreDriver: "none",
      }),
    };
  }

  const maxResults = input.maxResults ?? defaultMaxResults;
  const externalVectorSearch = await searchExternalVectorStore(input, {
    dimensions: result.dimensions,
    maxResults,
    model: result.model,
    providerId: selection.provider.id,
    queryEmbedding,
  });
  const vectorHits =
    externalVectorSearch.status === "used"
      ? externalVectorSearch.hits
      : await input.repository.searchKnowledgeChunkEmbeddings({
          orgId: input.knowledgeBase.orgId,
          workspaceId: input.knowledgeBase.workspaceId,
          knowledgeBaseId: input.knowledgeBase.id,
          embeddingProvider: selection.provider.id,
          embeddingModel: result.model,
          dimensions: result.dimensions,
          queryEmbedding,
          maxResults,
        });
  const indexedByChunkId = new Map(
    toIndexedKnowledgeChunks(input.chunks, input.sources).map((chunk) => [
      chunk.id,
      chunk,
    ]),
  );
  const persistedHits = vectorHits.flatMap((hit) => {
    const chunk = indexedByChunkId.get(hit.embedding.chunkId);
    return chunk === undefined
      ? []
      : [retrievalHitFromIndexedChunk(chunk, hit.score)];
  });
  const lexicalHits = retrieveKnowledgeChunks(
    input.chunks,
    input.sources,
    input.query,
    maxResults,
  );
  const vectorStoreDriver =
    externalVectorSearch.status === "used" ? "qdrant" : "pgvector";
  const fallbackReason =
    externalVectorSearch.status === "failed"
      ? "external_vector_search_failed"
      : undefined;

  if (persistedHits.length === 0) {
    return {
      hits: lexicalHits,
      route: routeForSelectedIndex(selection, {
        fallbackReason: fallbackReason ?? "no_authorized_vector_hits",
        mode: "lexical_fallback",
        vectorStoreDriver,
        externalVectorStoreAttempted:
          externalVectorSearch.status !== "not_configured",
        externalVectorStoreUsed: externalVectorSearch.status === "used",
      }),
    };
  }

  return {
    hits: mergeHybridRetrievalHits({
      vectorHits: persistedHits,
      lexicalHits,
      maxResults,
    }),
    route: routeForSelectedIndex(selection, {
      ...(fallbackReason === undefined ? {} : { fallbackReason }),
      mode:
        externalVectorSearch.status === "used" ? "external_vector" : "pgvector",
      vectorStoreDriver,
      externalVectorStoreAttempted:
        externalVectorSearch.status !== "not_configured",
      externalVectorStoreUsed: externalVectorSearch.status === "used",
    }),
  };
}

async function searchExternalVectorStore(
  input: PersistedVectorRetrievalInput,
  selected: {
    dimensions: number;
    maxResults: number;
    model: string;
    providerId: string;
    queryEmbedding: number[];
  },
): Promise<
  | { status: "failed" }
  | { status: "not_configured" }
  | { hits: KnowledgeChunkEmbeddingSearchHit[]; status: "used" }
> {
  if (input.vectorStore === undefined) return { status: "not_configured" };
  try {
    return {
      status: "used",
      hits: await input.vectorStore.search({
        dimensions: selected.dimensions,
        embeddingModel: selected.model,
        embeddingProvider: selected.providerId,
        knowledgeBaseId: input.knowledgeBase.id,
        maxResults: selected.maxResults,
        orgId: input.knowledgeBase.orgId,
        queryEmbedding: selected.queryEmbedding,
        sourceIds: input.sources.map((source) => source.id),
        workspaceId: input.knowledgeBase.workspaceId,
      }),
    };
  } catch {
    return { status: "failed" };
  }
}

async function selectEmbeddingIndex(
  input: PersistedVectorRetrievalInput,
): Promise<
  EmbeddingIndexSelectionUnavailable | { selection: EmbeddingIndexSelection }
> {
  if (!hasScope(input.subject, "models:use"))
    return { fallbackReason: "missing_model_scope" };
  const embeddings = await input.repository.listKnowledgeChunkEmbeddings(
    input.knowledgeBase.id,
  );
  const ragPolicy = await readRagPolicy(
    input.repository,
    input.knowledgeBase.orgId,
  );
  const bestGroup = bestEmbeddingGroup(
    embeddings.filter((embedding) =>
      isEmbeddingProviderModelAllowed(
        ragPolicy,
        embedding.embeddingProvider,
        embedding.embeddingModel,
      ),
    ),
  );
  if (bestGroup === undefined)
    return { fallbackReason: "no_allowed_embedding_index" };

  const provider = await input.repository.getProvider(bestGroup.providerId);
  if (
    provider === undefined ||
    !provider.enabled ||
    provider.orgId !== input.knowledgeBase.orgId
  )
    return { fallbackReason: "embedding_provider_unavailable" };
  const grants = await input.repository.listResourceGrants(input.subject.orgId);
  if (!hasGrant(input.subject, grants, "provider", provider.id, "use"))
    return { fallbackReason: "embedding_provider_use_grant_missing" };
  return {
    selection: {
      policy: ragPolicy,
      provider,
      model: bestGroup.model,
      dimensions: bestGroup.dimensions,
    },
  };
}

function routeForSelectedIndex(
  selection: EmbeddingIndexSelection,
  route: {
    mode: KnowledgeRetrievalRoute["mode"];
    vectorStoreDriver: KnowledgeRetrievalRoute["vectorStoreDriver"];
    externalVectorStoreAttempted?: boolean;
    externalVectorStoreUsed?: boolean;
    fallbackReason?: KnowledgeRetrievalRouteFallbackReason;
  },
): KnowledgeRetrievalRoute {
  return {
    mode: route.mode,
    vectorStoreDriver: route.vectorStoreDriver,
    externalVectorStoreAttempted: route.externalVectorStoreAttempted ?? false,
    externalVectorStoreUsed: route.externalVectorStoreUsed ?? false,
    providerId: selection.provider.id,
    embeddingModel: selection.model,
    embeddingDimensions: selection.dimensions,
    ...(route.fallbackReason === undefined
      ? {}
      : { fallbackReason: route.fallbackReason }),
  };
}

function bestEmbeddingGroup(
  embeddings: KnowledgeChunkEmbedding[],
): { providerId: string; model: string; dimensions: number } | undefined {
  const groups = new Map<
    string,
    {
      count: number;
      latestUpdatedAt: string;
      providerId: string;
      model: string;
      dimensions: number;
    }
  >();
  for (const embedding of embeddings) {
    const key = `${embedding.embeddingProvider}\0${embedding.embeddingModel}\0${embedding.dimensions}`;
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, {
        count: 1,
        latestUpdatedAt: embedding.updatedAt,
        providerId: embedding.embeddingProvider,
        model: embedding.embeddingModel,
        dimensions: embedding.dimensions,
      });
      continue;
    }
    existing.count += 1;
    if (embedding.updatedAt > existing.latestUpdatedAt)
      existing.latestUpdatedAt = embedding.updatedAt;
  }
  return [...groups.values()].sort(
    (left, right) =>
      right.count - left.count ||
      right.latestUpdatedAt.localeCompare(left.latestUpdatedAt) ||
      left.providerId.localeCompare(right.providerId) ||
      left.model.localeCompare(right.model),
  )[0];
}
