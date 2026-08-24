import type {
  ClaimContentDeletionInput,
  ContentDeletionOperation,
  UpdateContentDeletionWithLeaseInput,
  RenewContentDeletionLeaseInput,
} from "@romeo/core";
import { and, asc, eq, gt, isNull, lte, ne, or } from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import {
  toContentDeletionInsert,
  toContentDeletionOperation,
} from "./content-deletion-record-mapping";
import { contentDeletionOperations } from "./schema";

export class PgContentDeletionRepository {
  constructor(private readonly db: RomeoDatabase) {}

  async createContentDeletionOperation(operation: ContentDeletionOperation) {
    const [inserted] = await this.db
      .insert(contentDeletionOperations)
      .values(toContentDeletionInsert(operation))
      .onConflictDoNothing()
      .returning();
    if (inserted !== undefined) return toContentDeletionOperation(inserted);
    const [existing] = await this.db
      .select()
      .from(contentDeletionOperations)
      .where(
        and(
          eq(contentDeletionOperations.orgId, operation.orgId),
          eq(
            contentDeletionOperations.idempotencyKey,
            operation.idempotencyKey,
          ),
        ),
      )
      .limit(1);
    if (existing === undefined)
      throw new Error("content_deletion_target_conflict");
    return toContentDeletionOperation(existing);
  }

  async getContentDeletionOperation(orgId: string, operationId: string) {
    const [row] = await this.db
      .select()
      .from(contentDeletionOperations)
      .where(
        and(
          eq(contentDeletionOperations.orgId, orgId),
          eq(contentDeletionOperations.id, operationId),
        ),
      )
      .limit(1);
    return row === undefined ? undefined : toContentDeletionOperation(row);
  }

  async getActiveContentDeletionOperation(
    orgId: string,
    targetType: ContentDeletionOperation["targetType"],
    targetId: string,
  ) {
    const [row] = await this.db
      .select()
      .from(contentDeletionOperations)
      .where(
        and(
          eq(contentDeletionOperations.orgId, orgId),
          eq(contentDeletionOperations.targetType, targetType),
          eq(contentDeletionOperations.targetId, targetId),
          ne(contentDeletionOperations.status, "completed"),
        ),
      )
      .limit(1);
    return row === undefined ? undefined : toContentDeletionOperation(row);
  }

  async claimContentDeletionOperation(input: ClaimContentDeletionInput) {
    return this.db.transaction(async (tx) => {
      const now = new Date(input.now);
      const [candidate] = await tx
        .select()
        .from(contentDeletionOperations)
        .where(
          and(
            eq(contentDeletionOperations.orgId, input.orgId),
            lte(contentDeletionOperations.attempts, 9),
            or(
              eq(contentDeletionOperations.status, "pending"),
              and(
                eq(contentDeletionOperations.status, "failed"),
                or(
                  isNull(contentDeletionOperations.nextAttemptAt),
                  lte(contentDeletionOperations.nextAttemptAt, now),
                ),
              ),
              and(
                eq(contentDeletionOperations.status, "processing"),
                lte(contentDeletionOperations.leaseExpiresAt, now),
              ),
            ),
          ),
        )
        .orderBy(
          asc(contentDeletionOperations.nextAttemptAt),
          asc(contentDeletionOperations.createdAt),
          asc(contentDeletionOperations.id),
        )
        .limit(1)
        .for("update", { skipLocked: true });
      if (candidate === undefined) return undefined;
      const [claimed] = await tx
        .update(contentDeletionOperations)
        .set({
          attempts: candidate.attempts + 1,
          leaseOwner: input.leaseOwner,
          leaseToken: input.leaseToken,
          leaseExpiresAt: new Date(input.leaseExpiresAt),
          leaseFence: candidate.leaseFence + 1,
          status: "processing",
          nextAttemptAt: null,
          failureCode: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(contentDeletionOperations.id, candidate.id),
            eq(contentDeletionOperations.leaseFence, candidate.leaseFence),
          ),
        )
        .returning();
      return claimed === undefined
        ? undefined
        : toContentDeletionOperation(claimed);
    });
  }

  async updateContentDeletionOperationWithLease(
    input: UpdateContentDeletionWithLeaseInput,
  ) {
    const operation = input.operation;
    const terminal = operation.status !== "processing";
    const [row] = await this.db
      .update(contentDeletionOperations)
      .set({
        status: operation.status,
        nextAttemptAt:
          operation.nextAttemptAt === undefined
            ? null
            : new Date(operation.nextAttemptAt),
        failureCode: operation.failureCode ?? null,
        legalHoldEvaluatedAt: new Date(operation.legalHoldEvaluatedAt),
        objectDeletedAt: date(operation.objectDeletedAt),
        objectVerifiedAt: date(operation.objectVerifiedAt),
        vectorsDeletedAt: date(operation.vectorsDeletedAt),
        vectorsVerifiedAt: date(operation.vectorsVerifiedAt),
        relationalDeletedAt: date(operation.relationalDeletedAt),
        attestedAt: date(operation.attestedAt),
        completedAt: date(operation.completedAt),
        ...(terminal
          ? { leaseOwner: null, leaseToken: null, leaseExpiresAt: null }
          : {}),
        updatedAt: new Date(input.now),
      })
      .where(
        and(
          eq(contentDeletionOperations.orgId, operation.orgId),
          eq(contentDeletionOperations.id, operation.id),
          eq(contentDeletionOperations.leaseOwner, input.leaseOwner),
          eq(contentDeletionOperations.leaseToken, input.leaseToken),
          eq(contentDeletionOperations.leaseFence, input.fencingToken),
          gt(contentDeletionOperations.leaseExpiresAt, new Date(input.now)),
        ),
      )
      .returning();
    return row === undefined ? undefined : toContentDeletionOperation(row);
  }

  async renewContentDeletionOperationLease(
    input: RenewContentDeletionLeaseInput,
  ) {
    const [row] = await this.db
      .update(contentDeletionOperations)
      .set({
        leaseExpiresAt: new Date(input.leaseExpiresAt),
        updatedAt: new Date(input.now),
      })
      .where(
        and(
          eq(contentDeletionOperations.orgId, input.orgId),
          eq(contentDeletionOperations.id, input.operationId),
          eq(contentDeletionOperations.leaseOwner, input.leaseOwner),
          eq(contentDeletionOperations.leaseToken, input.leaseToken),
          eq(contentDeletionOperations.leaseFence, input.fencingToken),
          gt(contentDeletionOperations.leaseExpiresAt, new Date(input.now)),
        ),
      )
      .returning();
    return row === undefined ? undefined : toContentDeletionOperation(row);
  }
}

function date(value?: string): Date | null {
  return value === undefined ? null : new Date(value);
}
