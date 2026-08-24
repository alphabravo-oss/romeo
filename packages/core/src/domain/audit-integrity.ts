import { createHash } from "node:crypto";

import type { AuditLog } from "./operational-entities";

export const AUDIT_INTEGRITY_RECORD_SCHEMA =
  "romeo.audit-integrity-record.v1" as const;
export const AUDIT_INTEGRITY_CHECKPOINT_SCHEMA =
  "romeo.audit-integrity-checkpoint.v1" as const;
export const AUDIT_EXPORT_PAYLOAD_SCHEMA =
  "romeo.audit-export-payload.v1" as const;
export const AUDIT_EXPORT_GENESIS_HASH = "genesis" as const;

export type AuditCheckpointSignatureAlgorithm = "hmac-sha256";
export type AuditExportDestinationKind = "customer_siem" | "worm_compatible";
export type AuditExportJobStatus =
  | "dead_letter"
  | "exported"
  | "queued"
  | "retry_scheduled"
  | "running";
export type AuditExportAttemptStatus = "failed" | "verified";

export interface AuditIntegrityPayload {
  action: string;
  actorId: string;
  auditEventId: string;
  createdAt: string;
  metadata: Record<string, unknown>;
  orgId: string;
  outcome: "failure" | "success";
  resourceId: string;
  resourceType: string;
  schema: typeof AUDIT_INTEGRITY_RECORD_SCHEMA;
}

export interface AuditIntegrityRecord {
  auditEventId: string;
  canonicalPayload: AuditIntegrityPayload;
  createdAt: string;
  id: string;
  orgId: string;
  payloadHash: string;
  previousHash: string;
  recordHash: string;
  sequence: number;
}

export interface AuditIntegrityTenantHead {
  lastRecordHash: string;
  lastSequence: number;
  orgId: string;
  updatedAt: string;
}

export interface AuditIntegrityCheckpoint {
  algorithm: AuditCheckpointSignatureAlgorithm;
  checkpointHash: string;
  createdAt: string;
  firstRecordHash: string;
  fromSequence: number;
  id: string;
  keyVersion: string;
  lastRecordHash: string;
  orgId: string;
  previousCheckpointHash: string;
  recordCount: number;
  rootHash: string;
  schema: typeof AUDIT_INTEGRITY_CHECKPOINT_SCHEMA;
  signature: string;
  toSequence: number;
}

export interface AuditExportDestination {
  active: boolean;
  configReference: string;
  createdAt: string;
  id: string;
  kind: AuditExportDestinationKind;
  orgId: string;
  requireReadback: boolean;
  requireRetentionLock: boolean;
  updatedAt: string;
}

export interface AuditExportJob {
  acknowledgementHash?: string;
  attemptCount: number;
  checkpointHash: string;
  checkpointId: string;
  completedAt?: string;
  createdAt: string;
  deadLetterReason?: string;
  destinationId: string;
  destinationRangeEnd?: string;
  destinationRangeStart?: string;
  fromSequence: number;
  id: string;
  idempotencyKeyHash: string;
  lastErrorCode?: string;
  leaseExpiresAt?: string;
  leaseToken?: string;
  maxAttempts: number;
  nextAttemptAt?: string;
  orgId: string;
  payloadHash: string;
  readbackHash?: string;
  retentionLockEvidence?: string;
  status: AuditExportJobStatus;
  toSequence: number;
  updatedAt: string;
}

export interface AuditExportAttempt {
  acknowledgementHash?: string;
  attempt: number;
  completedAt: string;
  destinationRangeEnd?: string;
  destinationRangeStart?: string;
  errorCode?: string;
  id: string;
  jobId: string;
  orgId: string;
  readbackHash?: string;
  retentionLockEvidence?: string;
  startedAt: string;
  status: AuditExportAttemptStatus;
}

export interface AuditExportIdempotencyReceipt {
  createdAt: string;
  id: string;
  idempotencyKeyHash: string;
  jobId: string;
  orgId: string;
  requestHash: string;
}

export interface AuditRetentionExportGate {
  blockedDestinationIds: string[];
  deletable: boolean;
  requiredThroughSequence?: number;
}

export function auditIntegrityPayload(log: AuditLog): AuditIntegrityPayload {
  return {
    action: log.action,
    actorId: log.actorId,
    auditEventId: log.id,
    createdAt: log.createdAt,
    metadata: log.metadata,
    orgId: log.orgId,
    outcome: log.outcome,
    resourceId: log.resourceId,
    resourceType: log.resourceType,
    schema: AUDIT_INTEGRITY_RECORD_SCHEMA,
  };
}

export function createAuditIntegrityRecord(input: {
  log: AuditLog;
  previousHash?: string;
  sequence: number;
}): AuditIntegrityRecord {
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 1)
    throw new TypeError("Audit integrity sequence must be a positive integer.");
  const canonicalPayload = auditIntegrityPayload(input.log);
  const previousHash = input.previousHash ?? AUDIT_EXPORT_GENESIS_HASH;
  const payloadHash = sha256(canonicalJson(canonicalPayload));
  const recordHash = sha256(
    canonicalJson({
      payloadHash,
      previousHash,
      schema: AUDIT_INTEGRITY_RECORD_SCHEMA,
      sequence: input.sequence,
    }),
  );
  return {
    auditEventId: input.log.id,
    canonicalPayload,
    createdAt: input.log.createdAt,
    id: `audit_record_${input.log.id}`,
    orgId: input.log.orgId,
    payloadHash,
    previousHash,
    recordHash,
    sequence: input.sequence,
  };
}

export function verifyAuditIntegrityRecord(input: {
  expectedPreviousHash: string;
  expectedSequence: number;
  record: AuditIntegrityRecord;
}): boolean {
  const { record } = input;
  if (
    record.sequence !== input.expectedSequence ||
    record.previousHash !== input.expectedPreviousHash ||
    record.canonicalPayload.orgId !== record.orgId ||
    record.canonicalPayload.auditEventId !== record.auditEventId
  )
    return false;
  const payloadHash = sha256(canonicalJson(record.canonicalPayload));
  if (payloadHash !== record.payloadHash) return false;
  return (
    sha256(
      canonicalJson({
        payloadHash,
        previousHash: record.previousHash,
        schema: AUDIT_INTEGRITY_RECORD_SCHEMA,
        sequence: record.sequence,
      }),
    ) === record.recordHash
  );
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("Canonical JSON does not permit non-finite numbers.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  throw new TypeError("Canonical JSON contains an unsupported value.");
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
