import { createHash } from "node:crypto";

import type { RomeoEnv } from "@romeo/config";

import type {
  KnowledgeChunkEmbedding,
  KnowledgeChunkEmbeddingSearchHit,
} from "../domain/entities";
import { ApiError } from "../errors";
import type { SecretResolver } from "./secret-resolver";
import type {
  KnowledgeVectorStore,
  KnowledgeVectorStoreReadinessProbe,
  KnowledgeVectorStoreReadinessReport,
  KnowledgeVectorStoreSearchInput,
} from "./knowledge-vector-store";
import { vectorScopeToken } from "./vector-namespace";
import {
  type VectorNamespacePolicy,
  vectorStoreDeploymentFromEnv,
} from "./vector-store-deployment";

type QdrantValue = boolean | number | string;

interface QdrantFieldCondition {
  key: string;
  match: { any: QdrantValue[] } | { value: QdrantValue };
}

interface QdrantFilter {
  must: QdrantFieldCondition[];
}

interface QdrantPoint {
  id: string;
  payload: Record<string, QdrantValue>;
  vector: number[];
}

type QdrantOperation = "delete" | "health" | "query" | "upsert";

export class QdrantKnowledgeVectorStore
  implements KnowledgeVectorStore, KnowledgeVectorStoreReadinessProbe
{
  private readonly collection: string;
  private readonly fetchImpl: typeof fetch;
  private readonly namespacePolicy: VectorNamespacePolicy;
  private readonly partitioningPolicy: VectorNamespacePolicy;
  private readonly timeoutMs: number;
  private readonly url: string;

  constructor(
    options: {
      apiKeyRef: string;
      collection: string;
      fetchImpl?: typeof fetch;
      namespacePolicy: VectorNamespacePolicy;
      partitioningPolicy: VectorNamespacePolicy;
      secretResolver: SecretResolver;
      timeoutMs: number;
      url: string;
    },
  ) {
    this.collection = options.collection;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.namespacePolicy = options.namespacePolicy;
    this.partitioningPolicy = options.partitioningPolicy;
    this.timeoutMs = options.timeoutMs;
    this.url = options.url;
    this.apiKeyRef = options.apiKeyRef;
    this.secretResolver = options.secretResolver;
  }

  private readonly apiKeyRef: string;
  private readonly secretResolver: SecretResolver;

  async upsertEmbeddings(embeddings: KnowledgeChunkEmbedding[]): Promise<void> {
    if (embeddings.length === 0) return;
    await this.request("upsert", `points?wait=true`, {
      points: embeddings.map((embedding): QdrantPoint => ({
        id: qdrantPointIdForChunkId(embedding.chunkId),
        vector: embedding.embedding,
        payload: qdrantPayload(
          embedding,
          this.namespacePolicy,
          this.partitioningPolicy,
        ),
      })),
    });
  }

  async search(
    input: KnowledgeVectorStoreSearchInput,
  ): Promise<KnowledgeChunkEmbeddingSearchHit[]> {
    if (input.sourceIds.length === 0) return [];
    const response = await this.request("query", "points/query", {
      query: input.queryEmbedding,
      filter: qdrantSearchFilter(
        input,
        this.namespacePolicy,
        this.partitioningPolicy,
      ),
      limit: boundedLimit(input.maxResults),
      with_payload: true,
      with_vector: false,
    });
    return qdrantSearchHits(response);
  }

  async deleteEmbeddingsForSource(input: {
    knowledgeBaseId: string;
    orgId: string;
    sourceId: string;
    workspaceId: string;
  }): Promise<void> {
    await this.request("delete", "points/delete?wait=true", {
      filter: {
        must: [
          ...qdrantScopeConditions(
            input,
            this.namespacePolicy,
            this.partitioningPolicy,
          ),
          fieldCondition("orgId", input.orgId),
          fieldCondition("workspaceId", input.workspaceId),
          fieldCondition("knowledgeBaseId", input.knowledgeBaseId),
          fieldCondition("sourceId", input.sourceId),
        ],
      },
    });
  }

  async checkReadiness(): Promise<KnowledgeVectorStoreReadinessReport> {
    try {
      const response = await this.request("health", "", undefined);
      const result = asRecord(response)?.result;
      return {
        status: "available",
        ...stringDetail(result, "status", "collectionStatus"),
        ...stringDetail(result, "optimizer_status", "optimizerStatus"),
      };
    } catch (caught) {
      return qdrantReadinessUnavailable(caught);
    }
  }

  private async request(
    operation: QdrantOperation,
    path: string,
    body: unknown | undefined,
  ): Promise<unknown> {
    const apiKey = await this.resolveApiKey(operation);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = { "api-key": apiKey };
      if (body !== undefined) headers["content-type"] = "application/json";
      const response = await this.fetchImpl(
        qdrantUrl(this.url, this.collection, path),
        {
          method: qdrantMethod(operation),
          headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        throw qdrantUnavailable(operation, {
          status: response.status,
          statusText: response.statusText,
        });
      }
      const text = await response.text();
      if (text.length === 0) return {};
      try {
        return JSON.parse(text);
      } catch {
        throw qdrantUnavailable(operation, { failureCode: "invalid_json" });
      }
    } catch (caught) {
      if (caught instanceof ApiError) throw caught;
      const failureCode =
        caught instanceof Error && caught.name === "AbortError"
          ? "timeout"
          : "request_failed";
      throw qdrantUnavailable(operation, { failureCode });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async resolveApiKey(operation: QdrantOperation): Promise<string> {
    if (this.secretResolver.resolveValue === undefined) {
      throw qdrantUnavailable(operation, {
        failureCode: "secret_resolver_value_unavailable",
      });
    }
    const resolved = await this.secretResolver.resolveValue(this.apiKeyRef);
    if (!resolved.available || resolved.value === undefined) {
      throw qdrantUnavailable(operation, {
        failureCode: resolved.failureCode ?? "secret_unavailable",
        secretRefScheme: resolved.scheme,
      });
    }
    return resolved.value;
  }
}

export function createQdrantKnowledgeVectorStore(
  env: RomeoEnv,
  secretResolver: SecretResolver,
  fetchImpl?: typeof fetch,
): (KnowledgeVectorStore & KnowledgeVectorStoreReadinessProbe) | undefined {
  const deployment = vectorStoreDeploymentFromEnv(env);
  if (!deployment.externalVectorStore.configured) return undefined;
  return new QdrantKnowledgeVectorStore({
    apiKeyRef: env.QDRANT_API_KEY_REF,
    collection: env.QDRANT_COLLECTION,
    namespacePolicy: deployment.externalVectorStore.namespacePolicy,
    partitioningPolicy: deployment.externalVectorStore.partitioningPolicy,
    secretResolver,
    timeoutMs: env.QDRANT_TIMEOUT_MS,
    url: env.QDRANT_URL,
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
  });
}

export function qdrantPointIdForChunkId(chunkId: string): string {
  const bytes = createHash("sha256").update(`romeo-qdrant:${chunkId}`).digest();
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

function qdrantPayload(
  embedding: KnowledgeChunkEmbedding,
  namespacePolicy: VectorNamespacePolicy,
  partitioningPolicy: VectorNamespacePolicy,
): Record<string, QdrantValue> {
  const payload: Record<string, QdrantValue> = {
    chunkId: embedding.chunkId,
    dimensions: embedding.dimensions,
    embeddingModel: embedding.embeddingModel,
    embeddingProvider: embedding.embeddingProvider,
    knowledgeBaseId: embedding.knowledgeBaseId,
    orgId: embedding.orgId,
    sourceId: embedding.sourceId,
    workspaceId: embedding.workspaceId,
  };
  const namespace = vectorScopeToken(namespacePolicy, embedding);
  if (namespace !== undefined) payload.romeoNamespace = namespace;
  const partition = vectorScopeToken(partitioningPolicy, embedding);
  if (partition !== undefined) payload.romeoPartition = partition;
  return payload;
}

function qdrantSearchFilter(
  input: KnowledgeVectorStoreSearchInput,
  namespacePolicy: VectorNamespacePolicy,
  partitioningPolicy: VectorNamespacePolicy,
): QdrantFilter {
  return {
    must: [
      ...qdrantScopeConditions(input, namespacePolicy, partitioningPolicy),
      fieldCondition("orgId", input.orgId),
      fieldCondition("workspaceId", input.workspaceId),
      fieldCondition("knowledgeBaseId", input.knowledgeBaseId),
      fieldCondition("embeddingProvider", input.embeddingProvider),
      fieldCondition("embeddingModel", input.embeddingModel),
      fieldCondition("dimensions", input.dimensions),
      {
        key: "sourceId",
        match: { any: input.sourceIds },
      },
    ],
  };
}

function qdrantScopeConditions(
  input: {
    knowledgeBaseId: string;
    orgId: string;
    workspaceId: string;
  },
  namespacePolicy: VectorNamespacePolicy,
  partitioningPolicy: VectorNamespacePolicy,
): QdrantFieldCondition[] {
  const conditions: QdrantFieldCondition[] = [];
  const namespace = vectorScopeToken(namespacePolicy, input);
  if (namespace !== undefined)
    conditions.push(fieldCondition("romeoNamespace", namespace));
  const partition = vectorScopeToken(partitioningPolicy, input);
  if (partition !== undefined)
    conditions.push(fieldCondition("romeoPartition", partition));
  return conditions;
}

function fieldCondition(key: string, value: QdrantValue): QdrantFieldCondition {
  return { key, match: { value } };
}

function qdrantSearchHits(
  response: unknown,
): KnowledgeChunkEmbeddingSearchHit[] {
  const result = asRecord(response)?.result;
  const rawPoints = asRecord(result)?.points;
  const points: unknown[] = Array.isArray(rawPoints) ? rawPoints : [];
  return points.flatMap((point): KnowledgeChunkEmbeddingSearchHit[] => {
    const record = asRecord(point);
    const payload = asRecord(record?.payload);
    const chunkId = stringPayload(payload, "chunkId");
    const knowledgeBaseId = stringPayload(payload, "knowledgeBaseId");
    const sourceId = stringPayload(payload, "sourceId");
    const orgId = stringPayload(payload, "orgId");
    const workspaceId = stringPayload(payload, "workspaceId");
    const embeddingProvider = stringPayload(payload, "embeddingProvider");
    const embeddingModel = stringPayload(payload, "embeddingModel");
    const dimensions = numberPayload(payload, "dimensions");
    const score = typeof record?.score === "number" ? record.score : undefined;
    if (
      chunkId === undefined ||
      knowledgeBaseId === undefined ||
      sourceId === undefined ||
      orgId === undefined ||
      workspaceId === undefined ||
      embeddingProvider === undefined ||
      embeddingModel === undefined ||
      dimensions === undefined ||
      score === undefined
    ) {
      return [];
    }
    const now = new Date(0).toISOString();
    return [
      {
        embedding: {
          id: `qdrant_${qdrantPointIdForChunkId(chunkId)}`,
          knowledgeBaseId,
          sourceId,
          chunkId,
          orgId,
          workspaceId,
          embeddingProvider,
          embeddingModel,
          dimensions,
          embedding: [],
          metadata: { externalVectorStore: "qdrant" },
          createdAt: now,
          updatedAt: now,
        },
        score,
      },
    ];
  });
}

function qdrantUrl(baseUrl: string, collection: string, path: string): string {
  const suffix = path.length === 0 ? "" : `/${path}`;
  const url = new URL(
    `/collections/${encodeURIComponent(collection)}${suffix}`,
    baseUrl,
  );
  return url.toString();
}

function qdrantMethod(operation: QdrantOperation): "GET" | "POST" | "PUT" {
  if (operation === "health") return "GET";
  if (operation === "upsert") return "PUT";
  return "POST";
}

function boundedLimit(limit: number): number {
  return Math.min(Math.max(Math.trunc(limit), 1), 100);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringPayload(
  payload: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = payload?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberPayload(
  payload: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const value = payload?.[key];
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function stringDetail(
  source: unknown,
  sourceKey: string,
  targetKey: "collectionStatus" | "failureCode" | "optimizerStatus",
): Partial<KnowledgeVectorStoreReadinessReport> {
  const value = asRecord(source)?.[sourceKey];
  return typeof value === "string" && value.length > 0
    ? { [targetKey]: value }
    : {};
}

function numberDetail(
  source: unknown,
  sourceKey: string,
  targetKey: "httpStatus",
): Partial<KnowledgeVectorStoreReadinessReport> {
  const value = asRecord(source)?.[sourceKey];
  return typeof value === "number" && Number.isInteger(value)
    ? { [targetKey]: value }
    : {};
}

function qdrantReadinessUnavailable(
  caught: unknown,
): KnowledgeVectorStoreReadinessReport {
  if (caught instanceof ApiError) {
    const httpStatus = numberDetail(caught.details, "status", "httpStatus");
    const failureCode =
      stringDetail(caught.details, "failureCode", "failureCode").failureCode ??
      qdrantFailureCodeFromStatus(httpStatus.httpStatus);
    return {
      status: "unavailable",
      failureCode,
      ...httpStatus,
    };
  }
  return { status: "unavailable", failureCode: "request_failed" };
}

function qdrantFailureCodeFromStatus(status: number | undefined): string {
  if (status === 404) return "collection_not_found";
  if (status === 401 || status === 403) return "access_denied";
  return "request_failed";
}

function qdrantUnavailable(
  operation: QdrantOperation,
  details: Record<string, unknown>,
): ApiError {
  return new ApiError(
    "qdrant_vector_store_unavailable",
    "External Qdrant vector store is unavailable.",
    503,
    {
      operation,
      ...details,
    },
  );
}
