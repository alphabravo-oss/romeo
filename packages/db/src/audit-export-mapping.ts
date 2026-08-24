import type {
  AuditExportAttempt,
  AuditExportDestination,
  AuditExportIdempotencyReceipt,
  AuditExportJob,
} from "@romeo/core";

import { toIsoString } from "./repository-mapping";
import {
  auditExportAttempts,
  auditExportDestinations,
  auditExportIdempotencyReceipts,
  auditExportJobs,
} from "./schema";

export function toAuditExportDestination(
  row: typeof auditExportDestinations.$inferSelect,
): AuditExportDestination {
  return {
    active: row.active,
    configReference: row.configReference,
    createdAt: toIsoString(row.createdAt),
    id: row.id,
    kind: asDestinationKind(row.kind),
    orgId: row.orgId,
    requireReadback: row.requireReadback,
    requireRetentionLock: row.requireRetentionLock,
    updatedAt: toIsoString(row.updatedAt),
  };
}

export function toAuditExportDestinationInsert(
  destination: AuditExportDestination,
): typeof auditExportDestinations.$inferInsert {
  return {
    active: destination.active,
    configReference: destination.configReference,
    createdAt: new Date(destination.createdAt),
    id: destination.id,
    kind: destination.kind,
    orgId: destination.orgId,
    requireReadback: destination.requireReadback,
    requireRetentionLock: destination.requireRetentionLock,
    updatedAt: new Date(destination.updatedAt),
  };
}

export function toAuditExportJob(
  row: typeof auditExportJobs.$inferSelect,
): AuditExportJob {
  return {
    attemptCount: row.attemptCount,
    checkpointHash: row.checkpointHash,
    checkpointId: row.checkpointId,
    createdAt: toIsoString(row.createdAt),
    destinationId: row.destinationId,
    fromSequence: row.fromSequence,
    id: row.id,
    idempotencyKeyHash: row.idempotencyKeyHash,
    maxAttempts: row.maxAttempts,
    orgId: row.orgId,
    payloadHash: row.payloadHash,
    status: asExportJobStatus(row.status),
    toSequence: row.toSequence,
    updatedAt: toIsoString(row.updatedAt),
    ...(row.acknowledgementHash === null
      ? {}
      : { acknowledgementHash: row.acknowledgementHash }),
    ...(row.completedAt === null
      ? {}
      : { completedAt: toIsoString(row.completedAt) }),
    ...(row.deadLetterReason === null
      ? {}
      : { deadLetterReason: row.deadLetterReason }),
    ...(row.destinationRangeEnd === null
      ? {}
      : { destinationRangeEnd: row.destinationRangeEnd }),
    ...(row.destinationRangeStart === null
      ? {}
      : { destinationRangeStart: row.destinationRangeStart }),
    ...(row.lastErrorCode === null ? {} : { lastErrorCode: row.lastErrorCode }),
    ...(row.leaseExpiresAt === null
      ? {}
      : { leaseExpiresAt: toIsoString(row.leaseExpiresAt) }),
    ...(row.leaseToken === null ? {} : { leaseToken: row.leaseToken }),
    ...(row.nextAttemptAt === null
      ? {}
      : { nextAttemptAt: toIsoString(row.nextAttemptAt) }),
    ...(row.readbackHash === null ? {} : { readbackHash: row.readbackHash }),
    ...(row.retentionLockEvidence === null
      ? {}
      : { retentionLockEvidence: row.retentionLockEvidence }),
  };
}

export function toAuditExportJobInsert(
  job: AuditExportJob,
): typeof auditExportJobs.$inferInsert {
  return {
    acknowledgementHash: job.acknowledgementHash,
    attemptCount: job.attemptCount,
    checkpointHash: job.checkpointHash,
    checkpointId: job.checkpointId,
    completedAt:
      job.completedAt === undefined ? undefined : new Date(job.completedAt),
    createdAt: new Date(job.createdAt),
    deadLetterReason: job.deadLetterReason,
    destinationId: job.destinationId,
    destinationRangeEnd: job.destinationRangeEnd,
    destinationRangeStart: job.destinationRangeStart,
    fromSequence: job.fromSequence,
    id: job.id,
    idempotencyKeyHash: job.idempotencyKeyHash,
    lastErrorCode: job.lastErrorCode,
    leaseExpiresAt:
      job.leaseExpiresAt === undefined
        ? undefined
        : new Date(job.leaseExpiresAt),
    leaseToken: job.leaseToken,
    maxAttempts: job.maxAttempts,
    nextAttemptAt:
      job.nextAttemptAt === undefined ? undefined : new Date(job.nextAttemptAt),
    orgId: job.orgId,
    payloadHash: job.payloadHash,
    readbackHash: job.readbackHash,
    retentionLockEvidence: job.retentionLockEvidence,
    status: job.status,
    toSequence: job.toSequence,
    updatedAt: new Date(job.updatedAt),
  };
}

export function toAuditExportJobUpdate(job: AuditExportJob) {
  return {
    acknowledgementHash: job.acknowledgementHash ?? null,
    attemptCount: job.attemptCount,
    completedAt:
      job.completedAt === undefined ? null : new Date(job.completedAt),
    deadLetterReason: job.deadLetterReason ?? null,
    destinationRangeEnd: job.destinationRangeEnd ?? null,
    destinationRangeStart: job.destinationRangeStart ?? null,
    lastErrorCode: job.lastErrorCode ?? null,
    leaseExpiresAt:
      job.leaseExpiresAt === undefined ? null : new Date(job.leaseExpiresAt),
    leaseToken: job.leaseToken ?? null,
    nextAttemptAt:
      job.nextAttemptAt === undefined ? null : new Date(job.nextAttemptAt),
    readbackHash: job.readbackHash ?? null,
    retentionLockEvidence: job.retentionLockEvidence ?? null,
    status: job.status,
    updatedAt: new Date(job.updatedAt),
  };
}

export function toAuditExportAttempt(
  row: typeof auditExportAttempts.$inferSelect,
): AuditExportAttempt {
  return {
    attempt: row.attempt,
    completedAt: toIsoString(row.completedAt),
    id: row.id,
    jobId: row.jobId,
    orgId: row.orgId,
    startedAt: toIsoString(row.startedAt),
    status: row.status === "verified" ? "verified" : "failed",
    ...(row.acknowledgementHash === null
      ? {}
      : { acknowledgementHash: row.acknowledgementHash }),
    ...(row.destinationRangeEnd === null
      ? {}
      : { destinationRangeEnd: row.destinationRangeEnd }),
    ...(row.destinationRangeStart === null
      ? {}
      : { destinationRangeStart: row.destinationRangeStart }),
    ...(row.errorCode === null ? {} : { errorCode: row.errorCode }),
    ...(row.readbackHash === null ? {} : { readbackHash: row.readbackHash }),
    ...(row.retentionLockEvidence === null
      ? {}
      : { retentionLockEvidence: row.retentionLockEvidence }),
  };
}

export function toAuditExportAttemptInsert(
  attempt: AuditExportAttempt,
): typeof auditExportAttempts.$inferInsert {
  return {
    acknowledgementHash: attempt.acknowledgementHash,
    attempt: attempt.attempt,
    completedAt: new Date(attempt.completedAt),
    destinationRangeEnd: attempt.destinationRangeEnd,
    destinationRangeStart: attempt.destinationRangeStart,
    errorCode: attempt.errorCode,
    id: attempt.id,
    jobId: attempt.jobId,
    orgId: attempt.orgId,
    readbackHash: attempt.readbackHash,
    retentionLockEvidence: attempt.retentionLockEvidence,
    startedAt: new Date(attempt.startedAt),
    status: attempt.status,
  };
}

export function toAuditExportIdempotencyReceipt(
  row: typeof auditExportIdempotencyReceipts.$inferSelect,
): AuditExportIdempotencyReceipt {
  return {
    createdAt: toIsoString(row.createdAt),
    id: row.id,
    idempotencyKeyHash: row.idempotencyKeyHash,
    jobId: row.jobId,
    orgId: row.orgId,
    requestHash: row.requestHash,
  };
}

export function toAuditExportIdempotencyReceiptInsert(
  receipt: AuditExportIdempotencyReceipt,
): typeof auditExportIdempotencyReceipts.$inferInsert {
  return {
    createdAt: new Date(receipt.createdAt),
    id: receipt.id,
    idempotencyKeyHash: receipt.idempotencyKeyHash,
    jobId: receipt.jobId,
    orgId: receipt.orgId,
    requestHash: receipt.requestHash,
  };
}

function asDestinationKind(value: string): AuditExportDestination["kind"] {
  if (value !== "customer_siem" && value !== "worm_compatible")
    throw new TypeError("Invalid audit export destination kind.");
  return value;
}

function asExportJobStatus(value: string): AuditExportJob["status"] {
  if (
    value !== "dead_letter" &&
    value !== "exported" &&
    value !== "queued" &&
    value !== "retry_scheduled" &&
    value !== "running"
  )
    throw new TypeError("Invalid audit export job status.");
  return value;
}
