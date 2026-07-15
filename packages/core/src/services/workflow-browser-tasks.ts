import { createHash } from "node:crypto";

import type { AuthSubject } from "@romeo/auth";
import type { PresignedUpload } from "@romeo/storage";

import type {
  BackgroundJob,
  WorkflowRun,
  WorkflowStep,
} from "../domain/entities";
import { ApiError } from "../errors";

export const browserAutomationJobType = "workflow.browser_task.dispatch_request";
export const browserAutomationMaxAttempts = 3;
export const browserAutomationWorkerQueue = "browser_automation";
export const browserAutomationPayloadSchemaVersion =
  "romeo.browser-automation-task.v1";

export interface NormalizedBrowserTask {
  targetUrl: string;
  targetOrigin: string;
  targetHost: string;
  task: string;
}

export interface BrowserAutomationWorkerLease {
  attempt: number;
  claimedAt: string;
  expiresAt: string;
  leaseSeconds: number;
  renewedAt: string;
  workerId: string;
}

export interface BrowserTaskSandboxPolicy {
  artifactCapture: "metadata_only" | "screenshots_and_traces";
  downloadPolicy: "blocked" | "metadata_only";
  executionDriver: "disabled" | "external_worker";
  network: "target_origin_only";
  uploadPolicy: "blocked";
}

export interface BrowserAutomationJobPayload {
  approvedAt: string;
  approvedBy: string;
  sandboxPolicy: BrowserTaskSandboxPolicy;
  schemaVersion: typeof browserAutomationPayloadSchemaVersion;
  stepId: string;
  targetHost: string;
  targetOrigin: string;
  targetUrl: string;
  taskHash: string;
  taskLength: number;
  workflowId: string;
  workflowRunId: string;
  workerQueue: typeof browserAutomationWorkerQueue;
  workspaceId: string;
}

export interface BrowserAutomationArtifactSummary {
  artifactId: string;
  type: "download" | "screenshot" | "trace";
  artifactUrl?: string;
  contentType?: string;
  sizeBytes?: number;
}

export interface BrowserAutomationStoredArtifact
  extends BrowserAutomationArtifactSummary {
  artifactUrl: string;
  registeredAt: string;
  registeredBy: string;
  storageKey: string;
}

export interface BrowserAutomationArtifactUploadRegistration {
  artifact: BrowserAutomationArtifactSummary;
  upload: PresignedUpload;
}

export interface BrowserAutomationArtifactReadResult {
  artifact: BrowserAutomationArtifactSummary;
  bytes: Uint8Array;
}

export interface BrowserAutomationCompletionResult {
  artifactCount?: number;
  artifacts?: BrowserAutomationArtifactSummary[];
  capturedBytes?: number;
  durationMs?: number;
  finalHost?: string;
  finalOrigin?: string;
  finalPath?: string;
  navigationCount?: number;
  networkDeniedCount?: number;
  outputKeys?: string[];
  redactionApplied?: boolean;
}

export interface BrowserAutomationTaskClaimResult {
  claimed: boolean;
  workerQueue: typeof browserAutomationWorkerQueue;
  job?: { id: string; status: BackgroundJob["status"]; type: string };
  lease?: BrowserAutomationWorkerLease;
  request?: {
    targetHost: string;
    targetOrigin: string;
    targetUrl: string;
    task: string;
    taskHash: string;
    taskLength: number;
  };
  sandboxPolicy?: BrowserTaskSandboxPolicy;
  workflow?: {
    stepId: string;
    workflowId: string;
    workflowRunId: string;
    workspaceId: string;
  };
}

export interface BrowserAutomationTaskReadbackResult {
  job: { id: string; status: BackgroundJob["status"]; type: string };
  outcome: "cancelled" | "completed" | "failed";
  workerQueue: typeof browserAutomationWorkerQueue;
  workflow: {
    stepId: string;
    workflowId: string;
    workflowRunId: string;
    workspaceId: string;
  };
  errorCode?: string;
  result?: BrowserAutomationCompletionResult;
}

export interface BrowserAutomationTaskExpiryResult {
  expired: number;
  jobs: Array<
    BrowserAutomationTaskReadbackResult & {
      reasonCode: "queued_timeout" | "running_lease_timeout";
    }
  >;
  workerQueue: typeof browserAutomationWorkerQueue;
}

export function normalizeBrowserTaskStep(
  step: Omit<WorkflowStep, "id">,
): NormalizedBrowserTask {
  if (step.targetUrl === undefined)
    throw new ApiError(
      "invalid_workflow_step",
      "Browser task steps require a targetUrl.",
      400,
    );
  if (step.task === undefined || step.task.trim().length === 0)
    throw new ApiError(
      "invalid_workflow_step",
      "Browser task steps require a task.",
      400,
    );
  let url: URL;
  try {
    url = new URL(step.targetUrl);
  } catch {
    throw new ApiError(
      "invalid_workflow_step",
      "Browser task targetUrl must be a valid URL.",
      400,
    );
  }
  if (url.protocol !== "https:")
    throw new ApiError(
      "invalid_workflow_step",
      "Browser task targetUrl must use HTTPS.",
      400,
    );
  if (
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hash.length > 0 ||
    url.search.length > 0
  ) {
    throw new ApiError(
      "invalid_workflow_step",
      "Browser task targetUrl must not include credentials, fragments, or query strings.",
      400,
    );
  }
  if (isLocalOrPrivateHost(url.hostname))
    throw new ApiError(
      "invalid_workflow_step",
      "Browser task targetUrl must not target local or private hosts.",
      400,
    );
  return {
    targetUrl: `${url.origin}${url.pathname}`,
    targetOrigin: url.origin,
    targetHost: url.hostname,
    task: step.task.trim(),
  };
}

export function browserTaskApprovalOutput(
  step: WorkflowStep,
): Record<string, unknown> {
  const normalized = normalizeBrowserTaskStep(step);
  return {
    approvalKind: "browser_task",
    approvalPrompt: step.approvalPrompt ?? step.name,
    targetOrigin: normalized.targetOrigin,
    targetHost: normalized.targetHost,
    sandboxPolicy: disabledBrowserTaskSandboxPolicy(),
    taskKeys: ["task"],
  };
}

export function browserTaskApprovedOutput(input: {
  approvedAt: string;
  approvedBy: string;
  job: BackgroundJob;
  step: WorkflowStep;
}): Record<string, unknown> {
  const normalized = normalizeBrowserTaskStep(input.step);
  return {
    approvalKind: "browser_task",
    approvalPrompt: input.step.approvalPrompt ?? input.step.name,
    approvedAt: input.approvedAt,
    approvedBy: input.approvedBy,
    jobId: input.job.id,
    sandboxPolicy: externalBrowserTaskSandboxPolicy(),
    targetHost: normalized.targetHost,
    targetOrigin: normalized.targetOrigin,
    taskHash: hashBrowserTask(normalized.task),
    taskKeys: ["task"],
    workerQueue: browserAutomationWorkerQueue,
  };
}

export function createBrowserAutomationJobPayload(input: {
  approvedAt: string;
  subject: AuthSubject;
  step: WorkflowStep;
  workflowId: string;
  workflowRun: WorkflowRun;
}): BrowserAutomationJobPayload {
  const normalized = normalizeBrowserTaskStep(input.step);
  return {
    approvedAt: input.approvedAt,
    approvedBy: input.subject.id,
    sandboxPolicy: externalBrowserTaskSandboxPolicy(),
    schemaVersion: browserAutomationPayloadSchemaVersion,
    stepId: input.step.id,
    targetHost: normalized.targetHost,
    targetOrigin: normalized.targetOrigin,
    targetUrl: normalized.targetUrl,
    taskHash: hashBrowserTask(normalized.task),
    taskLength: normalized.task.length,
    workflowId: input.workflowId,
    workflowRunId: input.workflowRun.id,
    workerQueue: browserAutomationWorkerQueue,
    workspaceId: input.workflowRun.workspaceId,
  };
}

export function browserAutomationClaimResult(
  job: BackgroundJob,
  step?: WorkflowStep,
): BrowserAutomationTaskClaimResult {
  const payload = readBrowserAutomationJobPayload(job);
  const lease = readBrowserAutomationWorkerLease(job);
  return {
    claimed: true,
    job: jobSummary(job),
    ...(lease === undefined ? {} : { lease }),
    ...(step === undefined
      ? {}
      : {
          request: {
            targetHost: payload.targetHost,
            targetOrigin: payload.targetOrigin,
            targetUrl: payload.targetUrl,
            task: normalizeBrowserTaskStep(step).task,
            taskHash: payload.taskHash,
            taskLength: payload.taskLength,
          },
        }),
    sandboxPolicy: payload.sandboxPolicy,
    workerQueue: browserAutomationWorkerQueue,
    workflow: workflowSummary(payload),
  };
}

export function browserAutomationReadbackResult(
  job: BackgroundJob,
  outcome: BrowserAutomationTaskReadbackResult["outcome"],
  input: {
    errorCode?: string | undefined;
    result?: BrowserAutomationCompletionResult | undefined;
  } = {},
): BrowserAutomationTaskReadbackResult {
  const payload = readBrowserAutomationJobPayload(job);
  return {
    job: jobSummary(job),
    outcome,
    workerQueue: browserAutomationWorkerQueue,
    workflow: workflowSummary(payload),
    ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
    ...(input.result === undefined ? {} : { result: input.result }),
  };
}

export function readBrowserAutomationJobPayload(
  job: BackgroundJob,
): BrowserAutomationJobPayload {
  const payload = job.payload;
  const sandboxPolicy = readSandboxPolicy(payload.sandboxPolicy);
  if (
    payload.schemaVersion !== browserAutomationPayloadSchemaVersion ||
    payload.workerQueue !== browserAutomationWorkerQueue ||
    typeof payload.workflowId !== "string" ||
    typeof payload.workflowRunId !== "string" ||
    typeof payload.workspaceId !== "string" ||
    typeof payload.stepId !== "string" ||
    typeof payload.targetUrl !== "string" ||
    typeof payload.targetOrigin !== "string" ||
    typeof payload.targetHost !== "string" ||
    typeof payload.taskHash !== "string" ||
    typeof payload.taskLength !== "number" ||
    typeof payload.approvedBy !== "string" ||
    typeof payload.approvedAt !== "string" ||
    sandboxPolicy === undefined
  ) {
    throw new ApiError(
      "browser_automation_task_invalid",
      "Browser automation task metadata is invalid.",
      409,
    );
  }
  return {
    approvedAt: payload.approvedAt,
    approvedBy: payload.approvedBy,
    sandboxPolicy,
    schemaVersion: browserAutomationPayloadSchemaVersion,
    stepId: payload.stepId,
    targetHost: payload.targetHost,
    targetOrigin: payload.targetOrigin,
    targetUrl: payload.targetUrl,
    taskHash: payload.taskHash,
    taskLength: payload.taskLength,
    workflowId: payload.workflowId,
    workflowRunId: payload.workflowRunId,
    workerQueue: browserAutomationWorkerQueue,
    workspaceId: payload.workspaceId,
  };
}

export function readBrowserAutomationWorkerLease(
  job: BackgroundJob,
): BrowserAutomationWorkerLease | undefined {
  const value = job.payload.workerLease;
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const lease = value as Partial<BrowserAutomationWorkerLease>;
  if (
    typeof lease.workerId !== "string" ||
    typeof lease.claimedAt !== "string" ||
    typeof lease.renewedAt !== "string" ||
    typeof lease.expiresAt !== "string" ||
    typeof lease.leaseSeconds !== "number" ||
    typeof lease.attempt !== "number"
  ) {
    return undefined;
  }
  return {
    attempt: lease.attempt,
    claimedAt: lease.claimedAt,
    expiresAt: lease.expiresAt,
    leaseSeconds: lease.leaseSeconds,
    renewedAt: lease.renewedAt,
    workerId: lease.workerId,
  };
}

export function readBrowserAutomationStoredArtifacts(
  job: BackgroundJob,
): BrowserAutomationStoredArtifact[] {
  const artifacts = job.payload.browserArtifacts;
  if (!Array.isArray(artifacts)) return [];
  return artifacts
    .map(readBrowserAutomationStoredArtifact)
    .filter((artifact) => artifact !== undefined);
}

export function publicBrowserAutomationArtifact(
  artifact: BrowserAutomationStoredArtifact,
): BrowserAutomationArtifactSummary {
  return {
    artifactId: artifact.artifactId,
    artifactUrl: artifact.artifactUrl,
    type: artifact.type,
    ...(artifact.contentType === undefined
      ? {}
      : { contentType: artifact.contentType }),
    ...(artifact.sizeBytes === undefined ? {} : { sizeBytes: artifact.sizeBytes }),
  };
}

export function normalizeBrowserAutomationCompletionResult(
  input: BrowserAutomationCompletionResult,
): BrowserAutomationCompletionResult {
  const result: BrowserAutomationCompletionResult = {
    ...(input.artifactCount === undefined
      ? {}
      : { artifactCount: input.artifactCount }),
    ...(input.artifacts === undefined
      ? {}
      : { artifacts: input.artifacts.map(normalizeArtifactSummary) }),
    ...(input.capturedBytes === undefined
      ? {}
      : { capturedBytes: input.capturedBytes }),
    ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
    ...(input.navigationCount === undefined
      ? {}
      : { navigationCount: input.navigationCount }),
    ...(input.networkDeniedCount === undefined
      ? {}
      : { networkDeniedCount: input.networkDeniedCount }),
    ...(input.outputKeys === undefined
      ? {}
      : { outputKeys: uniqueStrings(input.outputKeys, 50) }),
    ...(input.redactionApplied === undefined
      ? {}
      : { redactionApplied: input.redactionApplied }),
  };
  if (input.finalOrigin !== undefined) {
    const final = normalizeFinalBrowserUrl(input.finalOrigin);
    result.finalHost = final.host;
    result.finalOrigin = final.origin;
    result.finalPath = final.path;
  }
  return result;
}

function disabledBrowserTaskSandboxPolicy(): BrowserTaskSandboxPolicy {
  return {
    artifactCapture: "metadata_only",
    downloadPolicy: "blocked",
    executionDriver: "disabled",
    network: "target_origin_only",
    uploadPolicy: "blocked",
  };
}

function externalBrowserTaskSandboxPolicy(): BrowserTaskSandboxPolicy {
  return {
    artifactCapture: "screenshots_and_traces",
    downloadPolicy: "metadata_only",
    executionDriver: "external_worker",
    network: "target_origin_only",
    uploadPolicy: "blocked",
  };
}

function hashBrowserTask(task: string): string {
  return createHash("sha256").update(task).digest("hex");
}

function jobSummary(job: BackgroundJob): {
  id: string;
  status: BackgroundJob["status"];
  type: string;
} {
  return { id: job.id, status: job.status, type: job.type };
}

function workflowSummary(
  payload: BrowserAutomationJobPayload,
): BrowserAutomationTaskReadbackResult["workflow"] {
  return {
    stepId: payload.stepId,
    workflowId: payload.workflowId,
    workflowRunId: payload.workflowRunId,
    workspaceId: payload.workspaceId,
  };
}

function readSandboxPolicy(value: unknown): BrowserTaskSandboxPolicy | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const policy = value as Partial<BrowserTaskSandboxPolicy>;
  if (
    (policy.executionDriver !== "disabled" &&
      policy.executionDriver !== "external_worker") ||
    policy.network !== "target_origin_only" ||
    (policy.artifactCapture !== "metadata_only" &&
      policy.artifactCapture !== "screenshots_and_traces") ||
    (policy.downloadPolicy !== "blocked" &&
      policy.downloadPolicy !== "metadata_only") ||
    policy.uploadPolicy !== "blocked"
  ) {
    return undefined;
  }
  return {
    artifactCapture: policy.artifactCapture,
    downloadPolicy: policy.downloadPolicy,
    executionDriver: policy.executionDriver,
    network: policy.network,
    uploadPolicy: policy.uploadPolicy,
  };
}

function normalizeFinalBrowserUrl(value: string): {
  host: string;
  origin: string;
  path: string;
} {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(
      "browser_automation_final_url_invalid",
      "Browser automation final URL must be a valid HTTPS URL.",
      400,
    );
  }
  if (url.protocol !== "https:")
    throw new ApiError(
      "browser_automation_final_url_invalid",
      "Browser automation final URL must use HTTPS.",
      400,
    );
  if (
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hash.length > 0 ||
    url.search.length > 0
  ) {
    throw new ApiError(
      "browser_automation_final_url_invalid",
      "Browser automation final URL must not include credentials, fragments, or query strings.",
      400,
    );
  }
  if (isLocalOrPrivateHost(url.hostname))
    throw new ApiError(
      "browser_automation_final_url_invalid",
      "Browser automation final URL must not target local or private hosts.",
      400,
    );
  return { host: url.hostname, origin: url.origin, path: url.pathname };
}

function normalizeArtifactSummary(
  artifact: BrowserAutomationArtifactSummary,
): BrowserAutomationArtifactSummary {
  return {
    artifactId: artifact.artifactId,
    type: artifact.type,
    ...(artifact.artifactUrl === undefined
      ? {}
      : { artifactUrl: artifact.artifactUrl }),
    ...(artifact.contentType === undefined
      ? {}
      : { contentType: artifact.contentType }),
    ...(artifact.sizeBytes === undefined ? {} : { sizeBytes: artifact.sizeBytes }),
  };
}

function readBrowserAutomationStoredArtifact(
  value: unknown,
): BrowserAutomationStoredArtifact | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const artifact = value as Partial<BrowserAutomationStoredArtifact>;
  if (
    typeof artifact.artifactId !== "string" ||
    artifact.artifactId.length === 0 ||
    (artifact.type !== "screenshot" && artifact.type !== "trace") ||
    typeof artifact.artifactUrl !== "string" ||
    typeof artifact.contentType !== "string" ||
    typeof artifact.registeredAt !== "string" ||
    typeof artifact.registeredBy !== "string" ||
    typeof artifact.sizeBytes !== "number" ||
    typeof artifact.storageKey !== "string"
  ) {
    return undefined;
  }
  return {
    artifactId: artifact.artifactId,
    artifactUrl: artifact.artifactUrl,
    contentType: artifact.contentType,
    registeredAt: artifact.registeredAt,
    registeredBy: artifact.registeredBy,
    sizeBytes: artifact.sizeBytes,
    storageKey: artifact.storageKey,
    type: artifact.type,
  };
}

function uniqueStrings(values: string[], maxItems: number): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(
    0,
    maxItems,
  );
}

function isLocalOrPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  )
    return true;
  if (host === "::1" || host === "[::1]") return true;
  if (/^127\./u.test(host) || /^10\./u.test(host) || /^192\.168\./u.test(host))
    return true;
  const match = /^172\.(\d{1,2})\./u.exec(host);
  if (match?.[1] !== undefined) {
    const second = Number(match[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}
