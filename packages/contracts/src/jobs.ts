import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";

const identifier = z.string().trim().min(1).max(300);
const timestamp = z.iso.datetime();
const count = z.number().int().nonnegative();

export const BackgroundJobSchema = z
  .strictObject({
    id: identifier,
    orgId: identifier,
    workspaceId: identifier.optional(),
    type: z.string().min(1).max(300),
    status: z.enum(["queued", "running", "completed", "failed"]),
    payload: z
      .record(z.string(), z.unknown())
      .describe(
        "Worker-specific job payload. Values are intentionally extensible.",
      ),
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: timestamp.optional(),
  })
  .openapi("BackgroundJob");

export const BackgroundJobStatusCountsSchema = z
  .strictObject({
    total: count,
    queued: count,
    running: count,
    completed: count,
    failed: count,
  })
  .openapi("BackgroundJobStatusCounts");

export const JobLagThresholdsSchema = z
  .strictObject({
    deadLetterCriticalCount: count,
    deadLetterWarningCount: count,
    queuedWarningSeconds: count,
    queuedCriticalSeconds: count,
    runningWarningSeconds: count,
    runningCriticalSeconds: count,
    failedLookbackSeconds: count,
    failedWarningCount: count,
    failedCriticalCount: count,
  })
  .openapi("JobLagThresholds");

export const BackgroundJobTypeSummarySchema =
  BackgroundJobStatusCountsSchema.extend({
    type: z.string(),
    deadLettered: count,
    recentFailed: count,
    oldestQueuedAgeSeconds: count.optional(),
    oldestQueuedJobId: identifier.optional(),
    longestRunningAgeSeconds: count.optional(),
    longestRunningJobId: identifier.optional(),
  }).openapi("BackgroundJobTypeSummary");

export const JobOperationalAlertSchema = z
  .strictObject({
    id: identifier,
    metric: z.enum([
      "dead_letter_jobs",
      "queued_lag_seconds",
      "recent_failed_jobs",
      "running_stale_seconds",
    ]),
    severity: z.enum(["critical", "warning"]),
    type: z.string(),
    value: count,
    threshold: count,
    jobId: identifier.optional(),
  })
  .openapi("JobOperationalAlert");

export const JobOperationalSummarySchema = z
  .strictObject({
    generatedAt: timestamp,
    status: z.enum(["critical", "degraded", "healthy"]),
    thresholds: JobLagThresholdsSchema,
    totals: BackgroundJobStatusCountsSchema.extend({
      deadLettered: count,
      recentFailed: count,
    }),
    byType: z.array(BackgroundJobTypeSummarySchema),
    alerts: z.array(JobOperationalAlertSchema),
  })
  .openapi("JobOperationalSummary");

const metadata = {
  tags: ["Jobs"],
  security: authenticationSecurity,
};

export const listJobsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/jobs",
  operationId: "jobs.list",
  summary: "List background jobs",
  responses: {
    200: jsonResponse(
      "Background jobs",
      dataEnvelope(z.array(BackgroundJobSchema)),
    ),
    ...standardErrorResponses,
  },
});

export const getJobOperationalSummaryRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/jobs/operational-summary",
  operationId: "jobs.getOperationalSummary",
  summary: "Summarize background job lag and alert state",
  responses: {
    200: jsonResponse(
      "Background job operational summary",
      dataEnvelope(JobOperationalSummarySchema),
    ),
    ...standardErrorResponses,
  },
});

export const jobRoutes = [
  listJobsRoute,
  getJobOperationalSummaryRoute,
] as const;
