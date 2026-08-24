import { knowledgeBases, knowledgeChunks, knowledgeSources } from "./schema";
import type {
  KnowledgeBaseRecord,
  KnowledgeChunkRecord,
  KnowledgeSourceRecord,
  KnowledgeSourceStatusRecord,
} from "./knowledge-repository";
import {
  optionalDate,
  optionalIsoString,
  toIsoString,
} from "./repository-mapping";

export function toKnowledgeBaseRecord(
  row: typeof knowledgeBases.$inferSelect,
): KnowledgeBaseRecord {
  const record: KnowledgeBaseRecord = {
    id: row.id,
    orgId: row.orgId,
    workspaceId: row.workspaceId,
    name: row.name,
    createdBy: row.createdBy,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
  const description = optionalIsoString(row.description);
  if (description !== undefined) record.description = description;
  return record;
}

export function toKnowledgeSourceRecord(
  row: typeof knowledgeSources.$inferSelect,
): KnowledgeSourceRecord {
  const record: KnowledgeSourceRecord = {
    id: row.id,
    knowledgeBaseId: row.knowledgeBaseId,
    orgId: row.orgId,
    workspaceId: row.workspaceId,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    status: asKnowledgeSourceStatus(row.status),
    metadata: asJsonRecord(row.metadata),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
  const objectKey = optionalIsoString(row.objectKey);
  if (objectKey !== undefined) record.objectKey = objectKey;
  if (row.chunkCount !== null) record.chunkCount = row.chunkCount;
  const contentHash = optionalIsoString(row.contentHash);
  if (contentHash !== undefined) record.contentHash = contentHash;
  const indexedAt = optionalIsoString(row.indexedAt);
  if (indexedAt !== undefined) record.indexedAt = indexedAt;
  if (
    row.extractionLeaseOwner !== null &&
    row.extractionLeaseToken !== null &&
    row.extractionLeaseExpiresAt !== null
  ) {
    record.extractionLease = {
      attempt: row.extractionAttempts,
      expiresAt: row.extractionLeaseExpiresAt.toISOString(),
      fencingToken: row.extractionFence,
      owner: row.extractionLeaseOwner,
      token: row.extractionLeaseToken,
    };
  }
  return record;
}

export function toKnowledgeChunkRecord(
  row: typeof knowledgeChunks.$inferSelect,
): KnowledgeChunkRecord {
  return {
    id: row.id,
    knowledgeBaseId: row.knowledgeBaseId,
    sourceId: row.sourceId,
    orgId: row.orgId,
    workspaceId: row.workspaceId,
    sequence: row.sequence,
    content: row.content,
    tokenCount: row.tokenCount,
    metadata: asJsonRecord(row.metadata),
    createdAt: toIsoString(row.createdAt),
  };
}

export function toKnowledgeBaseInsert(
  record: KnowledgeBaseRecord,
): typeof knowledgeBases.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    workspaceId: record.workspaceId,
    name: record.name,
    description: record.description ?? null,
    createdBy: record.createdBy,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

export function toKnowledgeSourceInsert(
  record: KnowledgeSourceRecord,
): typeof knowledgeSources.$inferInsert {
  return {
    id: record.id,
    knowledgeBaseId: record.knowledgeBaseId,
    orgId: record.orgId,
    workspaceId: record.workspaceId,
    fileName: record.fileName,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    status: record.status,
    objectKey: record.objectKey ?? null,
    chunkCount: record.chunkCount ?? null,
    contentHash: record.contentHash ?? null,
    indexedAt: optionalDate(record.indexedAt),
    metadata: record.metadata,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

export function toKnowledgeChunkInsert(
  record: KnowledgeChunkRecord,
): typeof knowledgeChunks.$inferInsert {
  return {
    id: record.id,
    knowledgeBaseId: record.knowledgeBaseId,
    sourceId: record.sourceId,
    orgId: record.orgId,
    workspaceId: record.workspaceId,
    sequence: record.sequence,
    content: record.content,
    tokenCount: record.tokenCount,
    metadata: record.metadata,
    createdAt: new Date(record.createdAt),
  };
}

function asKnowledgeSourceStatus(value: string): KnowledgeSourceStatusRecord {
  if (
    value === "extracting" ||
    value === "failed" ||
    value === "indexed" ||
    value === "pending"
  )
    return value;
  return "failed";
}

function asJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  return value as Record<string, unknown>;
}
