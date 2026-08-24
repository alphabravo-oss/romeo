import type {
  AuditLogQueryFilter,
  AuditLogQueryResult,
  QueryAuditLogsInput,
} from "../domain/audit-query";
import type { AuditLog } from "../domain/entities";
import type {
  AuditExportAttempt,
  AuditExportDestination,
  AuditExportIdempotencyReceipt,
  AuditExportJob,
  AuditIntegrityCheckpoint,
  AuditIntegrityRecord,
  AuditRetentionExportGate,
} from "../domain/entities";
import { createAuditIntegrityRecord } from "../domain/audit-integrity";
import { assertValidAuditLog } from "../audit-taxonomy";
import {
  classifyAuditAction,
  isAuditNoise,
} from "../services/audit-classification";
import { append, replaceById } from "./collection-helpers";
import { InMemoryWorkLeaseRepository } from "./in-memory-work-leases";

export abstract class InMemoryAuditRepository extends InMemoryWorkLeaseRepository {
  async listAuditLogs(orgId: string): Promise<AuditLog[]> {
    return this.data.auditLogs
      .filter((log) => log.orgId === orgId)
      .sort((left, right) => {
        const createdAt = right.createdAt.localeCompare(left.createdAt);
        return createdAt === 0 ? left.id.localeCompare(right.id) : createdAt;
      });
  }

  async queryAuditLogs(
    input: QueryAuditLogsInput,
  ): Promise<AuditLogQueryResult> {
    const limit = normalizedAuditQueryLimit(input.limit);
    const matching = this.data.auditLogs
      .filter((log) => log.orgId === input.orgId)
      .filter((log) => matchesAuditFilter(log, input.filter, input.search))
      .filter((log) => afterPosition(log, input))
      .sort(compareAuditLogs(input.sort.direction));
    return {
      hasMore: matching.length > limit,
      items: matching.slice(0, limit),
    };
  }

  async createAuditLog(log: AuditLog): Promise<AuditLog> {
    assertValidAuditLog(log);
    const created = append(this.data.auditLogs, log);
    this.appendIntegrityRecord(log);
    return created;
  }

  async ensureAuditIntegrityRecords(orgId: string): Promise<number> {
    const recorded = new Set(
      this.data.auditIntegrityRecords
        .filter((record) => record.orgId === orgId)
        .map((record) => record.auditEventId),
    );
    const missing = this.data.auditLogs
      .filter((log) => log.orgId === orgId && !recorded.has(log.id))
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.id.localeCompare(right.id),
      );
    for (const log of missing) this.appendIntegrityRecord(log);
    return missing.length;
  }

  async deleteAuditLogsBefore(orgId: string, before: string): Promise<number> {
    const gate = await this.auditRetentionExportGate(orgId, before);
    if (!gate.deletable)
      throw new Error("audit_retention_export_confirmation_required");
    const initialCount = this.data.auditLogs.length;
    const deletedIds = new Set(
      this.data.auditLogs
        .filter((log) => log.orgId === orgId && log.createdAt < before)
        .map((log) => log.id),
    );
    this.data.auditLogs = this.data.auditLogs.filter(
      (log) => log.orgId !== orgId || log.createdAt >= before,
    );
    this.data.auditIntegrityRecords = this.data.auditIntegrityRecords.filter(
      (record) => !deletedIds.has(record.auditEventId),
    );
    return initialCount - this.data.auditLogs.length;
  }

  async listAuditIntegrityRecords(
    orgId: string,
  ): Promise<AuditIntegrityRecord[]> {
    return this.data.auditIntegrityRecords
      .filter((record) => record.orgId === orgId)
      .sort((left, right) => left.sequence - right.sequence);
  }

  async listAuditIntegrityCheckpoints(
    orgId: string,
  ): Promise<AuditIntegrityCheckpoint[]> {
    return this.data.auditIntegrityCheckpoints
      .filter((checkpoint) => checkpoint.orgId === orgId)
      .sort(
        (left, right) =>
          left.fromSequence - right.fromSequence ||
          left.id.localeCompare(right.id),
      );
  }

  async getAuditIntegrityCheckpoint(
    orgId: string,
    checkpointId: string,
  ): Promise<AuditIntegrityCheckpoint | undefined> {
    return this.data.auditIntegrityCheckpoints.find(
      (checkpoint) =>
        checkpoint.orgId === orgId && checkpoint.id === checkpointId,
    );
  }

  async getAuditIntegrityCheckpointByHash(
    orgId: string,
    checkpointHash: string,
  ): Promise<AuditIntegrityCheckpoint | undefined> {
    return this.data.auditIntegrityCheckpoints.find(
      (checkpoint) =>
        checkpoint.orgId === orgId &&
        checkpoint.checkpointHash === checkpointHash,
    );
  }

  async createAuditIntegrityCheckpoint(
    checkpoint: AuditIntegrityCheckpoint,
  ): Promise<AuditIntegrityCheckpoint> {
    if (
      this.data.auditIntegrityCheckpoints.some(
        (candidate) =>
          candidate.id === checkpoint.id ||
          (candidate.orgId === checkpoint.orgId &&
            candidate.checkpointHash === checkpoint.checkpointHash),
      )
    )
      throw new Error("audit_integrity_checkpoint_conflict");
    return append(this.data.auditIntegrityCheckpoints, checkpoint);
  }

  async getAuditExportDestination(
    orgId: string,
    kind: AuditExportDestination["kind"],
  ): Promise<AuditExportDestination | undefined> {
    return this.data.auditExportDestinations.find(
      (destination) => destination.orgId === orgId && destination.kind === kind,
    );
  }

  async upsertAuditExportDestination(
    destination: AuditExportDestination,
  ): Promise<AuditExportDestination> {
    const existing = await this.getAuditExportDestination(
      destination.orgId,
      destination.kind,
    );
    if (existing === undefined)
      return append(this.data.auditExportDestinations, destination);
    const updated = {
      ...destination,
      id: existing.id,
      createdAt: existing.createdAt,
    };
    return replaceById(this.data.auditExportDestinations, updated);
  }

  async getAuditExportJob(
    orgId: string,
    jobId: string,
  ): Promise<AuditExportJob | undefined> {
    return this.data.auditExportJobs.find(
      (job) => job.orgId === orgId && job.id === jobId,
    );
  }

  async listAuditExportJobs(
    orgId: string,
    destinationId?: string,
  ): Promise<AuditExportJob[]> {
    return this.data.auditExportJobs
      .filter(
        (job) =>
          job.orgId === orgId &&
          (destinationId === undefined || job.destinationId === destinationId),
      )
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.id.localeCompare(right.id),
      );
  }

  async getAuditExportJobByIdempotencyHash(
    orgId: string,
    idempotencyKeyHash: string,
  ): Promise<AuditExportJob | undefined> {
    return this.data.auditExportJobs.find(
      (job) =>
        job.orgId === orgId && job.idempotencyKeyHash === idempotencyKeyHash,
    );
  }

  async createAuditExportJob(job: AuditExportJob): Promise<AuditExportJob> {
    if (
      this.data.auditExportJobs.some(
        (candidate) =>
          candidate.id === job.id ||
          (candidate.orgId === job.orgId &&
            candidate.idempotencyKeyHash === job.idempotencyKeyHash),
      )
    )
      throw new Error("audit_export_job_conflict");
    return append(this.data.auditExportJobs, job);
  }

  async claimAuditExportJob(input: {
    jobId: string;
    leaseSeconds: number;
    leaseToken: string;
    now: string;
    orgId: string;
  }): Promise<AuditExportJob | undefined> {
    const job = await this.getAuditExportJob(input.orgId, input.jobId);
    if (
      job === undefined ||
      job.status === "dead_letter" ||
      job.status === "exported"
    )
      return undefined;
    const nowMs = Date.parse(input.now);
    if (
      job.status === "running" &&
      job.leaseExpiresAt !== undefined &&
      Date.parse(job.leaseExpiresAt) > nowMs
    )
      return undefined;
    if (
      job.status === "retry_scheduled" &&
      job.nextAttemptAt !== undefined &&
      Date.parse(job.nextAttemptAt) > nowMs
    )
      return undefined;
    const claimed: AuditExportJob = {
      ...job,
      leaseExpiresAt: new Date(
        nowMs + Math.max(1, input.leaseSeconds) * 1_000,
      ).toISOString(),
      leaseToken: input.leaseToken,
      status: "running",
      updatedAt: input.now,
    };
    return replaceById(this.data.auditExportJobs, claimed);
  }

  async completeAuditExportAttempt(input: {
    attempt: AuditExportAttempt;
    job: AuditExportJob;
    leaseToken: string;
  }): Promise<AuditExportJob | undefined> {
    const current = await this.getAuditExportJob(input.job.orgId, input.job.id);
    if (
      current === undefined ||
      current.status !== "running" ||
      current.leaseToken !== input.leaseToken
    )
      return undefined;
    append(this.data.auditExportAttempts, input.attempt);
    return replaceById(this.data.auditExportJobs, input.job);
  }

  async listAuditExportAttempts(
    orgId: string,
    jobId: string,
  ): Promise<AuditExportAttempt[]> {
    return this.data.auditExportAttempts
      .filter((attempt) => attempt.orgId === orgId && attempt.jobId === jobId)
      .sort((left, right) => left.attempt - right.attempt);
  }

  async getAuditExportIdempotencyReceipt(
    orgId: string,
    idempotencyKeyHash: string,
  ): Promise<AuditExportIdempotencyReceipt | undefined> {
    return this.data.auditExportIdempotencyReceipts.find(
      (receipt) =>
        receipt.orgId === orgId &&
        receipt.idempotencyKeyHash === idempotencyKeyHash,
    );
  }

  async createAuditExportIdempotencyReceipt(
    receipt: AuditExportIdempotencyReceipt,
  ): Promise<AuditExportIdempotencyReceipt> {
    if (
      (await this.getAuditExportIdempotencyReceipt(
        receipt.orgId,
        receipt.idempotencyKeyHash,
      )) !== undefined
    )
      throw new Error("audit_export_idempotency_conflict");
    return append(this.data.auditExportIdempotencyReceipts, receipt);
  }

  async auditRetentionExportGate(
    orgId: string,
    before: string,
  ): Promise<AuditRetentionExportGate> {
    const eligibleSequences = this.data.auditIntegrityRecords
      .filter((record) => record.orgId === orgId && record.createdAt < before)
      .map((record) => record.sequence);
    const requiredFromSequence = Math.min(...eligibleSequences);
    const requiredThroughSequence = Math.max(...eligibleSequences);
    if (!Number.isFinite(requiredThroughSequence))
      return { blockedDestinationIds: [], deletable: true };
    const blockedDestinationIds = this.data.auditExportDestinations
      .filter(
        (destination) => destination.orgId === orgId && destination.active,
      )
      .filter(
        (destination) =>
          !coversAuditExportRange(
            this.data.auditExportJobs.filter(
              (job) =>
                job.orgId === orgId &&
                job.destinationId === destination.id &&
                job.status === "exported",
            ),
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

  private appendIntegrityRecord(log: AuditLog): void {
    const head = this.data.auditIntegrityTenantHeads.find(
      (candidate) => candidate.orgId === log.orgId,
    );
    const record = createAuditIntegrityRecord({
      log,
      sequence: (head?.lastSequence ?? 0) + 1,
      ...(head === undefined ? {} : { previousHash: head.lastRecordHash }),
    });
    append(this.data.auditIntegrityRecords, record);
    const nextHead = {
      lastRecordHash: record.recordHash,
      lastSequence: record.sequence,
      orgId: log.orgId,
      updatedAt: new Date().toISOString(),
    };
    if (head === undefined)
      append(this.data.auditIntegrityTenantHeads, nextHead);
    else
      this.data.auditIntegrityTenantHeads =
        this.data.auditIntegrityTenantHeads.map((candidate) =>
          candidate.orgId === log.orgId ? nextHead : candidate,
        );
  }
}

function coversAuditExportRange(
  jobs: readonly AuditExportJob[],
  requiredFromSequence: number,
  requiredThroughSequence: number,
  requireRetentionLock: boolean,
): boolean {
  let nextSequence = requiredFromSequence;
  for (const job of [...jobs].sort(
    (left, right) => left.fromSequence - right.fromSequence,
  )) {
    if (
      job.readbackHash === undefined ||
      (requireRetentionLock && job.retentionLockEvidence === undefined) ||
      job.toSequence < nextSequence
    )
      continue;
    if (job.fromSequence > nextSequence) return false;
    nextSequence = job.toSequence + 1;
    if (nextSequence > requiredThroughSequence) return true;
  }
  return false;
}

function normalizedAuditQueryLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) return 1;
  return Math.min(value, 200);
}

function matchesAuditFilter(
  log: AuditLog,
  filter: AuditLogQueryFilter,
  search: string | undefined,
): boolean {
  if (filter.action !== undefined && log.action !== filter.action) return false;
  if (filter.actorId !== undefined && log.actorId !== filter.actorId)
    return false;
  if (
    filter.category !== undefined &&
    classifyAuditAction(log.action) !== filter.category
  )
    return false;
  if (filter.from !== undefined && log.createdAt < filter.from) return false;
  if (filter.outcome !== undefined && log.outcome !== filter.outcome)
    return false;
  if (filter.resourceId !== undefined && log.resourceId !== filter.resourceId)
    return false;
  if (
    filter.resourceType !== undefined &&
    log.resourceType !== filter.resourceType
  )
    return false;
  if (filter.to !== undefined && log.createdAt > filter.to) return false;
  if (
    filter.includeNoise !== true &&
    filter.action === undefined &&
    filter.category !== "system" &&
    isAuditNoise(log)
  )
    return false;
  if (search !== undefined) {
    const query = search.toLocaleLowerCase();
    const haystack =
      `${log.action} ${log.actorId} ${log.resourceType} ${log.resourceId}`.toLocaleLowerCase();
    if (!haystack.includes(query)) return false;
  }
  return true;
}

function afterPosition(log: AuditLog, input: QueryAuditLogsInput): boolean {
  if (input.position === undefined) return true;
  const createdAtComparison = log.createdAt.localeCompare(
    input.position.createdAt,
  );
  if (input.sort.direction === "asc")
    return (
      createdAtComparison > 0 ||
      (createdAtComparison === 0 && log.id > input.position.id)
    );
  return (
    createdAtComparison < 0 ||
    (createdAtComparison === 0 && log.id < input.position.id)
  );
}

function compareAuditLogs(direction: "asc" | "desc") {
  const multiplier = direction === "asc" ? 1 : -1;
  return (left: AuditLog, right: AuditLog): number => {
    const createdAt = left.createdAt.localeCompare(right.createdAt);
    if (createdAt !== 0) return createdAt * multiplier;
    return left.id.localeCompare(right.id) * multiplier;
  };
}
