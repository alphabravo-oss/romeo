import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type {
  DataExportCounts,
  DataExportLimits,
  DataExportResolvedRequest,
  GovernanceExportCheckpoint,
} from "@romeo/core";
import { organizations, workspaces } from "./tenancy";

export const governanceExportJobs = pgTable(
  "governance_export_jobs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id"),
    createdBy: text("created_by").notNull(),
    request: jsonb("request").$type<DataExportResolvedRequest>().notNull(),
    snapshotAt: timestamp("snapshot_at", { withTimezone: true }).notNull(),
    state: text("state").notNull(),
    percent: integer("percent").notNull().default(0),
    checkpoint: jsonb("checkpoint")
      .$type<GovernanceExportCheckpoint>()
      .notNull(),
    counts: jsonb("counts").$type<DataExportCounts>().notNull(),
    limits: jsonb("limits").$type<DataExportLimits>().notNull(),
    warnings: jsonb("warnings").$type<string[]>().notNull(),
    exclusions: jsonb("exclusions").$type<string[]>().notNull(),
    errorCode: text("error_code"),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    leaseAttempt: integer("lease_attempt").notNull().default(0),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    tenantWorkspaceFk: foreignKey({
      columns: [table.orgId, table.workspaceId],
      foreignColumns: [workspaces.orgId, workspaces.id],
      name: "governance_export_jobs_org_workspace_fk",
    }).onDelete("cascade"),
    orgIdUnique: uniqueIndex("governance_export_jobs_org_id_uidx").on(
      table.orgId,
      table.id,
    ),
    claimIdx: index("governance_export_jobs_claim_idx").on(
      table.orgId,
      table.state,
      table.createdAt,
      table.id,
    ),
    listIdx: index("governance_export_jobs_list_idx").on(
      table.orgId,
      table.createdAt,
      table.id,
    ),
    stateValid: check(
      "governance_export_jobs_state_valid",
      sql`${table.state} in ('queued', 'running', 'artifact_ready', 'failed', 'expired', 'deleted')`,
    ),
    progressValid: check(
      "governance_export_jobs_progress_valid",
      sql`${table.percent} between 0 and 100 and ${table.leaseAttempt} >= 0 and ${table.version} > 0`,
    ),
    payloadShapeValid: check(
      "governance_export_jobs_payload_shape_valid",
      sql`jsonb_typeof(${table.request}) = 'object'
        and jsonb_typeof(${table.checkpoint}) = 'object'
        and jsonb_typeof(${table.counts}) = 'object'
        and jsonb_typeof(${table.limits}) = 'object'
        and jsonb_typeof(${table.warnings}) = 'array'
        and jsonb_typeof(${table.exclusions}) = 'array'
        and ${table.checkpoint} ?& array['datasetIndex', 'partCount', 'processedRows', 'sizeBytes']
        and (${table.checkpoint} ->> 'datasetIndex')::bigint >= 0
        and (${table.checkpoint} ->> 'partCount')::bigint >= 0
        and (${table.checkpoint} ->> 'processedRows')::bigint >= 0
        and (${table.checkpoint} ->> 'sizeBytes')::bigint >= 0`,
    ),
    scopeValid: check(
      "governance_export_jobs_scope_valid",
      sql`(
        ${table.request} ->> 'scope' = 'org' and ${table.workspaceId} is null
      ) or (
        ${table.request} ->> 'scope' = 'workspace'
        and ${table.workspaceId} is not null
        and ${table.request} ->> 'workspaceId' = ${table.workspaceId}
      )`,
    ),
    leaseValid: check(
      "governance_export_jobs_lease_valid",
      sql`(${table.state} = 'running' and ${table.leaseOwner} is not null and ${table.leaseExpiresAt} is not null)
        or (${table.state} <> 'running' and ${table.leaseOwner} is null and ${table.leaseExpiresAt} is null)`,
    ),
    terminalShapeValid: check(
      "governance_export_jobs_terminal_shape_valid",
      sql`(${table.state} = 'artifact_ready' and ${table.percent} = 100 and ${table.completedAt} is not null)
        or ${table.state} <> 'artifact_ready'`,
    ),
    deletedShapeValid: check(
      "governance_export_jobs_deleted_shape_valid",
      sql`(${table.state} = 'deleted' and ${table.deletedAt} is not null)
        or (${table.state} <> 'deleted' and ${table.deletedAt} is null)`,
    ),
  }),
);

export const governanceExportArtifacts = pgTable(
  "governance_export_artifacts",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    objectKey: text("object_key").notNull(),
    contentType: text("content_type").notNull(),
    fileName: text("file_name").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    partCount: integer("part_count").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    tenantJobFk: foreignKey({
      columns: [table.orgId, table.jobId],
      foreignColumns: [governanceExportJobs.orgId, governanceExportJobs.id],
      name: "governance_export_artifacts_org_job_fk",
    }).onDelete("cascade"),
    jobUnique: uniqueIndex("governance_export_artifacts_job_uidx").on(
      table.orgId,
      table.jobId,
    ),
    objectKeyUnique: uniqueIndex(
      "governance_export_artifacts_object_key_uidx",
    ).on(table.objectKey),
    expiryIdx: index("governance_export_artifacts_expiry_idx").on(
      table.orgId,
      table.expiresAt,
      table.id,
    ),
    contentTypeValid: check(
      "governance_export_artifacts_content_type_valid",
      sql`${table.contentType} in ('application/json', 'application/x-ndjson')`,
    ),
    shapeValid: check(
      "governance_export_artifacts_shape_valid",
      sql`${table.sizeBytes} >= 0
        and ${table.partCount} > 0
        and ${table.sha256} ~ '^[a-f0-9]{64}$'
        and ${table.expiresAt} > ${table.createdAt}`,
    ),
  }),
);
