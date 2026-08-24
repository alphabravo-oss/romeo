import type { WorkLease } from "./work-leases";

export type ContentDeletionTargetType = "file_object" | "knowledge_source";
export type ContentDeletionStatus =
  | "pending"
  | "processing"
  | "failed"
  | "blocked"
  | "completed";

/** Internal outbox record. Object keys and target generations are never public. */
export interface ContentDeletionOperation {
  id: string;
  orgId: string;
  workspaceId: string;
  targetType: ContentDeletionTargetType;
  targetId: string;
  targetGeneration: string;
  idempotencyKey: string;
  status: ContentDeletionStatus;
  externalVectorVerificationRequired: boolean;
  objectKey?: string;
  knowledgeBaseId?: string;
  requestedByType: "service_account" | "user";
  requestedById: string;
  attempts: number;
  nextAttemptAt?: string;
  failureCode?: string;
  legalHoldEvaluatedAt: string;
  objectDeletedAt?: string;
  objectVerifiedAt?: string;
  vectorsDeletedAt?: string;
  vectorsVerifiedAt?: string;
  relationalDeletedAt?: string;
  attestedAt?: string;
  lease?: WorkLease;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface ClaimContentDeletionInput {
  orgId: string;
  leaseOwner: string;
  leaseToken: string;
  leaseExpiresAt: string;
  now: string;
}

export interface UpdateContentDeletionWithLeaseInput {
  operation: ContentDeletionOperation;
  leaseOwner: string;
  leaseToken: string;
  fencingToken: number;
  now: string;
}

export interface RenewContentDeletionLeaseInput {
  orgId: string;
  operationId: string;
  leaseOwner: string;
  leaseToken: string;
  fencingToken: number;
  leaseExpiresAt: string;
  now: string;
}
