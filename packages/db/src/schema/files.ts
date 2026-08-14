import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { organizations, workspaces } from "./tenancy";

export const objectRecords = pgTable(
  "object_records",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    ownerType: text("owner_type").notNull(),
    ownerId: text("owner_id").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    objectKey: text("object_key").notNull(),
    purpose: text("purpose").notNull(),
    status: text("status").notNull(),
    lifecycleVersion: bigint("lifecycle_version", { mode: "number" })
      .notNull()
      .default(0),
    lifecycleAttempts: integer("lifecycle_attempts").notNull().default(0),
    lifecycleFailureCode: text("lifecycle_failure_code"),
    lifecycleNextAttemptAt: timestamp("lifecycle_next_attempt_at", {
      withTimezone: true,
    }),
    lifecycleLeaseOwner: text("lifecycle_lease_owner"),
    lifecycleLeaseToken: text("lifecycle_lease_token"),
    lifecycleLeaseExpiresAt: timestamp("lifecycle_lease_expires_at", {
      withTimezone: true,
    }),
    attachedAt: timestamp("attached_at", { withTimezone: true }),
    retainedAt: timestamp("retained_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    objectRecordsWorkspaceUpdatedIdx: index(
      "object_records_workspace_updated_idx",
    ).on(table.orgId, table.workspaceId, table.updatedAt),
    objectRecordsOwnerUpdatedIdx: index("object_records_owner_updated_idx").on(
      table.orgId,
      table.ownerId,
      table.updatedAt,
    ),
    objectRecordsSha256Idx: index("object_records_sha256_idx").on(
      table.orgId,
      table.sha256,
    ),
    objectRecordsLifecycleClaimIdx: index(
      "object_records_lifecycle_claim_idx",
    ).on(
      table.status,
      table.lifecycleNextAttemptAt,
      table.lifecycleLeaseExpiresAt,
      table.updatedAt,
      table.id,
    ),
    objectRecordsStatusCheck: check(
      "object_records_status_check",
      sql`${table.status} IN ('uploading','quarantined','scanning','extracting','transcoding','ready','attached','retained','failed','deleted','available')`,
    ),
    objectRecordsLifecycleAttemptsCheck: check(
      "object_records_lifecycle_attempts_check",
      sql`${table.lifecycleAttempts} BETWEEN 0 AND 100`,
    ),
    objectRecordsLifecycleFailureCodeCheck: check(
      "object_records_lifecycle_failure_code_check",
      sql`${table.lifecycleFailureCode} IS NULL OR ${table.lifecycleFailureCode} ~ '^[a-z0-9_]{1,80}$'`,
    ),
    objectRecordsLifecycleLeaseCheck: check(
      "object_records_lifecycle_lease_check",
      sql`(${table.lifecycleLeaseOwner} IS NULL AND ${table.lifecycleLeaseToken} IS NULL AND ${table.lifecycleLeaseExpiresAt} IS NULL) OR (${table.lifecycleLeaseOwner} IS NOT NULL AND ${table.lifecycleLeaseToken} IS NOT NULL AND ${table.lifecycleLeaseExpiresAt} IS NOT NULL)`,
    ),
  }),
);
