import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type { AuditIntegrityPayload } from "@romeo/core";

import { auditLogs } from "./audit";
import { organizations } from "./tenancy";

export const auditIntegrityTenantHeads = pgTable(
  "audit_integrity_tenant_heads",
  {
    orgId: text("org_id")
      .primaryKey()
      .references(() => organizations.id),
    lastSequence: bigint("last_sequence", { mode: "number" }).notNull(),
    lastRecordHash: text("last_record_hash").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    sequenceCheck: check(
      "audit_integrity_tenant_heads_sequence_check",
      sql`${table.lastSequence} > 0`,
    ),
    hashShapeCheck: check(
      "audit_integrity_tenant_heads_hash_shape_check",
      sql`char_length(${table.lastRecordHash}) = 64`,
    ),
  }),
);

export const auditIntegrityRecords = pgTable(
  "audit_integrity_records",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    auditEventId: text("audit_event_id")
      .notNull()
      .references(() => auditLogs.id, { onDelete: "cascade" }),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    previousHash: text("previous_hash").notNull(),
    payloadHash: text("payload_hash").notNull(),
    recordHash: text("record_hash").notNull(),
    canonicalPayload: jsonb("canonical_payload")
      .$type<AuditIntegrityPayload>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantSequenceUnique: uniqueIndex(
      "audit_integrity_records_org_sequence_uidx",
    ).on(table.orgId, table.sequence),
    tenantEventUnique: uniqueIndex("audit_integrity_records_org_event_uidx").on(
      table.orgId,
      table.auditEventId,
    ),
    tenantHashUnique: uniqueIndex("audit_integrity_records_org_hash_uidx").on(
      table.orgId,
      table.recordHash,
    ),
    hashShapeCheck: check(
      "audit_integrity_records_hash_shape_check",
      sql`char_length(${table.payloadHash}) = 64 and char_length(${table.recordHash}) = 64 and (${table.previousHash} = 'genesis' or char_length(${table.previousHash}) = 64)`,
    ),
    sequenceCheck: check(
      "audit_integrity_records_sequence_check",
      sql`${table.sequence} > 0`,
    ),
  }),
);

export const auditIntegrityCheckpoints = pgTable(
  "audit_integrity_checkpoints",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    schema: text("schema").notNull(),
    fromSequence: bigint("from_sequence", { mode: "number" }).notNull(),
    toSequence: bigint("to_sequence", { mode: "number" }).notNull(),
    recordCount: integer("record_count").notNull(),
    firstRecordHash: text("first_record_hash").notNull(),
    lastRecordHash: text("last_record_hash").notNull(),
    rootHash: text("root_hash").notNull(),
    previousCheckpointHash: text("previous_checkpoint_hash").notNull(),
    algorithm: text("algorithm").notNull(),
    keyVersion: text("key_version").notNull(),
    signature: text("signature").notNull(),
    checkpointHash: text("checkpoint_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantRangeUnique: uniqueIndex(
      "audit_integrity_checkpoints_org_range_uidx",
    ).on(table.orgId, table.fromSequence, table.toSequence),
    tenantHashUnique: uniqueIndex(
      "audit_integrity_checkpoints_org_hash_uidx",
    ).on(table.orgId, table.checkpointHash),
    tenantCreatedIdx: index("audit_integrity_checkpoints_org_created_idx").on(
      table.orgId,
      table.createdAt,
      table.id,
    ),
    rangeCheck: check(
      "audit_integrity_checkpoints_range_check",
      sql`${table.fromSequence} > 0 and ${table.toSequence} >= ${table.fromSequence} and ${table.recordCount} = (${table.toSequence} - ${table.fromSequence} + 1)`,
    ),
    algorithmCheck: check(
      "audit_integrity_checkpoints_algorithm_check",
      sql`${table.algorithm} in ('hmac-sha256')`,
    ),
    schemaCheck: check(
      "audit_integrity_checkpoints_schema_check",
      sql`${table.schema} = 'romeo.audit-integrity-checkpoint.v1'`,
    ),
    hashShapeCheck: check(
      "audit_integrity_checkpoints_hash_shape_check",
      sql`char_length(${table.firstRecordHash}) = 64 and char_length(${table.lastRecordHash}) = 64 and char_length(${table.rootHash}) = 64 and (${table.previousCheckpointHash} = 'genesis' or char_length(${table.previousCheckpointHash}) = 64) and char_length(${table.signature}) = 64 and char_length(${table.checkpointHash}) = 64 and char_length(${table.keyVersion}) between 1 and 80`,
    ),
  }),
);

export const auditExportDestinations = pgTable(
  "audit_export_destinations",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    kind: text("kind").notNull(),
    configReference: text("config_reference").notNull(),
    active: boolean("active").notNull().default(true),
    requireReadback: boolean("require_readback").notNull().default(true),
    requireRetentionLock: boolean("require_retention_lock")
      .notNull()
      .default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantKindUnique: uniqueIndex("audit_export_destinations_org_kind_uidx").on(
      table.orgId,
      table.kind,
    ),
    kindCheck: check(
      "audit_export_destinations_kind_check",
      sql`${table.kind} in ('customer_siem', 'worm_compatible')`,
    ),
    configReferenceCheck: check(
      "audit_export_destinations_config_reference_check",
      sql`char_length(${table.configReference}) between 1 and 512`,
    ),
  }),
);

export const auditExportJobs = pgTable(
  "audit_export_jobs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    destinationId: text("destination_id")
      .notNull()
      .references(() => auditExportDestinations.id),
    checkpointId: text("checkpoint_id")
      .notNull()
      .references(() => auditIntegrityCheckpoints.id),
    checkpointHash: text("checkpoint_hash").notNull(),
    fromSequence: bigint("from_sequence", { mode: "number" }).notNull(),
    toSequence: bigint("to_sequence", { mode: "number" }).notNull(),
    idempotencyKeyHash: text("idempotency_key_hash").notNull(),
    payloadHash: text("payload_hash").notNull(),
    status: text("status").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    leaseToken: text("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    acknowledgementHash: text("acknowledgement_hash"),
    destinationRangeStart: text("destination_range_start"),
    destinationRangeEnd: text("destination_range_end"),
    readbackHash: text("readback_hash"),
    retentionLockEvidence: text("retention_lock_evidence"),
    lastErrorCode: text("last_error_code"),
    deadLetterReason: text("dead_letter_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    tenantIdempotencyUnique: uniqueIndex(
      "audit_export_jobs_org_idempotency_uidx",
    ).on(table.orgId, table.idempotencyKeyHash),
    dueIdx: index("audit_export_jobs_due_idx").on(
      table.orgId,
      table.status,
      table.nextAttemptAt,
      table.createdAt,
    ),
    destinationRangeIdx: index("audit_export_jobs_destination_range_idx").on(
      table.orgId,
      table.destinationId,
      table.toSequence,
    ),
    rangeCheck: check(
      "audit_export_jobs_range_check",
      sql`${table.fromSequence} > 0 and ${table.toSequence} >= ${table.fromSequence}`,
    ),
    attemptCheck: check(
      "audit_export_jobs_attempt_check",
      sql`${table.attemptCount} >= 0 and ${table.maxAttempts} between 1 and 20 and ${table.attemptCount} <= ${table.maxAttempts}`,
    ),
    statusCheck: check(
      "audit_export_jobs_status_check",
      sql`${table.status} in ('queued', 'running', 'retry_scheduled', 'exported', 'dead_letter')`,
    ),
    hashShapeCheck: check(
      "audit_export_jobs_hash_shape_check",
      sql`char_length(${table.checkpointHash}) = 64 and char_length(${table.idempotencyKeyHash}) = 64 and char_length(${table.payloadHash}) = 64 and (${table.acknowledgementHash} is null or char_length(${table.acknowledgementHash}) = 64) and (${table.readbackHash} is null or char_length(${table.readbackHash}) = 64)`,
    ),
  }),
);

export const auditExportAttempts = pgTable(
  "audit_export_attempts",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    jobId: text("job_id")
      .notNull()
      .references(() => auditExportJobs.id, { onDelete: "cascade" }),
    attempt: integer("attempt").notNull(),
    status: text("status").notNull(),
    acknowledgementHash: text("acknowledgement_hash"),
    destinationRangeStart: text("destination_range_start"),
    destinationRangeEnd: text("destination_range_end"),
    readbackHash: text("readback_hash"),
    retentionLockEvidence: text("retention_lock_evidence"),
    errorCode: text("error_code"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    jobAttemptUnique: uniqueIndex("audit_export_attempts_job_attempt_uidx").on(
      table.jobId,
      table.attempt,
    ),
    tenantCompletedIdx: index("audit_export_attempts_org_completed_idx").on(
      table.orgId,
      table.completedAt,
    ),
    statusCheck: check(
      "audit_export_attempts_status_check",
      sql`${table.status} in ('failed', 'verified')`,
    ),
    hashShapeCheck: check(
      "audit_export_attempts_hash_shape_check",
      sql`(${table.acknowledgementHash} is null or char_length(${table.acknowledgementHash}) = 64) and (${table.readbackHash} is null or char_length(${table.readbackHash}) = 64)`,
    ),
  }),
);

export const auditExportIdempotencyReceipts = pgTable(
  "audit_export_idempotency_receipts",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    idempotencyKeyHash: text("idempotency_key_hash").notNull(),
    requestHash: text("request_hash").notNull(),
    jobId: text("job_id")
      .notNull()
      .references(() => auditExportJobs.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantKeyUnique: uniqueIndex(
      "audit_export_idempotency_receipts_org_key_uidx",
    ).on(table.orgId, table.idempotencyKeyHash),
    hashShapeCheck: check(
      "audit_export_idempotency_receipts_hash_shape_check",
      sql`char_length(${table.idempotencyKeyHash}) = 64 and char_length(${table.requestHash}) = 64`,
    ),
  }),
);
