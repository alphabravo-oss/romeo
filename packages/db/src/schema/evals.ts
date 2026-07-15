import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { agentModels } from "./agents";
import { baseModels } from "./providers";
import { organizations, workspaces } from "./tenancy";
import { users } from "./users";

export const evalSuites = pgTable(
  "eval_suites",
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
    name: text("name").notNull(),
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
    evalSuitesAgentCreatedIdx: index("eval_suites_agent_created_idx").on(
      table.agentId,
      table.createdAt,
    ),
  }),
);

export const evalCases = pgTable(
  "eval_cases",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    suiteId: text("suite_id")
      .notNull()
      .references(() => evalSuites.id),
    input: text("input").notNull(),
    expectedContains: text("expected_contains"),
    rubric: jsonb("rubric").$type<Record<string, unknown>>(),
    requiresCitation: boolean("requires_citation").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    evalCasesSuiteIdx: index("eval_cases_suite_idx").on(
      table.suiteId,
      table.createdAt,
    ),
  }),
);

export const evalRuns = pgTable(
  "eval_runs",
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
    suiteId: text("suite_id")
      .notNull()
      .references(() => evalSuites.id),
    modelId: text("model_id")
      .notNull()
      .references(() => baseModels.id),
    status: text("status").notNull(),
    score: real("score").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    evalRunsAgentCreatedIdx: index("eval_runs_agent_created_idx").on(
      table.agentId,
      table.createdAt,
    ),
    evalRunsSuiteCompletedIdx: index("eval_runs_suite_completed_idx").on(
      table.suiteId,
      table.completedAt,
    ),
  }),
);

export const evalRunResults = pgTable(
  "eval_run_results",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    runId: text("run_id")
      .notNull()
      .references(() => evalRuns.id),
    caseId: text("case_id")
      .notNull()
      .references(() => evalCases.id),
    status: text("status").notNull(),
    score: real("score").notNull(),
    output: text("output").notNull(),
    checks: jsonb("checks").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    evalRunResultsRunIdx: index("eval_run_results_run_idx").on(
      table.runId,
      table.createdAt,
    ),
  }),
);

export const evalResultHumanRatings = pgTable(
  "eval_result_human_ratings",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    runId: text("run_id")
      .notNull()
      .references(() => evalRuns.id),
    resultId: text("result_id")
      .notNull()
      .references(() => evalRunResults.id),
    reviewerId: text("reviewer_id")
      .notNull()
      .references(() => users.id),
    rating: text("rating").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    evalResultHumanRatingReviewerIdx: uniqueIndex(
      "eval_result_human_rating_reviewer_idx",
    ).on(table.resultId, table.reviewerId),
    evalResultHumanRatingsRunUpdatedIdx: index(
      "eval_result_human_ratings_run_updated_idx",
    ).on(table.runId, table.updatedAt),
  }),
);
