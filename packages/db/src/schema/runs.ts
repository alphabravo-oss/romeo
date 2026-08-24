import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { agentModels, agentVersions } from "./agents";
import { chats } from "./chats";
import { runStatus } from "./enums";
import { baseModels, providerInstances } from "./providers";
import { organizations, workspaces } from "./tenancy";
import { users } from "./users";

export const runs = pgTable(
  "runs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    agentId: text("agent_id")
      .notNull()
      .references(() => agentModels.id),
    agentVersionId: text("agent_version_id")
      .notNull()
      .references(() => agentVersions.id),
    modelId: text("model_id")
      .notNull()
      .references(() => baseModels.id),
    providerId: text("provider_id")
      .notNull()
      .references(() => providerInstances.id),
    status: runStatus("status").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    nextEventSequence: bigint("next_event_sequence", { mode: "number" })
      .notNull()
      .default(0),
  },
  (table) => ({
    runsOrgIdIdUnique: uniqueIndex("runs_org_id_id_uidx").on(
      table.orgId,
      table.id,
    ),
    runsChatCreatedIdx: index("runs_chat_created_idx").on(
      table.chatId,
      table.createdAt,
    ),
    runsOrgCreatedIdx: index("runs_org_created_idx").on(
      table.orgId,
      table.createdAt,
    ),
    runsOrgCompletedIdx: index("runs_org_completed_idx").on(
      table.orgId,
      table.completedAt,
      table.id,
    ),
  }),
);

export const runEvents = pgTable(
  "run_events",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    type: text("type").notNull(),
    data: jsonb("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    runEventSequenceIdx: uniqueIndex("run_event_sequence_idx").on(
      table.runId,
      table.sequence,
    ),
  }),
);

export const runSteps = pgTable("run_steps", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  status: text("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const toolCalls = pgTable(
  "tool_calls",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    agentId: text("agent_id")
      .notNull()
      .references(() => agentModels.id),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id),
    toolId: text("tool_id").notNull(),
    status: text("status").notNull(),
    riskLevel: text("risk_level").notNull(),
    approvalRequired: boolean("approval_required").notNull().default(false),
    inputKeys: text("input_keys").array().notNull(),
    outputKeys: text("output_keys").array().notNull(),
    errorCode: text("error_code"),
    runId: text("run_id").references(() => runs.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    toolCallsOrgStartedIdx: index("tool_calls_org_started_idx").on(
      table.orgId,
      table.startedAt,
    ),
    toolCallsPageStartedIdx: index("tool_calls_org_agent_started_id_idx").on(
      table.orgId,
      table.agentId,
      table.startedAt,
      table.id,
    ),
    toolCallsPageCompletedIdx: index(
      "tool_calls_org_agent_completed_id_idx",
    ).on(table.orgId, table.agentId, table.completedAt, table.id),
    toolCallsPageStatusIdx: index("tool_calls_org_agent_status_id_idx").on(
      table.orgId,
      table.agentId,
      table.status,
      table.id,
    ),
    toolCallsPageToolIdx: index("tool_calls_org_agent_tool_id_idx").on(
      table.orgId,
      table.agentId,
      table.toolId,
      table.id,
    ),
    toolCallsSearchIdx: index("tool_calls_search_trgm_idx").using(
      "gin",
      sql`(lower(coalesce(${table.id}, '') || chr(31) || coalesce(${table.toolId}, '') || chr(31) || coalesce(${table.runId}, '') || chr(31) || coalesce(${table.errorCode}, ''))) gin_trgm_ops`,
    ),
    toolCallsRunIdx: index("tool_calls_run_idx").on(table.runId),
  }),
);
