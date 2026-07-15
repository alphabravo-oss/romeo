import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { principalType, resourcePermission } from "./enums";
import { organizations } from "./tenancy";
import { users } from "./users";

export const resourceGrants = pgTable(
  "resource_grants",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    principalType: principalType("principal_type").notNull(),
    principalId: text("principal_id").notNull(),
    permission: resourcePermission("permission").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    resourceGrantLookupIdx: index("resource_grant_lookup_idx").on(
      table.orgId,
      table.resourceType,
      table.resourceId,
      table.permission,
    ),
    resourceGrantPrincipalIdx: index("resource_grant_principal_idx").on(
      table.orgId,
      table.principalType,
      table.principalId,
    ),
    resourceGrantUniqueIdx: uniqueIndex("resource_grant_unique_idx").on(
      table.orgId,
      table.resourceType,
      table.resourceId,
      table.principalType,
      table.principalId,
      table.permission,
    ),
  }),
);

export const serviceAccounts = pgTable(
  "service_accounts",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    scopes: text("scopes").array().notNull(),
    createdBy: text("created_by").notNull(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    serviceAccountsOrgIdx: index("service_accounts_org_idx").on(
      table.orgId,
      table.createdAt,
    ),
  }),
);

export const userSessions = pgTable(
  "user_sessions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    hashedToken: text("hashed_token").notNull(),
    scopes: text("scopes").array().notNull(),
    isAdmin: boolean("is_admin").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userSessionsHashIdx: uniqueIndex("user_sessions_hash_idx").on(
      table.hashedToken,
    ),
    userSessionsUserIdx: index("user_sessions_user_idx").on(
      table.orgId,
      table.userId,
      table.createdAt,
    ),
  }),
);

export const localPasswordCredentials = pgTable(
  "local_password_credentials",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    emailNormalized: text("email_normalized").notNull(),
    passwordHash: text("password_hash").notNull(),
    failedAttemptCount: integer("failed_attempt_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    passwordUpdatedAt: timestamp("password_updated_at", {
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    localPasswordCredentialsUserIdx: uniqueIndex(
      "local_password_credentials_user_idx",
    ).on(table.orgId, table.userId),
    localPasswordCredentialsEmailIdx: uniqueIndex(
      "local_password_credentials_email_idx",
    ).on(table.orgId, table.emailNormalized),
  }),
);

export const localMfaFactors = pgTable(
  "local_mfa_factors",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    type: text("type").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull(),
    secretEncrypted: text("secret_encrypted").notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    localMfaFactorsUserStatusIdx: index("local_mfa_factors_user_status_idx").on(
      table.orgId,
      table.userId,
      table.status,
      table.updatedAt,
    ),
    localMfaFactorsUserTypeIdx: index("local_mfa_factors_user_type_idx").on(
      table.orgId,
      table.userId,
      table.type,
    ),
  }),
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    userId: text("user_id").references(() => users.id),
    serviceAccountId: text("service_account_id").references(
      () => serviceAccounts.id,
    ),
    name: text("name").notNull(),
    hashedToken: text("hashed_token").notNull(),
    scopes: text("scopes").array().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    apiKeysHashIdx: uniqueIndex("api_keys_hash_idx").on(table.hashedToken),
    apiKeysUserIdx: index("api_keys_user_idx").on(
      table.orgId,
      table.userId,
      table.createdAt,
    ),
    apiKeysServiceAccountIdx: index("api_keys_service_account_idx").on(
      table.orgId,
      table.serviceAccountId,
      table.createdAt,
    ),
  }),
);

export const deviceAuthorizations = pgTable(
  "device_authorizations",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    scopes: text("scopes").array().notNull(),
    hashedRefreshToken: text("hashed_refresh_token").notNull(),
    accessApiKeyId: text("access_api_key_id")
      .notNull()
      .references(() => apiKeys.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastRefreshedAt: timestamp("last_refreshed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    deviceAuthorizationsRefreshHashIdx: uniqueIndex(
      "device_authorizations_refresh_hash_idx",
    ).on(table.hashedRefreshToken),
    deviceAuthorizationsUserIdx: index("device_authorizations_user_idx").on(
      table.orgId,
      table.userId,
      table.updatedAt,
    ),
  }),
);
