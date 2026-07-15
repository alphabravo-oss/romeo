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
    baseModelId: text("base_model_id")
      .notNull()
      .references(() => baseModels.id),
    systemPrompt: text("system_prompt").notNull(),
    parameters: jsonb("parameters").notNull(),
    memoryPolicy: jsonb("memory_policy")
      .notNull()
      .default({ mode: "disabled" }),
    safetySettings: jsonb("safety_settings").notNull().default({}),
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
    safetySettings: jsonb("safety_settings").notNull().default({}),
    voiceProfileId: text("voice_profile_id").references(() => voiceProfiles.id),
    knowledgeBaseBindings: jsonb("knowledge_base_bindings")
      .notNull()
      .default([]),
    toolBindings: jsonb("tool_bindings").notNull().default([]),
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
  }),
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
