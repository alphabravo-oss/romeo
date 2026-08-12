import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";

const identifier = z.string().trim().min(1).max(300);
const timestamp = z.iso.datetime();
const nonnegative = z.number().nonnegative();
const quotaMetric = z.enum([
  "image.cost.micro_usd",
  "image.generated",
  "web.search.request",
  "web.url.fetch",
  "run.started",
  "tool.call",
  "storage.byte",
]);
const quotaScopeType = z.enum([
  "org",
  "user",
  "workspace",
  "provider",
  "agent",
  "api_key",
]);
const quotaResetInterval = z.enum(["none", "daily", "monthly"]);

export const AuditLogSchema = z
  .strictObject({
    id: identifier,
    orgId: identifier,
    actorId: identifier,
    action: z.string(),
    resourceType: z.string(),
    resourceId: identifier,
    outcome: z.enum(["success", "failure"]),
    metadata: z.record(z.string(), z.unknown()),
    createdAt: timestamp,
  })
  .openapi("AuditLog");

export const AuditLogFilterSchema = z
  .strictObject({
    action: z.string().min(1).max(300).optional(),
    actorId: identifier.optional(),
    category: z
      .enum([
        "security",
        "admin",
        "access",
        "data",
        "chat",
        "run",
        "system",
      ])
      .optional(),
    from: timestamp.optional(),
    includeNoise: z.enum(["true", "false"]).optional(),
    outcome: z.enum(["success", "failure"]).optional(),
    q: z.string().min(1).max(300).optional(),
    resourceId: identifier.optional(),
    resourceType: z.string().min(1).max(300).optional(),
    to: timestamp.optional(),
    limit: z.coerce.number().int().min(1).max(1_000).optional(),
    cursor: z.string().min(1).max(2_000).optional(),
  })
  .openapi("AuditLogQuery");

export const AuditLogPageSchema = z
  .strictObject({
    data: z.array(AuditLogSchema),
    nextCursor: z.string().optional(),
  })
  .openapi("AuditLogPage");

export const UsageEventSchema = z
  .strictObject({
    id: identifier,
    orgId: identifier,
    workspaceId: identifier.optional(),
    actorId: identifier,
    sourceType: z.enum([
      "chat",
      "retrieval",
      "run",
      "tool",
      "storage",
      "voice",
    ]),
    sourceId: identifier,
    metric: z.string(),
    quantity: z.number(),
    unit: z.string(),
    metadata: z.record(z.string(), z.unknown()),
    createdAt: timestamp,
  })
  .openapi("UsageEvent");

export const UsageSummaryMetricSchema = z
  .strictObject({
    metric: z.string(),
    quantity: z.number(),
    unit: z.string(),
    estimatedCostUsd: z.number(),
  })
  .openapi("UsageSummaryMetric");

export const UsageSummarySchema = z
  .strictObject({
    totals: z.array(UsageSummaryMetricSchema),
    byActor: z.array(UsageSummaryMetricSchema.extend({ actorId: identifier })),
    byProvider: z.array(
      UsageSummaryMetricSchema.extend({ providerId: identifier }),
    ),
  })
  .openapi("UsageSummary");

export const UsageAlertSchema = z
  .strictObject({
    id: identifier,
    scopeType: quotaScopeType,
    scopeId: identifier,
    metric: z.string(),
    used: nonnegative,
    limit: nonnegative,
    percentUsed: nonnegative,
    severity: z.enum(["warning", "critical", "exceeded"]),
    resetAt: timestamp.optional(),
  })
  .openapi("UsageAlert");

export const QuotaBucketSchema = z
  .strictObject({
    id: identifier,
    orgId: identifier,
    scopeType: quotaScopeType,
    scopeId: identifier,
    metric: quotaMetric,
    limit: z.number().int().nonnegative(),
    used: nonnegative,
    resetInterval: quotaResetInterval,
    resetAt: timestamp.optional(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .openapi("QuotaBucket");

export const QuotaCoordinationStatusSchema = z
  .strictObject({
    driver: z.enum(["disabled", "valkey"]),
    enabled: z.boolean(),
    configured: z.boolean(),
    healthy: z.boolean().nullable(),
    keyPrefix: z.string(),
    checkedAt: timestamp,
    details: z.strictObject({
      failClosed: z.boolean(),
      statusCode: z.enum([
        "disabled",
        "healthy",
        "unconfigured",
        "unreachable",
      ]),
    }),
  })
  .openapi("QuotaCoordinationStatus");

export const CreateQuotaBucketSchema = z
  .strictObject({
    scopeType: quotaScopeType,
    scopeId: identifier.optional(),
    metric: quotaMetric,
    limit: z.number().int().nonnegative(),
    resetInterval: quotaResetInterval.default("none"),
  })
  .openapi("CreateQuotaBucketRequest");

export const UpdateQuotaBucketSchema = z
  .strictObject({
    limit: z.number().int().nonnegative().optional(),
    resetInterval: quotaResetInterval.optional(),
    resetUsage: z.boolean().optional(),
  })
  .refine(
    (input) =>
      input.limit !== undefined ||
      input.resetInterval !== undefined ||
      input.resetUsage === true,
    { message: "At least one quota update field is required." },
  )
  .openapi("UpdateQuotaBucketRequest");

const metadata = {
  tags: ["Operational governance"],
  security: authenticationSecurity,
};
const errors = standardErrorResponses;
const csvResponse = (description: string) =>
  ({
    description,
    content: { "text/csv": { schema: z.string() } },
  }) as const;
const body = <T extends z.ZodType>(schema: T) => ({
  required: true as const,
  content: { "application/json": { schema } },
});

export const listAuditLogsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/audit-logs",
  operationId: "operationalGovernance.listAuditLogs",
  summary: "List audit logs",
  request: { query: AuditLogFilterSchema },
  responses: {
    200: jsonResponse("Audit log page", AuditLogPageSchema),
    ...errors,
  },
});
export const exportAuditLogsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/audit-logs.csv",
  operationId: "operationalGovernance.exportAuditLogs",
  summary: "Export audit logs as CSV",
  request: { query: AuditLogFilterSchema.omit({ limit: true, cursor: true }) },
  responses: { 200: csvResponse("Audit log CSV"), ...errors },
});
export const listUsageEventsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/usage/events",
  operationId: "operationalGovernance.listUsageEvents",
  summary: "List usage events",
  responses: {
    200: jsonResponse("Usage events", dataEnvelope(z.array(UsageEventSchema))),
    ...errors,
  },
});
export const exportUsageEventsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/usage/events.csv",
  operationId: "operationalGovernance.exportUsageEvents",
  summary: "Export usage events as CSV",
  responses: { 200: csvResponse("Usage events CSV"), ...errors },
});
export const getUsageSummaryRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/usage/summary",
  operationId: "operationalGovernance.getUsageSummary",
  summary: "Summarize usage",
  responses: {
    200: jsonResponse("Usage summary", dataEnvelope(UsageSummarySchema)),
    ...errors,
  },
});
export const listUsageAlertsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/usage/alerts",
  operationId: "operationalGovernance.listUsageAlerts",
  summary: "List usage alerts",
  responses: {
    200: jsonResponse("Usage alerts", dataEnvelope(z.array(UsageAlertSchema))),
    ...errors,
  },
});
export const listQuotaBucketsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/quotas",
  operationId: "operationalGovernance.listQuotaBuckets",
  summary: "List quota buckets",
  responses: {
    200: jsonResponse(
      "Quota buckets",
      dataEnvelope(z.array(QuotaBucketSchema)),
    ),
    ...errors,
  },
});
export const getQuotaCoordinationStatusRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/quotas/distributed-status",
  operationId: "operationalGovernance.getQuotaCoordinationStatus",
  summary: "Get quota coordination status",
  responses: {
    200: jsonResponse(
      "Quota coordination status",
      dataEnvelope(QuotaCoordinationStatusSchema),
    ),
    ...errors,
  },
});
export const createQuotaBucketRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/quotas",
  operationId: "operationalGovernance.createQuotaBucket",
  summary: "Create a quota bucket",
  request: { body: body(CreateQuotaBucketSchema) },
  responses: {
    201: jsonResponse("Created quota bucket", dataEnvelope(QuotaBucketSchema)),
    ...errors,
  },
});
export const updateQuotaBucketRoute = createRoute({
  ...metadata,
  method: "patch",
  path: "/api/v1/quotas/{quotaBucketId}",
  operationId: "operationalGovernance.updateQuotaBucket",
  summary: "Update a quota bucket",
  request: {
    params: z.strictObject({ quotaBucketId: identifier }),
    body: body(UpdateQuotaBucketSchema),
  },
  responses: {
    200: jsonResponse("Updated quota bucket", dataEnvelope(QuotaBucketSchema)),
    ...errors,
  },
});
export const deleteQuotaBucketRoute = createRoute({
  ...metadata,
  method: "delete",
  path: "/api/v1/quotas/{quotaBucketId}",
  operationId: "operationalGovernance.deleteQuotaBucket",
  summary: "Delete a quota bucket",
  request: { params: z.strictObject({ quotaBucketId: identifier }) },
  responses: {
    200: jsonResponse("Deleted quota bucket", dataEnvelope(QuotaBucketSchema)),
    ...errors,
  },
});

export const operationalGovernanceRoutes = [
  listAuditLogsRoute,
  exportAuditLogsRoute,
  listUsageEventsRoute,
  exportUsageEventsRoute,
  getUsageSummaryRoute,
  listUsageAlertsRoute,
  listQuotaBucketsRoute,
  getQuotaCoordinationStatusRoute,
  createQuotaBucketRoute,
  updateQuotaBucketRoute,
  deleteQuotaBucketRoute,
] as const;
