import {
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { messageParts, messages } from "./chats";
import { objectRecords } from "./files";
import { organizations, workspaces } from "./tenancy";

export const messageFileReferences = pgTable(
  "message_file_references",
  {
    messagePartId: text("message_part_id")
      .notNull()
      .references(() => messageParts.id, { onDelete: "cascade" }),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    fileId: text("file_id")
      .notNull()
      .references(() => objectRecords.id, { onDelete: "restrict" }),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    messageFileReferencesPk: primaryKey({
      name: "message_file_references_pk",
      columns: [table.messagePartId, table.fileId],
    }),
    messageFileReferencesFileIdx: index("message_file_references_file_idx").on(
      table.fileId,
      table.messageId,
      table.messagePartId,
    ),
    messageFileReferencesMessageIdx: index(
      "message_file_references_message_idx",
    ).on(table.messageId, table.fileId, table.messagePartId),
    messageFileReferencesIdentityCheck: check(
      "message_file_references_identity_check",
      sql`octet_length(${table.messagePartId}) BETWEEN 1 AND 300
        AND octet_length(${table.messageId}) BETWEEN 1 AND 300
        AND octet_length(${table.fileId}) BETWEEN 1 AND 300
        AND octet_length(${table.orgId}) BETWEEN 1 AND 300
        AND octet_length(${table.workspaceId}) BETWEEN 1 AND 300`,
    ),
  }),
);
