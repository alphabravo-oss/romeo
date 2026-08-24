import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { organizations, workspaces } from "./tenancy";

export const contentDeletionOperations = pgTable(
  "content_deletion_operations",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    targetGeneration: text("target_generation").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull(),
    externalVectorVerificationRequired: boolean(
      "external_vector_verification_required",
    )
      .notNull()
      .default(false),
    objectKey: text("object_key"),
    knowledgeBaseId: text("knowledge_base_id"),
    requestedByType: text("requested_by_type").notNull(),
    requestedById: text("requested_by_id").notNull(),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    failureCode: text("failure_code"),
    legalHoldEvaluatedAt: timestamp("legal_hold_evaluated_at", {
      withTimezone: true,
    }).notNull(),
    objectDeletedAt: timestamp("object_deleted_at", { withTimezone: true }),
    objectVerifiedAt: timestamp("object_verified_at", { withTimezone: true }),
    vectorsDeletedAt: timestamp("vectors_deleted_at", { withTimezone: true }),
    vectorsVerifiedAt: timestamp("vectors_verified_at", { withTimezone: true }),
    relationalDeletedAt: timestamp("relational_deleted_at", {
      withTimezone: true,
    }),
    attestedAt: timestamp("attested_at", { withTimezone: true }),
    leaseOwner: text("lease_owner"),
    leaseToken: text("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    leaseFence: integer("lease_fence").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    idempotency: uniqueIndex(
      "content_deletion_operations_org_idempotency_uidx",
    ).on(table.orgId, table.idempotencyKey),
    activeTarget: uniqueIndex("content_deletion_operations_active_target_uidx")
      .on(table.orgId, table.targetType, table.targetId)
      .where(sql`${table.status} <> 'completed'`),
    claim: index("content_deletion_operations_claim_idx").on(
      table.orgId,
      table.status,
      table.nextAttemptAt,
      table.leaseExpiresAt,
      table.createdAt,
      table.id,
    ),
    statusCheck: check(
      "content_deletion_operations_status_check",
      sql`${table.status} IN ('pending','processing','failed','blocked','completed')`,
    ),
    targetCheck: check(
      "content_deletion_operations_target_check",
      sql`${table.targetType} IN ('file_object','knowledge_source')`,
    ),
    actorCheck: check(
      "content_deletion_operations_actor_check",
      sql`${table.requestedByType} IN ('user','service_account')`,
    ),
    attemptsCheck: check(
      "content_deletion_operations_attempts_check",
      sql`${table.attempts} BETWEEN 0 AND 20`,
    ),
    leaseCheck: check(
      "content_deletion_operations_lease_check",
      sql`(${table.leaseOwner} IS NULL AND ${table.leaseToken} IS NULL AND ${table.leaseExpiresAt} IS NULL) OR (${table.leaseOwner} IS NOT NULL AND ${table.leaseToken} IS NOT NULL AND ${table.leaseExpiresAt} IS NOT NULL)`,
    ),
  }),
);
