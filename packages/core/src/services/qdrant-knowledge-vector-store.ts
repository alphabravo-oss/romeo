import {
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
import {
  defaultQdrantSdkClientFactory,
  BoundedQdrantSdkClientPool,
  type QdrantSdkClient,
  type QdrantSdkClientFactory,
  type QdrantSdkClientProvider,
} from "./qdrant-sdk-client";
import type {
  KnowledgeVectorStore,
  KnowledgeVectorStoreReadinessProbe,
  KnowledgeVectorStoreReadinessReport,
  KnowledgeVectorStoreSearchInput,
} from "./knowledge-vector-store";
import {
  boundedQdrantLimit,
  fieldCondition,
  qdrantPointIdForChunkId,
  qdrantPayload,
  qdrantScopeConditions,
  qdrantSearchFilter,
  qdrantSearchHits,
} from "./qdrant-vector-mapping";
export { qdrantPointIdForChunkId } from "./qdrant-vector-mapping";
import {
  type VectorNamespacePolicy,
  vectorStoreDeploymentFromEnv,
} from "./vector-store-deployment";

type QdrantOperation =
  | "delete"
  | "health"
  | "query"
  | "upsert"
  | "verify_delete";

export type {
  QdrantSdkClient,
  QdrantSdkClientFactory,
} from "./qdrant-sdk-client";

export class QdrantKnowledgeVectorStore
  implements KnowledgeVectorStore, KnowledgeVectorStoreReadinessProbe
{
  private readonly collection: string;
  private readonly clientProvider: QdrantSdkClientProvider;
  private readonly namespacePolicy: VectorNamespacePolicy;
  private readonly partitioningPolicy: VectorNamespacePolicy;
  private readonly timeoutMs: number;
  private readonly url: string;

  constructor(options: {
    apiKeyRef: string;
    clientFactory?: QdrantSdkClientFactory;
    clientProvider?: QdrantSdkClientProvider;
    collection: string;
    namespacePolicy: VectorNamespacePolicy;
    partitioningPolicy: VectorNamespacePolicy;
    secretResolver: SecretResolver;
    timeoutMs: number;
    url: string;
  }) {
    this.collection = options.collection;
    this.clientProvider =
      options.clientProvider ??
      new BoundedQdrantSdkClientPool(
        options.clientFactory ?? defaultQdrantSdkClientFactory,
      );
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
        points: embeddings.map((embedding) => ({
          id: qdrantPointIdForChunkId(embedding.chunkId),
          vector: embedding.embedding,
          payload: qdrantPayload(
            embedding,
            this.namespacePolicy,
            this.partitioningPolicy,
          ),
        })),
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
        limit: boundedQdrantLimit(input.maxResults),
        with_payload: true,
        with_vector: false,
      }),
    );
    return qdrantSearchHits(response);
  }

  async deleteEmbeddingsForOrg(input: { orgId: string }): Promise<void> {
    await this.withClient("delete", (client) =>
      client.delete(this.collection, {
        wait: true,
        filter: {
          must: [fieldCondition("orgId", input.orgId)],
        },
      }),
    );
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

  async verifyEmbeddingsAbsentForSource(input: {
    knowledgeBaseId: string;
    orgId: string;
    sourceId: string;
    workspaceId: string;
  }): Promise<boolean> {
    const response = await this.withClient("verify_delete", (client) =>
      client.scroll(this.collection, {
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
        limit: 1,
        with_payload: false,
        with_vector: false,
      }),
    );
    return response.points.length === 0;
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
        this.clientProvider.client({
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
  clientProvider?: QdrantSdkClientProvider,
): (KnowledgeVectorStore & KnowledgeVectorStoreReadinessProbe) | undefined {
  const deployment = vectorStoreDeploymentFromEnv(env);
  if (!deployment.externalVectorStore.configured) return undefined;
  return new QdrantKnowledgeVectorStore({
    apiKeyRef: env.QDRANT_API_KEY_REF,
    ...(clientFactory === undefined ? {} : { clientFactory }),
    ...(clientProvider === undefined ? {} : { clientProvider }),
    collection: env.QDRANT_COLLECTION,
    namespacePolicy: deployment.externalVectorStore.namespacePolicy,
    partitioningPolicy: deployment.externalVectorStore.partitioningPolicy,
    secretResolver,
    timeoutMs: env.QDRANT_TIMEOUT_MS,
    url: env.QDRANT_URL,
  });
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
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
