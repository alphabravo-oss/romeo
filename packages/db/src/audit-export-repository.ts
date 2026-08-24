import type {
  AuditExportAttempt,
  AuditExportDestination,
  AuditExportIdempotencyReceipt,
  AuditExportJob,
  AuditRetentionExportGate,
} from "@romeo/core";
import { and, asc, desc, eq, gte, isNull, lt, lte, or } from "drizzle-orm";

import {
  toAuditExportAttempt,
  toAuditExportAttemptInsert,
  toAuditExportDestination,
  toAuditExportDestinationInsert,
  toAuditExportIdempotencyReceipt,
  toAuditExportIdempotencyReceiptInsert,
  toAuditExportJob,
  toAuditExportJobInsert,
  toAuditExportJobUpdate,
} from "./audit-export-mapping";
import type { RomeoDatabase } from "./client";
import {
  auditExportAttempts,
  auditExportDestinations,
  auditExportIdempotencyReceipts,
  auditExportJobs,
  auditIntegrityRecords,
} from "./schema";

export class PgAuditExportRepository {
  constructor(private readonly db: RomeoDatabase) {}

  async getDestination(
    orgId: string,
    kind: AuditExportDestination["kind"],
  ): Promise<AuditExportDestination | undefined> {
    const [row] = await this.db
      .select()
      .from(auditExportDestinations)
      .where(
        and(
          eq(auditExportDestinations.orgId, orgId),
          eq(auditExportDestinations.kind, kind),
        ),
      )
      .limit(1);
    return row === undefined ? undefined : toAuditExportDestination(row);
  }

  async upsertDestination(
    destination: AuditExportDestination,
  ): Promise<AuditExportDestination> {
    const [row] = await this.db
      .insert(auditExportDestinations)
      .values(toAuditExportDestinationInsert(destination))
      .onConflictDoUpdate({
        target: [auditExportDestinations.orgId, auditExportDestinations.kind],
        set: {
          active: destination.active,
          configReference: destination.configReference,
          requireReadback: destination.requireReadback,
          requireRetentionLock: destination.requireRetentionLock,
          updatedAt: new Date(destination.updatedAt),
        },
      })
      .returning();
    return row === undefined ? destination : toAuditExportDestination(row);
  }

  async getJob(
    orgId: string,
    jobId: string,
  ): Promise<AuditExportJob | undefined> {
    const [row] = await this.db
      .select()
      .from(auditExportJobs)
      .where(
        and(eq(auditExportJobs.orgId, orgId), eq(auditExportJobs.id, jobId)),
      )
      .limit(1);
    return row === undefined ? undefined : toAuditExportJob(row);
  }

  async listJobs(
    orgId: string,
    destinationId?: string,
  ): Promise<AuditExportJob[]> {
    const rows = await this.db
      .select()
      .from(auditExportJobs)
      .where(
        and(
          eq(auditExportJobs.orgId, orgId),
          destinationId === undefined
            ? undefined
            : eq(auditExportJobs.destinationId, destinationId),
        ),
      )
      .orderBy(asc(auditExportJobs.createdAt), asc(auditExportJobs.id));
    return rows.map(toAuditExportJob);
  }

  async getJobByIdempotencyHash(
    orgId: string,
    idempotencyKeyHash: string,
  ): Promise<AuditExportJob | undefined> {
    const [row] = await this.db
      .select()
      .from(auditExportJobs)
      .where(
        and(
          eq(auditExportJobs.orgId, orgId),
          eq(auditExportJobs.idempotencyKeyHash, idempotencyKeyHash),
        ),
      )
      .limit(1);
    return row === undefined ? undefined : toAuditExportJob(row);
  }

  async createJob(job: AuditExportJob): Promise<AuditExportJob> {
    const [row] = await this.db
      .insert(auditExportJobs)
      .values(toAuditExportJobInsert(job))
      .returning();
    return row === undefined ? job : toAuditExportJob(row);
  }

  async claimJob(input: {
    jobId: string;
    leaseSeconds: number;
    leaseToken: string;
    now: string;
    orgId: string;
  }): Promise<AuditExportJob | undefined> {
    const now = new Date(input.now);
    const [row] = await this.db
      .update(auditExportJobs)
      .set({
        leaseExpiresAt: new Date(
          now.getTime() + Math.max(1, input.leaseSeconds) * 1_000,
        ),
        leaseToken: input.leaseToken,
        status: "running",
        updatedAt: now,
      })
      .where(
        and(
          eq(auditExportJobs.id, input.jobId),
          eq(auditExportJobs.orgId, input.orgId),
          or(
            eq(auditExportJobs.status, "queued"),
            and(
              eq(auditExportJobs.status, "retry_scheduled"),
              or(
                isNull(auditExportJobs.nextAttemptAt),
                lte(auditExportJobs.nextAttemptAt, now),
              ),
            ),
            and(
              eq(auditExportJobs.status, "running"),
              or(
                isNull(auditExportJobs.leaseExpiresAt),
                lte(auditExportJobs.leaseExpiresAt, now),
              ),
            ),
          ),
        ),
      )
      .returning();
    return row === undefined ? undefined : toAuditExportJob(row);
  }

  async completeAttempt(input: {
    attempt: AuditExportAttempt;
    job: AuditExportJob;
    leaseToken: string;
  }): Promise<AuditExportJob | undefined> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(auditExportJobs)
        .set(toAuditExportJobUpdate(input.job))
        .where(
          and(
            eq(auditExportJobs.id, input.job.id),
            eq(auditExportJobs.orgId, input.job.orgId),
            eq(auditExportJobs.status, "running"),
            eq(auditExportJobs.leaseToken, input.leaseToken),
          ),
        )
        .returning();
      if (row === undefined) return undefined;
      await tx
        .insert(auditExportAttempts)
        .values(toAuditExportAttemptInsert(input.attempt));
      return toAuditExportJob(row);
    });
  }

  async listAttempts(
    orgId: string,
    jobId: string,
  ): Promise<AuditExportAttempt[]> {
    const rows = await this.db
      .select()
      .from(auditExportAttempts)
      .where(
        and(
          eq(auditExportAttempts.orgId, orgId),
          eq(auditExportAttempts.jobId, jobId),
        ),
      )
      .orderBy(asc(auditExportAttempts.attempt));
    return rows.map(toAuditExportAttempt);
  }

  async getReceipt(
    orgId: string,
    idempotencyKeyHash: string,
  ): Promise<AuditExportIdempotencyReceipt | undefined> {
    const [row] = await this.db
      .select()
      .from(auditExportIdempotencyReceipts)
      .where(
        and(
          eq(auditExportIdempotencyReceipts.orgId, orgId),
          eq(
            auditExportIdempotencyReceipts.idempotencyKeyHash,
            idempotencyKeyHash,
          ),
        ),
      )
      .limit(1);
    return row === undefined ? undefined : toAuditExportIdempotencyReceipt(row);
  }

  async createReceipt(
    receipt: AuditExportIdempotencyReceipt,
  ): Promise<AuditExportIdempotencyReceipt> {
    const [row] = await this.db
      .insert(auditExportIdempotencyReceipts)
      .values(toAuditExportIdempotencyReceiptInsert(receipt))
      .returning();
    return row === undefined ? receipt : toAuditExportIdempotencyReceipt(row);
  }

  async retentionGate(
    orgId: string,
    before: string,
  ): Promise<AuditRetentionExportGate> {
    const eligible = and(
      eq(auditIntegrityRecords.orgId, orgId),
      lt(auditIntegrityRecords.createdAt, new Date(before)),
    );
    const [first, last] = await Promise.all([
      this.db
        .select({ sequence: auditIntegrityRecords.sequence })
        .from(auditIntegrityRecords)
        .where(eligible)
        .orderBy(asc(auditIntegrityRecords.sequence))
        .limit(1),
      this.db
        .select({ sequence: auditIntegrityRecords.sequence })
        .from(auditIntegrityRecords)
        .where(eligible)
        .orderBy(desc(auditIntegrityRecords.sequence))
        .limit(1),
    ]);
    const requiredFromSequence = first[0]?.sequence;
    const requiredThroughSequence = last[0]?.sequence;
    if (
      requiredFromSequence === undefined ||
      requiredThroughSequence === undefined
    )
      return { blockedDestinationIds: [], deletable: true };
    const destinations = await this.db
      .select()
      .from(auditExportDestinations)
      .where(
        and(
          eq(auditExportDestinations.orgId, orgId),
          eq(auditExportDestinations.active, true),
        ),
      );
    const completed = await this.db
      .select()
      .from(auditExportJobs)
      .where(
        and(
          eq(auditExportJobs.orgId, orgId),
          eq(auditExportJobs.status, "exported"),
          gte(auditExportJobs.toSequence, requiredThroughSequence),
        ),
      );
    const blockedDestinationIds = destinations
      .filter(
        (destination) =>
          !coversAuditExportRange(
            completed.filter((job) => job.destinationId === destination.id),
            requiredFromSequence,
            requiredThroughSequence,
            destination.requireRetentionLock,
          ),
      )
      .map((destination) => destination.id)
      .sort();
    return {
      blockedDestinationIds,
      deletable: blockedDestinationIds.length === 0,
      requiredThroughSequence,
    };
  }
}

function coversAuditExportRange(
  jobs: Array<typeof auditExportJobs.$inferSelect>,
  requiredFromSequence: number,
  requiredThroughSequence: number,
  requireRetentionLock: boolean,
): boolean {
  let nextSequence = requiredFromSequence;
  for (const job of jobs.sort(
    (left, right) => left.fromSequence - right.fromSequence,
  )) {
    if (
      job.readbackHash === null ||
      (requireRetentionLock && job.retentionLockEvidence === null) ||
      job.toSequence < nextSequence
    )
      continue;
    if (job.fromSequence > nextSequence) return false;
    nextSequence = job.toSequence + 1;
    if (nextSequence > requiredThroughSequence) return true;
  }
  return false;
}
