import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organizations } from "./tenancy";

export const idempotencyReceipts = pgTable(
  "idempotency_receipts",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    credentialHash: text("credential_hash").notNull(),
    operation: text("operation").notNull(),
    keyHash: text("key_hash").notNull(),
    requestHash: text("request_hash").notNull(),
    state: text("state").notNull(),
    leaseToken: text("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body"),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    scopeUniqueIdx: uniqueIndex("idempotency_receipt_scope_unique_idx").on(
      table.orgId,
      table.actorType,
      table.actorId,
      table.credentialHash,
      table.operation,
      table.keyHash,
    ),
    expiryIdx: index("idempotency_receipt_expiry_idx").on(
      table.expiresAt,
      table.id,
    ),
    leaseIdx: index("idempotency_receipt_lease_idx").on(
      table.state,
      table.leaseExpiresAt,
    ),
    actorTypeCheck: check(
      "idempotency_receipt_actor_type_check",
      sql`${table.actorType} in ('user', 'service_account')`,
    ),
    stateCheck: check(
      "idempotency_receipt_state_check",
      sql`${table.state} in ('in_progress', 'completed', 'failed')`,
    ),
    keyHashCheck: check(
      "idempotency_receipt_key_hash_check",
      sql`char_length(${table.keyHash}) = 64`,
    ),
    requestHashCheck: check(
      "idempotency_receipt_request_hash_check",
      sql`char_length(${table.requestHash}) = 64`,
    ),
    credentialHashCheck: check(
      "idempotency_receipt_credential_hash_check",
      sql`char_length(${table.credentialHash}) = 64`,
    ),
    responseSizeCheck: check(
      "idempotency_receipt_response_size_check",
      sql`${table.responseBody} is null or octet_length(${table.responseBody}::text) <= 131072`,
    ),
  }),
);
