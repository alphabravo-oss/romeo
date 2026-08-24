import type { ContentDeletionOperation } from "@romeo/core";

import { contentDeletionOperations } from "./schema";
import { optionalIsoString, toIsoString } from "./repository-mapping";

type Row = typeof contentDeletionOperations.$inferSelect;

export function toContentDeletionOperation(row: Row): ContentDeletionOperation {
  const operation: ContentDeletionOperation = {
    id: row.id,
    orgId: row.orgId,
    workspaceId: row.workspaceId,
    targetType: row.targetType as ContentDeletionOperation["targetType"],
    targetId: row.targetId,
    targetGeneration: row.targetGeneration,
    idempotencyKey: row.idempotencyKey,
    status: row.status as ContentDeletionOperation["status"],
    externalVectorVerificationRequired: row.externalVectorVerificationRequired,
    requestedByType:
      row.requestedByType as ContentDeletionOperation["requestedByType"],
    requestedById: row.requestedById,
    attempts: row.attempts,
    legalHoldEvaluatedAt: toIsoString(row.legalHoldEvaluatedAt),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
  for (const [key, value] of [
    ["objectKey", row.objectKey],
    ["knowledgeBaseId", row.knowledgeBaseId],
    ["nextAttemptAt", optionalIsoString(row.nextAttemptAt)],
    ["failureCode", row.failureCode],
    ["objectDeletedAt", optionalIsoString(row.objectDeletedAt)],
    ["objectVerifiedAt", optionalIsoString(row.objectVerifiedAt)],
    ["vectorsDeletedAt", optionalIsoString(row.vectorsDeletedAt)],
    ["vectorsVerifiedAt", optionalIsoString(row.vectorsVerifiedAt)],
    ["relationalDeletedAt", optionalIsoString(row.relationalDeletedAt)],
    ["attestedAt", optionalIsoString(row.attestedAt)],
    ["completedAt", optionalIsoString(row.completedAt)],
  ] as const) {
    if (value !== null && value !== undefined)
      Object.assign(operation, { [key]: value });
  }
  if (
    row.leaseOwner !== null &&
    row.leaseToken !== null &&
    row.leaseExpiresAt !== null
  ) {
    operation.lease = {
      attempt: row.attempts,
      expiresAt: toIsoString(row.leaseExpiresAt),
      fencingToken: row.leaseFence,
      owner: row.leaseOwner,
      token: row.leaseToken,
    };
  }
  return operation;
}

export function toContentDeletionInsert(operation: ContentDeletionOperation) {
  return {
    id: operation.id,
    orgId: operation.orgId,
    workspaceId: operation.workspaceId,
    targetType: operation.targetType,
    targetId: operation.targetId,
    targetGeneration: operation.targetGeneration,
    idempotencyKey: operation.idempotencyKey,
    status: operation.status,
    externalVectorVerificationRequired:
      operation.externalVectorVerificationRequired,
    objectKey: operation.objectKey ?? null,
    knowledgeBaseId: operation.knowledgeBaseId ?? null,
    requestedByType: operation.requestedByType,
    requestedById: operation.requestedById,
    attempts: operation.attempts,
    nextAttemptAt: date(operation.nextAttemptAt),
    failureCode: operation.failureCode ?? null,
    legalHoldEvaluatedAt: new Date(operation.legalHoldEvaluatedAt),
    objectDeletedAt: date(operation.objectDeletedAt),
    objectVerifiedAt: date(operation.objectVerifiedAt),
    vectorsDeletedAt: date(operation.vectorsDeletedAt),
    vectorsVerifiedAt: date(operation.vectorsVerifiedAt),
    relationalDeletedAt: date(operation.relationalDeletedAt),
    attestedAt: date(operation.attestedAt),
    leaseOwner: operation.lease?.owner ?? null,
    leaseToken: operation.lease?.token ?? null,
    leaseExpiresAt: date(operation.lease?.expiresAt),
    leaseFence: operation.lease?.fencingToken ?? 0,
    createdAt: new Date(operation.createdAt),
    updatedAt: new Date(operation.updatedAt),
    completedAt: date(operation.completedAt),
  };
}

function date(value?: string): Date | null {
  return value === undefined ? null : new Date(value);
}
