import type { PresignedUpload } from "@romeo/storage";

import type { BackgroundJob } from "../domain/entities";

export const browserAutomationJobType =
  "workflow.browser_task.dispatch_request";
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

export interface BrowserAutomationStoredArtifact extends BrowserAutomationArtifactSummary {
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
