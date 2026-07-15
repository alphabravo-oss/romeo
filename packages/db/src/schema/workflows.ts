import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organizations, workspaces } from "./tenancy";
import { users } from "./users";

export const workflowDefinitions = pgTable(
  "workflow_definitions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    name: text("name").notNull(),
    description: text("description"),
    steps: jsonb("steps").$type<Array<Record<string, unknown>>>().notNull(),
    schedule: jsonb("schedule").$type<Record<string, unknown>>(),
    nextScheduledRunAt: timestamp("next_scheduled_run_at", {
      withTimezone: true,
    }),
    enabled: boolean("enabled").notNull().default(true),
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
    workflowDefinitionsWorkspaceUpdatedIdx: index(
      "workflow_definitions_workspace_updated_idx",
    ).on(table.orgId, table.workspaceId, table.updatedAt),
    workflowDefinitionsWorkspaceNameIdx: uniqueIndex(
      "workflow_definitions_workspace_name_idx",
    ).on(table.workspaceId, table.name),
    workflowDefinitionsDueScheduleIdx: index(
      "workflow_definitions_due_schedule_idx",
    ).on(table.orgId, table.enabled, table.nextScheduledRunAt),
  }),
);

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflowDefinitions.id),
    status: text("status").notNull(),
    input: jsonb("input").notNull(),
    steps: jsonb("steps").$type<Array<Record<string, unknown>>>().notNull(),
    currentStepId: text("current_step_id"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    approvedBy: text("approved_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    workflowRunsWorkflowCreatedIdx: index(
      "workflow_runs_workflow_created_idx",
    ).on(table.orgId, table.workflowId, table.createdAt),
    workflowRunsStatusUpdatedIdx: index("workflow_runs_status_updated_idx").on(
      table.orgId,
      table.status,
      table.updatedAt,
    ),
    workflowRunsWorkspaceCreatedIdx: index(
      "workflow_runs_workspace_created_idx",
    ).on(table.orgId, table.workspaceId, table.createdAt),
  }),
);
