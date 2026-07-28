import { z } from "@hono/zod-openapi";

const count = z.number().int().nonnegative();
const positiveCount = z.number().int().positive();
const redaction = z.strictObject({
  artifactBytesReturned: z.boolean(),
  rawEvidencePathsReturned: z.boolean(),
  rawPageContentReturned: z.boolean(),
  rawRunnerUrlReturned: z.boolean(),
  rawTaskTextReturned: z.boolean(),
  secretValuesReturned: z.boolean(),
});

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
      liveEvidencePathConfigured: z.boolean(),
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
    liveEvidence: z.strictObject({
      configured: z.boolean(),
      source: z.enum(["configured_file", "not_configured"]),
      status: z.enum(["failed", "invalid", "not_configured", "satisfied"]),
      schemaVersion: z
        .literal("romeo.browser-automation-live-evidence.v1")
        .optional(),
      evidenceStatus: z
        .enum(["failed", "passed", "planned", "unknown"])
        .optional(),
      mode: z.enum(["dry-run", "live", "unknown"]).optional(),
      deployment: z
        .enum(["compose", "kubernetes", "target", "unknown"])
        .optional(),
      generatedAt: z.iso.datetime().optional(),
      checks: z.strictObject({
        reviewed_runner_sandbox: z.boolean(),
        network_denial_enforced: z.boolean(),
        worker_crash_retry: z.boolean(),
        retention_worker_execution: z.boolean(),
        pod_log_redaction: z.boolean(),
      }),
      failureCodes: z.array(z.string()),
      invalidReason: z
        .enum(["invalid_json", "read_failed", "schema_mismatch"])
        .optional(),
      redaction,
    }),
    redaction: z.strictObject({
      evidenceFileBodiesReturned: z.literal(false),
      rawArtifactStorageKeysReturned: z.literal(false),
      rawEvidencePathsReturned: z.literal(false),
      rawRunnerUrlReturned: z.literal(false),
      rawTaskTextReturned: z.literal(false),
      secretValuesReturned: z.literal(false),
    }),
    warnings: z.array(
      z.enum([
        "browser_automation_dead_letters_present",
        "browser_automation_live_evidence_invalid",
        "browser_automation_live_evidence_required",
        "browser_automation_network_policy_not_configured",
        "browser_automation_runner_origin_not_https",
        "browser_automation_runner_not_configured",
        "browser_automation_stale_tasks_present",
        "browser_automation_worker_not_enabled",
      ]),
    ),
  })
  .openapi("BrowserAutomationPostureReport");
