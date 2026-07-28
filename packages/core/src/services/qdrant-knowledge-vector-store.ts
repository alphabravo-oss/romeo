import { createHash } from "node:crypto";

import {
  QdrantClient,
  QdrantClientResourceExhaustedError,
  QdrantClientTimeoutError,
  QdrantClientUnexpectedResponseError,
} from "@qdrant/js-client-rest";
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

export type QdrantSdkClient = Pick<
  QdrantClient,
  "delete" | "getCollection" | "query" | "upsert"
>;
export interface QdrantSdkClientOptions {
  apiKey: string;
  timeoutMs: number;
  url: string;
}
export type QdrantSdkClientFactory = (
  options: QdrantSdkClientOptions,
) => QdrantSdkClient;

const defaultQdrantSdkClientFactory: QdrantSdkClientFactory = (options) =>
  new QdrantClient({
    apiKey: options.apiKey,
    checkCompatibility: false,
    timeout: options.timeoutMs,
    url: options.url,
  });

export class QdrantKnowledgeVectorStore
  implements KnowledgeVectorStore, KnowledgeVectorStoreReadinessProbe
{
  private readonly collection: string;
  private readonly clientFactory: QdrantSdkClientFactory;
  private readonly namespacePolicy: VectorNamespacePolicy;
  private readonly partitioningPolicy: VectorNamespacePolicy;
  private readonly timeoutMs: number;
  private readonly url: string;

  constructor(options: {
    apiKeyRef: string;
    clientFactory?: QdrantSdkClientFactory;
    collection: string;
    namespacePolicy: VectorNamespacePolicy;
    partitioningPolicy: VectorNamespacePolicy;
    secretResolver: SecretResolver;
    timeoutMs: number;
    url: string;
  }) {
    this.collection = options.collection;
    this.clientFactory = options.clientFactory ?? defaultQdrantSdkClientFactory;
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
    await this.withClient("upsert", (client) =>
      client.upsert(this.collection, {
        wait: true,
        points: embeddings.map(
          (embedding): QdrantPoint => ({
            id: qdrantPointIdForChunkId(embedding.chunkId),
            vector: embedding.embedding,
            payload: qdrantPayload(
              embedding,
              this.namespacePolicy,
              this.partitioningPolicy,
            ),
          }),
        ),
      }),
    );
  }

  async search(
    input: KnowledgeVectorStoreSearchInput,
  ): Promise<KnowledgeChunkEmbeddingSearchHit[]> {
    if (input.sourceIds.length === 0) return [];
    const response = await this.withClient("query", (client) =>
      client.query(this.collection, {
        query: input.queryEmbedding,
        filter: qdrantSearchFilter(
          input,
          this.namespacePolicy,
          this.partitioningPolicy,
        ),
        limit: boundedLimit(input.maxResults),
        with_payload: true,
        with_vector: false,
      }),
    );
    return qdrantSearchHits(response);
  }

  async deleteEmbeddingsForSource(input: {
    knowledgeBaseId: string;
    orgId: string;
    sourceId: string;
    workspaceId: string;
  }): Promise<void> {
    await this.withClient("delete", (client) =>
      client.delete(this.collection, {
        wait: true,
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
      }),
    );
  }

  async checkReadiness(): Promise<KnowledgeVectorStoreReadinessReport> {
    try {
      const result = await this.withClient("health", (client) =>
        client.getCollection(this.collection),
      );
      return {
        status: "available",
        ...stringDetail(result, "status", "collectionStatus"),
        ...stringDetail(result, "optimizer_status", "optimizerStatus"),
      };
    } catch (caught) {
      return qdrantReadinessUnavailable(caught);
    }
  }

  private async withClient<T>(
    operation: QdrantOperation,
    execute: (client: QdrantSdkClient) => Promise<T>,
  ): Promise<T> {
    const apiKey = await this.resolveApiKey(operation);
    try {
      return await execute(
        this.clientFactory({
          apiKey,
          timeoutMs: this.timeoutMs,
          url: this.url,
        }),
      );
    } catch (caught) {
      if (caught instanceof ApiError) throw caught;
      throw qdrantUnavailable(operation, qdrantSdkFailureDetails(caught));
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
  clientFactory?: QdrantSdkClientFactory,
): (KnowledgeVectorStore & KnowledgeVectorStoreReadinessProbe) | undefined {
  const deployment = vectorStoreDeploymentFromEnv(env);
  if (!deployment.externalVectorStore.configured) return undefined;
  return new QdrantKnowledgeVectorStore({
    apiKeyRef: env.QDRANT_API_KEY_REF,
    ...(clientFactory === undefined ? {} : { clientFactory }),
    collection: env.QDRANT_COLLECTION,
    namespacePolicy: deployment.externalVectorStore.namespacePolicy,
    partitioningPolicy: deployment.externalVectorStore.partitioningPolicy,
    secretResolver,
    timeoutMs: env.QDRANT_TIMEOUT_MS,
    url: env.QDRANT_URL,
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
  const rawPoints = asRecord(response)?.points;
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

function qdrantSdkFailureDetails(caught: unknown): Record<string, unknown> {
  if (caught instanceof QdrantClientTimeoutError) {
    return { failureCode: "timeout", sdkError: caught.name };
  }
  if (caught instanceof QdrantClientResourceExhaustedError) {
    return {
      failureCode: "resource_exhausted",
      retryAfterSeconds: caught.retry_after,
      sdkError: caught.name,
    };
  }
  if (caught instanceof QdrantClientUnexpectedResponseError) {
    const status = qdrantStatusFromSdkError(caught.message);
    return {
      failureCode: qdrantFailureCodeFromStatus(status),
      ...(status === undefined ? {} : { status }),
      sdkError: caught.name,
    };
  }
  return {
    failureCode: "request_failed",
    ...(caught instanceof Error ? { sdkError: caught.name } : {}),
  };
}

function qdrantStatusFromSdkError(message: string): number | undefined {
  const match = /Unexpected Response:\s+(\d{3})\b/u.exec(message);
  if (match === null) return undefined;
  const status = Number(match[1]);
  return Number.isInteger(status) ? status : undefined;
}
