import { createHash } from "node:crypto";

import type {
  KnowledgeChunkEmbedding,
  KnowledgeChunkEmbeddingSearchHit,
} from "../domain/entities";
import type { KnowledgeVectorStoreSearchInput } from "./knowledge-vector-store";
import { vectorScopeToken } from "./vector-namespace";
import type { VectorNamespacePolicy } from "./vector-store-deployment";

type QdrantValue = boolean | number | string;
export interface QdrantFieldCondition {
  key: string;
  match: { any: QdrantValue[] } | { value: QdrantValue };
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

export function qdrantPayload(
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

export function qdrantSearchFilter(
  input: KnowledgeVectorStoreSearchInput,
  namespacePolicy: VectorNamespacePolicy,
  partitioningPolicy: VectorNamespacePolicy,
) {
  return {
    must: [
      ...qdrantScopeConditions(input, namespacePolicy, partitioningPolicy),
      fieldCondition("orgId", input.orgId),
      fieldCondition("workspaceId", input.workspaceId),
      fieldCondition("knowledgeBaseId", input.knowledgeBaseId),
      fieldCondition("embeddingProvider", input.embeddingProvider),
      fieldCondition("embeddingModel", input.embeddingModel),
      fieldCondition("dimensions", input.dimensions),
      { key: "sourceId", match: { any: input.sourceIds } },
    ],
  };
}

export function qdrantScopeConditions(
  input: { knowledgeBaseId: string; orgId: string; workspaceId: string },
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

export function fieldCondition(
  key: string,
  value: QdrantValue,
): QdrantFieldCondition {
  return { key, match: { value } };
}

export function qdrantSearchHits(
  response: unknown,
): KnowledgeChunkEmbeddingSearchHit[] {
  const rawPoints = asRecord(response)?.points;
  const points: unknown[] = Array.isArray(rawPoints) ? rawPoints : [];
  return points.flatMap((point): KnowledgeChunkEmbeddingSearchHit[] => {
    const record = asRecord(point);
    const payload = asRecord(record?.payload);
    const required = {
      chunkId: stringPayload(payload, "chunkId"),
      knowledgeBaseId: stringPayload(payload, "knowledgeBaseId"),
      sourceId: stringPayload(payload, "sourceId"),
      orgId: stringPayload(payload, "orgId"),
      workspaceId: stringPayload(payload, "workspaceId"),
      embeddingProvider: stringPayload(payload, "embeddingProvider"),
      embeddingModel: stringPayload(payload, "embeddingModel"),
      dimensions: numberPayload(payload, "dimensions"),
    };
    const score = typeof record?.score === "number" ? record.score : undefined;
    if (
      Object.values(required).some((value) => value === undefined) ||
      score === undefined
    )
      return [];
    const value = required as Record<keyof typeof required, string | number>;
    const now = new Date(0).toISOString();
    return [
      {
        embedding: {
          id: `qdrant_${qdrantPointIdForChunkId(String(value.chunkId))}`,
          knowledgeBaseId: String(value.knowledgeBaseId),
          sourceId: String(value.sourceId),
          chunkId: String(value.chunkId),
          orgId: String(value.orgId),
          workspaceId: String(value.workspaceId),
          embeddingProvider: String(value.embeddingProvider),
          embeddingModel: String(value.embeddingModel),
          dimensions: Number(value.dimensions),
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

export function boundedQdrantLimit(limit: number): number {
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
) {
  const value = payload?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberPayload(
  payload: Record<string, unknown> | undefined,
  key: string,
) {
  const value = payload?.[key];
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}
