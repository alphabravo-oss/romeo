import { z } from "@hono/zod-openapi";

const count = z.number().int().nonnegative();
const positiveCount = z.number().int().positive();
export const BrowserAutomationPostureReportSchema = z
  .strictObject({
    schema: z.literal("romeo.browser-automation-posture.v1"),
    generatedAt: z.iso.datetime(),
    orgId: z.string(),
    status: z.enum(["attention_required", "ready"]),
    backend: z.strictObject({
      approvalRequired: z.literal(true),
      artifactUploadTtlSeconds: positiveCount,
      maxArtifactBytes: positiveCount,
      maxAttempts: positiveCount,
      rawTaskReturnedOnlyOnActiveClaim: z.literal(true),
      requiredWorkerScope: z.literal("tools:manage"),
      workerQueue: z.literal("browser_automation"),
      jobType: z.literal("workflow.browser_task.dispatch_request"),
    }),
    deployment: z.strictObject({
      networkPolicyConfigured: z.boolean(),
      runnerOriginConfigured: z.boolean(),
      runnerUrlConfigured: z.boolean(),
      workerEnabled: z.boolean(),
      workerLeaseSeconds: positiveCount,
      workerMaxBytes: positiveCount,
      workerMaxJobs: positiveCount,
      workerTimeoutMs: positiveCount,
    }),
    queue: z.strictObject({
      completed: count,
      deadLettered: count,
      failed: count,
      oldestQueuedAgeSeconds: count.nullable(),
      queued: count,
      running: count,
      staleQueued: count,
      staleRunning: count,
      total: count,
    }),
    artifacts: z.strictObject({
      allowedScreenshotContentTypes: z.array(z.string()),
      allowedTraceContentTypes: z.array(z.string()),
      registeredCount: count,
      taskCountWithRegisteredArtifacts: count,
    }),
    redaction: z.strictObject({
      rawArtifactStorageKeysReturned: z.literal(false),
      rawRunnerUrlReturned: z.literal(false),
      rawTaskTextReturned: z.literal(false),
      secretValuesReturned: z.literal(false),
    }),
    warnings: z.array(
      z.enum([
        "browser_automation_dead_letters_present",
        "browser_automation_network_policy_not_configured",
        "browser_automation_runner_origin_not_https",
        "browser_automation_runner_not_configured",
        "browser_automation_stale_tasks_present",
        "browser_automation_worker_not_enabled",
      ]),
    ),
  })
  .openapi("BrowserAutomationPostureReport");
