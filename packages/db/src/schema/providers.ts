import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { providerKind } from "./enums";
import { organizations } from "./tenancy";

export const providerInstances = pgTable(
  "provider_instances",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    type: providerKind("type").notNull(),
    name: text("name").notNull(),
    baseUrl: text("base_url").notNull(),
    credentialRef: text("credential_ref"),
    capabilities: jsonb("capabilities").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    providerInstancesOrgIdx: index("provider_instances_org_idx").on(
      table.orgId,
      table.createdAt,
    ),
    providerInstancesOrgNameIdx: uniqueIndex(
      "provider_instances_org_name_idx",
    ).on(table.orgId, table.name),
  }),
);

export const providerCredentials = pgTable("provider_credentials", {
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  providerId: text("provider_id")
    .notNull()
    .references(() => providerInstances.id),
  secretRef: text("secret_ref").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const providerCapabilities = pgTable("provider_capabilities", {
  providerId: text("provider_id")
    .primaryKey()
    .references(() => providerInstances.id),
  capabilities: jsonb("capabilities").notNull(),
  discoveredAt: timestamp("discovered_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const baseModels = pgTable(
  "base_models",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    providerId: text("provider_id")
      .notNull()
      .references(() => providerInstances.id),
    name: text("name").notNull(),
    displayName: text("display_name").notNull(),
    capabilities: jsonb("capabilities").notNull(),
    contextWindow: integer("context_window").notNull(),
    pricing: jsonb("pricing"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    baseModelsOrgProviderIdx: index("base_models_org_provider_idx").on(
      table.orgId,
      table.providerId,
    ),
    baseModelsProviderNameIdx: uniqueIndex("base_models_provider_name_idx").on(
      table.providerId,
      table.name,
    ),
  }),
);
