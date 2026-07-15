import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organizations, workspaces } from "./tenancy";
import { users } from "./users";

export const delegatedOAuthConnections = pgTable(
  "delegated_oauth_connections",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    providerId: text("provider_id").notNull(),
    connectorType: text("connector_type").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    providerAccountLogin: text("provider_account_login"),
    scopes: jsonb("scopes").notNull(),
    status: text("status").notNull(),
    token: jsonb("token").notNull(),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    delegatedOAuthConnectionsUserUpdatedIdx: index(
      "delegated_oauth_connections_user_updated_idx",
    ).on(table.orgId, table.workspaceId, table.userId, table.updatedAt),
    delegatedOAuthConnectionsStatusIdx: index(
      "delegated_oauth_connections_status_idx",
    ).on(table.orgId, table.status, table.updatedAt),
    delegatedOAuthConnectionsProviderAccountIdx: uniqueIndex(
      "delegated_oauth_connections_provider_account_idx",
    ).on(
      table.orgId,
      table.workspaceId,
      table.userId,
      table.providerId,
      table.connectorType,
      table.providerAccountId,
    ),
  }),
);
