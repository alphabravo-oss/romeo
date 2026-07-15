import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

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
  }),
);
