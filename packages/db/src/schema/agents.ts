import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { baseModels } from "./providers";
import { workspaces } from "./tenancy";
import { users } from "./users";
import { organizations } from "./tenancy";
import { voiceProfiles } from "./voices";

export const agentModels = pgTable(
  "agent_models",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    icon: text("icon"),
    avatarUrl: text("avatar_url"),
    baseModelId: text("base_model_id")
      .notNull()
      .references(() => baseModels.id),
    systemPrompt: text("system_prompt").notNull(),
    parameters: jsonb("parameters").notNull(),
    memoryPolicy: jsonb("memory_policy")
      .notNull()
      .default({ mode: "disabled" }),
    promptSuggestions: jsonb("prompt_suggestions").notNull().default([]),
    safetySettings: jsonb("safety_settings").notNull().default({}),
    tags: jsonb("tags").notNull().default([]),
    voiceProfileId: text("voice_profile_id").references(() => voiceProfiles.id),
    publishedVersionId: text("published_version_id"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => ({
    agentModelsWorkspaceIdx: index("agent_models_workspace_idx").on(
      table.workspaceId,
      table.updatedAt,
    ),
    agentModelsWorkspaceSlugIdx: uniqueIndex(
      "agent_models_workspace_slug_idx",
    ).on(table.workspaceId, table.slug),
  }),
);

export const agentVersions = pgTable(
  "agent_versions",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agentModels.id),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    version: integer("version").notNull(),
    status: text("status").notNull(),
    baseModelId: text("base_model_id")
      .notNull()
      .references(() => baseModels.id),
    systemPrompt: text("system_prompt").notNull(),
    parameters: jsonb("parameters").notNull(),
    memoryPolicy: jsonb("memory_policy")
      .notNull()
      .default({ mode: "disabled" }),
    promptSuggestions: jsonb("prompt_suggestions").notNull().default([]),
    safetySettings: jsonb("safety_settings").notNull().default({}),
    tags: jsonb("tags").notNull().default([]),
    voiceProfileId: text("voice_profile_id").references(() => voiceProfiles.id),
    knowledgeBaseBindings: jsonb("knowledge_base_bindings")
      .notNull()
      .default([]),
    toolBindings: jsonb("tool_bindings").notNull().default([]),
    capabilityDefaults: jsonb("capability_defaults").notNull().default([]),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    agentVersionsAgentVersionIdx: uniqueIndex(
      "agent_versions_agent_version_idx",
    ).on(table.agentId, table.version),
    capabilityDefaultsSizeCheck: check(
      "agent_versions_capability_defaults_size_check",
      sql`octet_length(${table.capabilityDefaults}::text) <= 16384`,
    ),
  }),
);

export const managedModelCustomizationPolicies = pgTable(
  "managed_model_customization_policies",
  {
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    allowCommunicationStyle: boolean("allow_communication_style")
      .notNull()
      .default(false),
    allowResponseLength: boolean("allow_response_length")
      .notNull()
      .default(false),
    allowLanguage: boolean("allow_language").notNull().default(false),
    allowCustomInstructions: boolean("allow_custom_instructions")
      .notNull()
      .default(false),
    allowPersonalMemory: boolean("allow_personal_memory")
      .notNull()
      .default(false),
    allowVoiceSelection: boolean("allow_voice_selection")
      .notNull()
      .default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "managed_model_policy_agent_fk",
      columns: [table.agentId],
      foreignColumns: [agentModels.id],
    }).onDelete("cascade"),
    primaryKey({
      name: "managed_model_customization_policies_org_agent_pk",
      columns: [table.orgId, table.agentId],
    }),
  ],
);

export const managedModelPreferences = pgTable(
  "managed_model_preferences",
  {
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    agentId: text("agent_id")
      .notNull()
      .references(() => agentModels.id, { onDelete: "cascade" }),
    principalType: text("principal_type").notNull(),
    principalId: text("principal_id").notNull(),
    communicationStyle: text("communication_style"),
    responseLength: text("response_length"),
    language: text("language"),
    encodedCustomInstructions: text("encrypted_custom_instructions"),
    personalMemoryEnabled: boolean("personal_memory_enabled"),
    voiceProfileId: text("voice_profile_id").references(
      () => voiceProfiles.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "managed_model_preferences_tenant_principal_pk",
      columns: [
        table.orgId,
        table.agentId,
        table.principalType,
        table.principalId,
      ],
    }),
    index("managed_model_preferences_agent_idx").on(
      table.orgId,
      table.agentId,
      table.updatedAt,
    ),
  ],
);

export const agentToolBindings = pgTable(
  "agent_tool_bindings",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    agentId: text("agent_id")
      .notNull()
      .references(() => agentModels.id),
    toolId: text("tool_id").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    approvalRequired: boolean("approval_required").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    agentToolBindingUniqueIdx: uniqueIndex(
      "agent_tool_bindings_agent_tool_unique_idx",
    ).on(table.agentId, table.toolId),
  }),
);
