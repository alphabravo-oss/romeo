import type {
  ClaimContentDeletionInput,
  ContentDeletionOperation,
  UpdateContentDeletionWithLeaseInput,
  RenewContentDeletionLeaseInput,
} from "../domain/content-deletion";
import { append, replaceById } from "./collection-helpers";
import { InMemoryContentPolicyRepository } from "./in-memory-content-policy";

export abstract class InMemoryContentDeletionRepository extends InMemoryContentPolicyRepository {
  async createContentDeletionOperation(
    operation: ContentDeletionOperation,
  ): Promise<ContentDeletionOperation> {
    const existing = this.data.contentDeletionOperations.find(
      (candidate) =>
        candidate.orgId === operation.orgId &&
        candidate.idempotencyKey === operation.idempotencyKey,
    );
    if (existing !== undefined) return existing;
    return append(this.data.contentDeletionOperations, operation);
  }

  async getContentDeletionOperation(
    orgId: string,
    operationId: string,
  ): Promise<ContentDeletionOperation | undefined> {
    return this.data.contentDeletionOperations.find(
      (operation) => operation.orgId === orgId && operation.id === operationId,
    );
  }

  async getActiveContentDeletionOperation(
    orgId: string,
    targetType: ContentDeletionOperation["targetType"],
    targetId: string,
  ): Promise<ContentDeletionOperation | undefined> {
    return this.data.contentDeletionOperations.find(
      (operation) =>
        operation.orgId === orgId &&
        operation.targetType === targetType &&
        operation.targetId === targetId &&
        operation.status !== "completed",
    );
  }

  async claimContentDeletionOperation(
    input: ClaimContentDeletionInput,
  ): Promise<ContentDeletionOperation | undefined> {
    const candidate = this.data.contentDeletionOperations
      .filter((operation) => operation.orgId === input.orgId)
      .filter(
        (operation) =>
          operation.status === "pending" ||
          (operation.status === "failed" &&
            (operation.nextAttemptAt === undefined ||
              operation.nextAttemptAt <= input.now)) ||
          (operation.status === "processing" &&
            operation.lease !== undefined &&
            operation.lease.expiresAt <= input.now),
      )
      .sort((left, right) =>
        left.createdAt === right.createdAt
          ? left.id.localeCompare(right.id)
          : left.createdAt.localeCompare(right.createdAt),
      )[0];
    if (candidate === undefined) return undefined;
    const claimed: ContentDeletionOperation = {
      ...candidate,
      status: "processing",
      attempts: candidate.attempts + 1,
      updatedAt: input.now,
      lease: {
        attempt: candidate.attempts + 1,
        expiresAt: input.leaseExpiresAt,
        fencingToken: (candidate.lease?.fencingToken ?? 0) + 1,
        owner: input.leaseOwner,
        token: input.leaseToken,
      },
    };
    return replaceById(this.data.contentDeletionOperations, claimed);
  }

  async updateContentDeletionOperationWithLease(
    input: UpdateContentDeletionWithLeaseInput,
  ): Promise<ContentDeletionOperation | undefined> {
    const current = this.data.contentDeletionOperations.find(
      (operation) =>
        operation.orgId === input.operation.orgId &&
        operation.id === input.operation.id,
    );
    if (
      current?.lease === undefined ||
      current.lease.owner !== input.leaseOwner ||
      current.lease.token !== input.leaseToken ||
      current.lease.fencingToken !== input.fencingToken ||
      current.lease.expiresAt <= input.now
    )
      return undefined;
    assertImmutableTarget(current, input.operation);
    const updated: ContentDeletionOperation = {
      ...input.operation,
      updatedAt: input.now,
    };
    if (input.operation.status === "processing") updated.lease = current.lease;
    else delete updated.lease;
    return replaceById(this.data.contentDeletionOperations, updated);
  }

  async renewContentDeletionOperationLease(
    input: RenewContentDeletionLeaseInput,
  ): Promise<ContentDeletionOperation | undefined> {
    const current = this.data.contentDeletionOperations.find(
      (operation) =>
        operation.orgId === input.orgId && operation.id === input.operationId,
    );
    if (
      current?.lease === undefined ||
      current.lease.owner !== input.leaseOwner ||
      current.lease.token !== input.leaseToken ||
      current.lease.fencingToken !== input.fencingToken ||
      current.lease.expiresAt <= input.now
    )
      return undefined;
    return replaceById(this.data.contentDeletionOperations, {
      ...current,
      updatedAt: input.now,
      lease: { ...current.lease, expiresAt: input.leaseExpiresAt },
    });
  }
}

function assertImmutableTarget(
  current: ContentDeletionOperation,
  next: ContentDeletionOperation,
): void {
  for (const key of [
    "id",
    "orgId",
    "workspaceId",
    "targetType",
    "targetId",
    "targetGeneration",
    "idempotencyKey",
    "objectKey",
    "knowledgeBaseId",
    "requestedByType",
    "requestedById",
    "createdAt",
  ] as const) {
    if (current[key] !== next[key])
      throw new Error(`content_deletion_immutable_${key}`);
  }
}
