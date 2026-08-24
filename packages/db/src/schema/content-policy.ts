import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  foreignKey,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organizations } from "./tenancy";
import { runs } from "./runs";
import { backgroundJobs } from "./system";

export const contentPolicyDecisions = pgTable(
  "content_policy_decisions",
  {
    id: text("id").notNull(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    policyVersionId: text("policy_version_id").notNull(),
    surface: text("surface").notNull(),
    action: text("action").notNull(),
    detectors: jsonb("detectors").notNull().default([]),
    runId: text("run_id"),
    executionJobId: text("execution_job_id"),
    decidedAt: timestamp("decided_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    actionCheck: check(
      "content_policy_decisions_action_check",
      sql`${table.action} IN ('allow', 'audit', 'redact', 'block')`,
    ),
    primaryKey: primaryKey({
      columns: [table.orgId, table.id],
      name: "content_policy_decisions_pkey",
    }),
    runFk: foreignKey({
      columns: [table.orgId, table.runId],
      foreignColumns: [runs.orgId, runs.id],
      name: "content_policy_decisions_org_run_fk",
    }),
    jobFk: foreignKey({
      columns: [table.orgId, table.executionJobId],
      foreignColumns: [backgroundJobs.orgId, backgroundJobs.id],
      name: "content_policy_decisions_org_job_fk",
    }),
    orgDecidedIdx: index("content_policy_decisions_org_decided_idx").on(
      table.orgId,
      table.decidedAt,
      table.id,
    ),
    runIdx: index("content_policy_decisions_org_run_idx").on(
      table.orgId,
      table.runId,
    ),
  }),
);

export const contentPolicyApprovals = pgTable(
  "content_policy_approvals",
  {
    id: text("id").notNull(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    runId: text("run_id").notNull(),
    decisionId: text("decision_id").notNull(),
    policyVersionId: text("policy_version_id").notNull(),
    executionJobId: text("execution_job_id"),
    actorId: text("actor_id").notNull(),
    state: text("state").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by"),
  },
  (table) => ({
    stateCheck: check(
      "content_policy_approvals_state_check",
      sql`${table.state} IN ('pending', 'approved', 'denied', 'expired')`,
    ),
    resolutionCheck: check(
      "content_policy_approvals_resolution_check",
      sql`(${table.state} = 'pending' AND ${table.resolvedAt} IS NULL AND ${table.resolvedBy} IS NULL) OR (${table.state} <> 'pending' AND ${table.resolvedAt} IS NOT NULL)`,
    ),
    pendingJobCheck: check(
      "content_policy_approvals_pending_job_check",
      sql`${table.state} <> 'pending' OR ${table.executionJobId} IS NOT NULL`,
    ),
    primaryKey: primaryKey({
      columns: [table.orgId, table.id],
      name: "content_policy_approvals_pkey",
    }),
    decisionFk: foreignKey({
      columns: [table.orgId, table.decisionId],
      foreignColumns: [contentPolicyDecisions.orgId, contentPolicyDecisions.id],
      name: "content_policy_approvals_org_decision_fk",
    }),
    runFk: foreignKey({
      columns: [table.orgId, table.runId],
      foreignColumns: [runs.orgId, runs.id],
      name: "content_policy_approvals_org_run_fk",
    }),
    jobFk: foreignKey({
      columns: [table.orgId, table.executionJobId],
      foreignColumns: [backgroundJobs.orgId, backgroundJobs.id],
      name: "content_policy_approvals_org_job_fk",
    }),
    decisionUnique: uniqueIndex(
      "content_policy_approvals_org_decision_uidx",
    ).on(table.orgId, table.decisionId),
    pendingExpiryIdx: index("content_policy_approvals_org_state_expiry_idx").on(
      table.orgId,
      table.state,
      table.expiresAt,
      table.id,
    ),
    runIdx: index("content_policy_approvals_org_run_idx").on(
      table.orgId,
      table.runId,
    ),
  }),
);
