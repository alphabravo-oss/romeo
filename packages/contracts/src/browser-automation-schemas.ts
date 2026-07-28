import { z } from "@hono/zod-openapi";

const id = z.string().trim().min(1).max(200);
const timestamp = z.iso.datetime();
const count = z.number().int().nonnegative();
const positiveCount = z.number().int().positive();
const jobStatus = z.enum(["queued", "running", "completed", "failed"]);
const artifactType = z.enum(["download", "screenshot", "trace"]);

export const BrowserAutomationArtifactSchema = z
  .strictObject({
    artifactId: id,
    artifactUrl: z.string().optional(),
    type: artifactType,
    contentType: z.string().optional(),
    sizeBytes: count.optional(),
  })
  .openapi("BrowserAutomationArtifactSummary");

export const BrowserAutomationCompletionResultSchema = z
  .strictObject({
    artifactCount: count.max(100).optional(),
    artifacts: z.array(BrowserAutomationArtifactSchema).max(20).optional(),
    capturedBytes: count.max(1_000_000_000).optional(),
    durationMs: count.max(86_400_000).optional(),
    finalHost: z.string().optional(),
    finalOrigin: z.string().optional(),
    finalPath: z.string().optional(),
    navigationCount: count.max(10_000).optional(),
    networkDeniedCount: count.max(10_000).optional(),
    outputKeys: z.array(z.string()).max(50).optional(),
    redactionApplied: z.boolean().optional(),
  })
  .openapi("BrowserAutomationCompletionResult");

const jobSummary = z.strictObject({ id, status: jobStatus, type: z.string() });
const workflowSummary = z.strictObject({
  stepId: id,
  workflowId: id,
  workflowRunId: id,
  workspaceId: id,
});
const sandboxPolicy = z.strictObject({
  artifactCapture: z.enum(["metadata_only", "screenshots_and_traces"]),
  downloadPolicy: z.enum(["blocked", "metadata_only"]),
  executionDriver: z.enum(["disabled", "external_worker"]),
  network: z.literal("target_origin_only"),
  uploadPolicy: z.literal("blocked"),
});

export const BrowserAutomationTaskClaimResultSchema = z
  .strictObject({
    claimed: z.boolean(),
    workerQueue: z.literal("browser_automation"),
    job: jobSummary.optional(),
    lease: z
      .strictObject({
        attempt: positiveCount,
        claimedAt: timestamp,
        expiresAt: timestamp,
        leaseSeconds: positiveCount,
        renewedAt: timestamp,
        workerId: id,
      })
      .optional(),
    request: z
      .strictObject({
        targetHost: z.string(),
        targetOrigin: z.string().url(),
        targetUrl: z.string().url(),
        task: z.string(),
        taskHash: z.string(),
        taskLength: count,
      })
      .optional(),
    sandboxPolicy: sandboxPolicy.optional(),
    workflow: workflowSummary.optional(),
  })
  .openapi("BrowserAutomationTaskClaimResult");

export const BrowserAutomationTaskReadbackResultSchema = z
  .strictObject({
    job: jobSummary,
    outcome: z.enum(["cancelled", "completed", "failed"]),
    workerQueue: z.literal("browser_automation"),
    workflow: workflowSummary,
    errorCode: z.string().optional(),
    result: BrowserAutomationCompletionResultSchema.optional(),
  })
  .openapi("BrowserAutomationTaskReadbackResult");

export const BrowserAutomationTaskExpiryResultSchema = z
  .strictObject({
    expired: count,
    jobs: z.array(
      BrowserAutomationTaskReadbackResultSchema.extend({
        reasonCode: z.enum(["queued_timeout", "running_lease_timeout"]),
      }),
    ),
    workerQueue: z.literal("browser_automation"),
  })
  .openapi("BrowserAutomationTaskExpiryResult");

export const PresignedBrowserArtifactUploadSchema = z
  .strictObject({
    key: z.string(),
    url: z.string(),
    method: z.literal("PUT"),
    expiresAt: timestamp,
    headers: z.record(z.string(), z.string()),
  })
  .openapi("PresignedUpload");

export const BrowserAutomationArtifactUploadRegistrationSchema = z
  .strictObject({
    artifact: BrowserAutomationArtifactSchema,
    upload: PresignedBrowserArtifactUploadSchema,
  })
  .openapi("BrowserAutomationArtifactUploadRegistration");

export const ClaimBrowserAutomationTaskRequestSchema = z
  .strictObject({
    leaseSeconds: z.number().int().min(30).max(3_600).default(300),
  })
  .openapi("ClaimBrowserAutomationTaskRequest");

const completionArtifactInput = z.strictObject({
  artifactId: id.regex(/^[A-Za-z0-9_.:-]+$/u),
  type: artifactType,
  contentType: z.string().min(1).max(120).optional(),
  sizeBytes: count.max(1_000_000_000).optional(),
});

export const CompleteBrowserAutomationTaskRequestSchema = z
  .strictObject({
    result: z.strictObject({
      artifactCount: count.max(100).optional(),
      artifacts: z.array(completionArtifactInput).max(20).optional(),
      capturedBytes: count.max(1_000_000_000).optional(),
      durationMs: count.max(86_400_000).optional(),
      finalOrigin: z.string().url().max(2_000).optional(),
      navigationCount: count.max(10_000).optional(),
      networkDeniedCount: count.max(10_000).optional(),
      outputKeys: z
        .array(
          z
            .string()
            .min(1)
            .max(120)
            .regex(/^[A-Za-z0-9_.:-]+$/u),
        )
        .max(50)
        .optional(),
      redactionApplied: z.boolean().optional(),
    }),
  })
  .openapi("CompleteBrowserAutomationTaskRequest");

export const CreateBrowserAutomationArtifactUploadRequestSchema = z
  .strictObject({
    type: z.enum(["screenshot", "trace"]),
    contentType: z.string().min(1).max(120),
    sizeBytes: positiveCount.max(50 * 1_024 * 1_024),
  })
  .openapi("CreateBrowserAutomationArtifactUploadRequest");

export const FailBrowserAutomationTaskRequestSchema = z
  .strictObject({
    errorCode: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z0-9_.-]+$/u),
  })
  .openapi("FailBrowserAutomationTaskRequest");

export const ExpireBrowserAutomationTasksRequestSchema = z
  .strictObject({
    queuedTimeoutSeconds: z
      .number()
      .int()
      .min(60)
      .max(2_592_000)
      .default(86_400),
    runningTimeoutSeconds: z
      .number()
      .int()
      .min(60)
      .max(2_592_000)
      .default(3_600),
    limit: z.number().int().min(1).max(500).default(100),
  })
  .openapi("ExpireBrowserAutomationTasksRequest");

export const browserAutomationJobParams = z.strictObject({ jobId: id });
export const browserAutomationArtifactParams = z.strictObject({
  artifactId: id,
});
