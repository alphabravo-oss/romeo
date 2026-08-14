import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";
import { UsageSummaryMetricSchema } from "./operational-governance";

const identifier = z.string().trim().min(1).max(300);
const timestamp = z.iso.datetime();
const nonnegative = z.number().int().nonnegative();
const health = z.enum(["critical", "degraded", "healthy"]);
const evalStatus = z.enum(["failed", "missing", "not_required", "passed"]);

const evalSuite = z.strictObject({
  suiteId: identifier,
  agentId: identifier,
  workspaceId: identifier,
  latestRunId: identifier.optional(),
  latestStatus: z.enum(["failed", "missing", "passed"]),
  latestScore: z.number().optional(),
  latestCompletedAt: timestamp.optional(),
  runCount: nonnegative,
});
const evalAgent = z.strictObject({
  agentId: identifier,
  workspaceId: identifier,
  latestCompletedAt: timestamp.optional(),
  latestRunId: identifier.optional(),
  latestScore: z.number().optional(),
  latestStatus: evalStatus,
  runCount: nonnegative,
  suiteCount: nonnegative,
});
const evalModel = z.strictObject({
  averageScore: z.number(),
  failedRunCount: nonnegative,
  latestCompletedAt: timestamp.optional(),
  latestRunId: identifier.optional(),
  modelId: identifier,
  passedRunCount: nonnegative,
  runCount: nonnegative,
});

export const AdminAnalyticsSummarySchema = z
  .strictObject({
    adoption: z.strictObject({
      activeUserCount: nonnegative,
      activeWorkspaceCount: nonnegative,
      engagedUserCount: nonnegative,
      completedRunsPerActiveUser: z.number().nonnegative(),
      runCompletionRate: z.number().min(0).max(1).nullable(),
      toolSuccessRate: z.number().min(0).max(1).nullable(),
      feedback: z.strictObject({
        negativeCount: nonnegative,
        positiveCount: nonnegative,
        positiveRate: z.number().min(0).max(1).nullable(),
        totalCount: nonnegative,
      }),
    }),
    evals: z.strictObject({
      agentCount: nonnegative,
      agents: z.array(evalAgent),
      averageLatestScore: z.number().nullable(),
      byModel: z.array(evalModel),
      failedSuiteCount: nonnegative,
      generatedRunCount: nonnegative,
      missingSuiteCount: nonnegative,
      passedSuiteCount: nonnegative,
      releaseGate: z.strictObject({
        failedSuiteCount: nonnegative,
        missingSuiteCount: nonnegative,
        requiredSuiteCount: nonnegative,
        status: evalStatus,
      }),
      status: evalStatus,
      suiteCount: nonnegative,
      suites: z.array(evalSuite),
    }),
    generatedAt: timestamp,
    jobs: z.strictObject({
      alertCount: nonnegative,
      completed: nonnegative,
      criticalAlertCount: nonnegative,
      deadLettered: nonnegative,
      failed: nonnegative,
      queued: nonnegative,
      running: nonnegative,
      status: health,
      total: nonnegative,
    }),
    orgId: identifier,
    providers: z.strictObject({
      alertCount: nonnegative,
      availableProviderCount: nonnegative,
      criticalAlertCount: nonnegative,
      degradedProviderCount: nonnegative,
      providerCount: nonnegative,
      status: health,
      unavailableProviderCount: nonnegative,
    }),
    redaction: z.strictObject({
      rawEvalInputsReturned: z.literal(false),
      rawEvalOutputsReturned: z.literal(false),
      rawJobPayloadsReturned: z.literal(false),
      rawProviderConfigReturned: z.literal(false),
      rawToolInputsReturned: z.literal(false),
      rawUsageMetadataReturned: z.literal(false),
    }),
    status: health,
    tools: z.strictObject({
      approvalRequiredCount: nonnegative,
      blockedCount: nonnegative,
      byTool: z.array(
        z.strictObject({
          approvalRequiredCount: nonnegative,
          blockedCount: nonnegative,
          failureCount: nonnegative,
          pendingApprovalCount: nonnegative,
          successCount: nonnegative,
          toolId: identifier,
          totalCount: nonnegative,
        }),
      ),
      failureCount: nonnegative,
      pendingApprovalCount: nonnegative,
      successCount: nonnegative,
      totalCount: nonnegative,
    }),
    usage: z.strictObject({
      activityEventCount: nonnegative,
      byProvider: z.array(
        UsageSummaryMetricSchema.extend({ providerId: identifier }),
      ),
      eventCount: nonnegative,
      estimatedCostUsd: z.number(),
      runsCompleted: nonnegative,
      runsFailed: nonnegative,
      runsStarted: nonnegative,
      totalTokens: z.number().nonnegative(),
      totals: z.array(UsageSummaryMetricSchema),
      unpricedTokenQuantity: z.number().nonnegative(),
    }),
    attention: z.strictObject({
      models: z.array(
        z.strictObject({
          displayName: identifier,
          issues: z.array(
            z.enum([
              "invalid_context_window",
              "missing_max_output",
              "missing_pricing",
              "unavailable",
            ]),
          ),
          modelId: identifier,
          providerId: identifier,
        }),
      ),
    }),
    window: z.strictObject({
      from: timestamp.nullable(),
      to: timestamp,
    }),
  })
  .openapi("AdminAnalyticsSummary");

const analyticsWindowQuery = z.strictObject({
  from: timestamp.optional(),
  to: timestamp.optional(),
});

const billingStatus = z.enum(["active", "canceled", "past_due", "trialing"]);
const blockReason = z.enum([
  "billing_plan_missing",
  "billing_status_blocked",
  "connector_kill_switch",
  "org_suspended",
  "provider_kill_switch",
  "tool_kill_switch",
  "worker_class_kill_switch",
]);
const idList = z.array(identifier).max(250);

export const AbuseControlPolicyReportSchema = z
  .strictObject({
    orgId: identifier,
    source: z.enum(["default", "org"]),
    generatedAt: timestamp,
    suspension: z.strictObject({
      suspended: z.boolean(),
      reasonCode: z.string().optional(),
      suspendedAt: timestamp.optional(),
      suspendedBy: identifier.optional(),
    }),
    entitlements: z.strictObject({
      enforceBillingStatus: z.boolean(),
      denyWhenBillingPlanMissing: z.boolean(),
      allowedBillingStatuses: z.array(billingStatus),
    }),
    killSwitches: z.strictObject({
      connectorIds: z.array(identifier),
      providerIds: z.array(identifier),
      toolIds: z.array(identifier),
      workerClasses: z.array(identifier),
    }),
    enforcement: z.strictObject({
      billingPlanConfigured: z.boolean(),
      billingPlanCode: z.string().optional(),
      billingStatus: billingStatus.optional(),
      costWorkBlocked: z.boolean(),
      defaultBlockReasons: z.array(blockReason),
      activeKillSwitchCount: nonnegative,
    }),
    updatedAt: timestamp.optional(),
    updatedBy: identifier.optional(),
  })
  .openapi("AbuseControlPolicyReport");

export const UpdateAbuseControlPolicySchema = z
  .strictObject({
    suspension: z
      .strictObject({
        suspended: z.boolean().optional(),
        reasonCode: identifier.nullable().optional(),
      })
      .optional(),
    entitlements: z
      .strictObject({
        enforceBillingStatus: z.boolean().optional(),
        denyWhenBillingPlanMissing: z.boolean().optional(),
        allowedBillingStatuses: z.array(billingStatus).min(1).max(4).optional(),
      })
      .optional(),
    killSwitches: z
      .strictObject({
        connectorIds: idList.optional(),
        providerIds: idList.optional(),
        toolIds: idList.optional(),
        workerClasses: idList.optional(),
      })
      .optional(),
  })
  .refine(
    (input) =>
      input.suspension !== undefined ||
      input.entitlements !== undefined ||
      input.killSwitches !== undefined,
    { message: "At least one abuse control update field is required." },
  )
  .openapi("UpdateAbuseControlPolicyRequest");

const abuseControlAction = z.enum([
  "connector.sync",
  "eval.run",
  "file.upload",
  "knowledge.ingest",
  "model.request",
  "run.start",
  "tool.dispatch",
  "tool.execute",
  "voice.request",
  "workflow.run",
  "worker.enqueue",
]);

export const SimulateAbuseControlPolicySchema = z
  .strictObject({
    action: abuseControlAction,
    agentId: identifier.optional(),
    connectorId: identifier.optional(),
    providerId: identifier.optional(),
    toolId: identifier.optional(),
    workerClass: identifier.optional(),
    workspaceId: identifier.optional(),
  })
  .openapi("SimulateAbuseControlPolicyRequest");

export const AbuseControlSimulationResultSchema = z
  .strictObject({
    allowed: z.boolean(),
    action: abuseControlAction,
    reasonCodes: z.array(blockReason),
    evaluatedAt: timestamp,
    policySource: z.enum(["default", "org"]),
  })
  .openapi("AbuseControlSimulationResult");

const metadata = { tags: ["Admin insights"], security: authenticationSecurity };
const errors = standardErrorResponses;
const csvResponse = {
  description: "Redacted analytics CSV",
  content: { "text/csv": { schema: z.string() } },
} as const;

export const getAdminAnalyticsSummaryRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/admin/analytics/summary",
  operationId: "adminInsights.getAnalyticsSummary",
  summary: "Get admin analytics summary",
  request: { query: analyticsWindowQuery },
  responses: {
    200: jsonResponse(
      "Admin analytics summary",
      dataEnvelope(AdminAnalyticsSummarySchema),
    ),
    ...errors,
  },
});
export const exportAdminAnalyticsSummaryRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/admin/analytics/summary.csv",
  operationId: "adminInsights.exportAnalyticsSummary",
  summary: "Export admin analytics summary",
  request: { query: analyticsWindowQuery },
  responses: { 200: csvResponse, ...errors },
});
export const getAbuseControlsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/admin/abuse-controls",
  operationId: "adminInsights.getAbuseControls",
  summary: "Get abuse controls",
  responses: {
    200: jsonResponse(
      "Abuse controls",
      dataEnvelope(AbuseControlPolicyReportSchema),
    ),
    ...errors,
  },
});
export const updateAbuseControlsRoute = createRoute({
  ...metadata,
  method: "patch",
  path: "/api/v1/admin/abuse-controls",
  operationId: "adminInsights.updateAbuseControls",
  summary: "Update abuse controls",
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: UpdateAbuseControlPolicySchema },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "Abuse controls",
      dataEnvelope(AbuseControlPolicyReportSchema),
    ),
    ...errors,
  },
});
export const simulateAbuseControlsRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/admin/abuse-controls/simulate",
  operationId: "adminInsights.simulateAbuseControls",
  summary: "Simulate abuse-control enforcement without side effects",
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: SimulateAbuseControlPolicySchema },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "Abuse-control simulation",
      dataEnvelope(AbuseControlSimulationResultSchema),
    ),
    ...errors,
  },
});

export const adminInsightsRoutes = [
  getAdminAnalyticsSummaryRoute,
  exportAdminAnalyticsSummaryRoute,
  getAbuseControlsRoute,
  updateAbuseControlsRoute,
  simulateAbuseControlsRoute,
] as const;
