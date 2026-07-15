import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
import type { ObjectStore } from "@romeo/storage";
import { readFile } from "node:fs/promises";

import type { BackgroundJob, WorkflowStep } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { assertAbuseControlsAllow } from "./abuse-control-service";
import { writeAuditLog } from "./audit-log";
import type { DeferredRunStart } from "./run-service";
import type { WorkflowService } from "./workflow-service";
import {
  publicBrowserAutomationArtifact,
  browserAutomationClaimResult,
  browserAutomationJobType,
  browserAutomationMaxAttempts,
  browserAutomationReadbackResult,
  browserAutomationWorkerQueue,
  normalizeBrowserAutomationCompletionResult,
  readBrowserAutomationJobPayload,
  readBrowserAutomationStoredArtifacts,
  readBrowserAutomationWorkerLease,
  type BrowserAutomationArtifactReadResult,
  type BrowserAutomationArtifactSummary,
  type BrowserAutomationArtifactUploadRegistration,
  type BrowserAutomationCompletionResult,
  type BrowserAutomationStoredArtifact,
  type BrowserAutomationTaskClaimResult,
  type BrowserAutomationTaskExpiryResult,
  type BrowserAutomationTaskReadbackResult,
} from "./workflow-browser-tasks";

const browserAutomationArtifactUploadTtlSeconds = 900;
const browserAutomationArtifactMaxBytes = 50 * 1024 * 1024;
const browserAutomationDefaultQueuedTimeoutSeconds = 86_400;
const browserAutomationDefaultRunningTimeoutSeconds = 3_600;
const browserAutomationLiveEvidenceSchema =
  "romeo.browser-automation-live-evidence.v1";
const browserAutomationRequiredLiveEvidenceChecks = [
  "reviewed_runner_sandbox",
  "network_denial_enforced",
  "worker_crash_retry",
  "retention_worker_execution",
  "pod_log_redaction",
] as const;
const browserAutomationLiveEvidenceRedactionFields = [
  "artifactBytesReturned",
  "rawEvidencePathsReturned",
  "rawPageContentReturned",
  "rawRunnerUrlReturned",
  "rawTaskTextReturned",
  "secretValuesReturned",
] as const;

export interface BrowserAutomationPostureReport {
  schema: "romeo.browser-automation-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "ready";
  backend: {
    approvalRequired: true;
    artifactUploadTtlSeconds: number;
    maxArtifactBytes: number;
    maxAttempts: number;
    rawTaskReturnedOnlyOnActiveClaim: true;
    requiredWorkerScope: "tools:manage";
    workerQueue: typeof browserAutomationWorkerQueue;
    jobType: typeof browserAutomationJobType;
  };
  deployment: {
    liveEvidencePathConfigured: boolean;
    networkPolicyConfigured: boolean;
    runnerOriginConfigured: boolean;
    runnerUrlConfigured: boolean;
    workerEnabled: boolean;
    workerLeaseSeconds: number;
    workerMaxBytes: number;
    workerMaxJobs: number;
    workerTimeoutMs: number;
  };
  queue: {
    completed: number;
    deadLettered: number;
    failed: number;
    oldestQueuedAgeSeconds: number | null;
    queued: number;
    running: number;
    staleQueued: number;
    staleRunning: number;
    total: number;
  };
  artifacts: {
    allowedScreenshotContentTypes: string[];
    allowedTraceContentTypes: string[];
    registeredCount: number;
    taskCountWithRegisteredArtifacts: number;
  };
  liveEvidence: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "failed" | "invalid" | "not_configured" | "satisfied";
    schemaVersion?: typeof browserAutomationLiveEvidenceSchema;
    evidenceStatus?: "failed" | "passed" | "planned" | "unknown";
    mode?: "dry-run" | "live" | "unknown";
    deployment?: "compose" | "kubernetes" | "target" | "unknown";
    generatedAt?: string;
    checks: Record<
      (typeof browserAutomationRequiredLiveEvidenceChecks)[number],
      boolean
    >;
    failureCodes: string[];
    invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
    redaction: {
      artifactBytesReturned: boolean;
      rawEvidencePathsReturned: boolean;
      rawPageContentReturned: boolean;
      rawRunnerUrlReturned: boolean;
      rawTaskTextReturned: boolean;
      secretValuesReturned: boolean;
    };
  };
  redaction: {
    evidenceFileBodiesReturned: false;
    rawArtifactStorageKeysReturned: false;
    rawEvidencePathsReturned: false;
    rawRunnerUrlReturned: false;
    rawTaskTextReturned: false;
    secretValuesReturned: false;
  };
  warnings: Array<
    | "browser_automation_dead_letters_present"
    | "browser_automation_live_evidence_invalid"
    | "browser_automation_live_evidence_required"
    | "browser_automation_network_policy_not_configured"
    | "browser_automation_runner_origin_not_https"
    | "browser_automation_runner_not_configured"
    | "browser_automation_stale_tasks_present"
    | "browser_automation_worker_not_enabled"
  >;
}

export class BrowserAutomationService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly workflows: WorkflowService,
    private readonly objectStore: ObjectStore,
    private readonly env: RomeoEnv,
  ) {}

  async posture(subject: AuthSubject): Promise<BrowserAutomationPostureReport> {
    assertScope(subject, "admin:read");
    const nowMs = Date.now();
    const jobs = (
      await this.repository.listBackgroundJobs(subject.orgId)
    ).filter((job) => job.type === browserAutomationJobType);
    const queue = browserAutomationQueuePosture(jobs, nowMs);
    const artifacts = browserAutomationArtifactPosture(jobs);
    const liveEvidence = await readBrowserAutomationLiveEvidence(
      this.env.BROWSER_AUTOMATION_LIVE_EVIDENCE_PATH,
    );
    const warnings = browserAutomationWarnings({
      deadLettered: queue.deadLettered,
      liveEvidenceStatus: liveEvidence.status,
      networkPolicyConfigured:
        this.env.BROWSER_AUTOMATION_NETWORK_POLICY_ENABLED,
      runnerOriginConfigured: safeRunnerOriginConfigured(
        this.env.BROWSER_AUTOMATION_RUNNER_URL,
      ),
      runnerConfigured: this.env.BROWSER_AUTOMATION_RUNNER_URL.length > 0,
      staleQueued: queue.staleQueued,
      staleRunning: queue.staleRunning,
      workerEnabled: this.env.BROWSER_AUTOMATION_WORKER_ENABLED,
    });
    return {
      schema: "romeo.browser-automation-posture.v1",
      generatedAt: new Date(nowMs).toISOString(),
      orgId: subject.orgId,
      status: warnings.length === 0 ? "ready" : "attention_required",
      backend: {
        approvalRequired: true,
        artifactUploadTtlSeconds: browserAutomationArtifactUploadTtlSeconds,
        maxArtifactBytes: browserAutomationArtifactMaxBytes,
        maxAttempts: browserAutomationMaxAttempts,
        rawTaskReturnedOnlyOnActiveClaim: true,
        requiredWorkerScope: "tools:manage",
        workerQueue: browserAutomationWorkerQueue,
        jobType: browserAutomationJobType,
      },
      deployment: {
        liveEvidencePathConfigured:
          this.env.BROWSER_AUTOMATION_LIVE_EVIDENCE_PATH.length > 0,
        networkPolicyConfigured:
          this.env.BROWSER_AUTOMATION_NETWORK_POLICY_ENABLED,
        runnerOriginConfigured: safeRunnerOriginConfigured(
          this.env.BROWSER_AUTOMATION_RUNNER_URL,
        ),
        runnerUrlConfigured: this.env.BROWSER_AUTOMATION_RUNNER_URL.length > 0,
        workerEnabled: this.env.BROWSER_AUTOMATION_WORKER_ENABLED,
        workerLeaseSeconds: this.env.BROWSER_AUTOMATION_LEASE_SECONDS,
        workerMaxBytes: this.env.BROWSER_AUTOMATION_MAX_BYTES,
        workerMaxJobs: this.env.BROWSER_AUTOMATION_MAX_JOBS,
        workerTimeoutMs: this.env.BROWSER_AUTOMATION_TIMEOUT_MS,
      },
      queue,
      artifacts,
      liveEvidence,
      redaction: {
        evidenceFileBodiesReturned: false,
        rawArtifactStorageKeysReturned: false,
        rawEvidencePathsReturned: false,
        rawRunnerUrlReturned: false,
        rawTaskTextReturned: false,
        secretValuesReturned: false,
      },
      warnings,
    };
  }

  async claim(input: {
    leaseSeconds: number;
    subject: AuthSubject;
  }): Promise<BrowserAutomationTaskClaimResult> {
    assertScope(input.subject, "tools:manage");
    await assertAbuseControlsAllow(this.repository, input.subject, {
      action: "worker.enqueue",
      workerClass: "browser_automation",
    });
    return this.repository.transaction(async (repository) => {
      const job = await repository.claimBackgroundJob({
        orgId: input.subject.orgId,
        type: browserAutomationJobType,
        workerId: input.subject.id,
        leaseSeconds: input.leaseSeconds,
      });
      if (job === undefined)
        return { claimed: false, workerQueue: browserAutomationWorkerQueue };
      const lease = readBrowserAutomationWorkerLease(job);
      if (lease === undefined) {
        throw new ApiError(
          "browser_automation_task_lease_invalid",
          "Browser automation task lease is invalid or expired.",
          409,
        );
      }
      if (lease.attempt > browserAutomationMaxAttempts) {
        const deadLettered = await this.deadLetter(
          repository,
          input.subject,
          job,
          lease.attempt,
        );
        await this.workflows.failBrowserTaskFromWorker({
          repository,
          subject: input.subject,
          job: deadLettered,
          errorCode: "browser_automation_attempts_exhausted",
        });
        return { claimed: false, workerQueue: browserAutomationWorkerQueue };
      }
      const step = await this.browserWorkflowStep(
        repository,
        input.subject,
        job,
      );
      await this.audit(
        repository,
        input.subject,
        job,
        "worker.claim",
        "success",
        {
          attempt: lease.attempt,
          leaseSeconds: lease.leaseSeconds,
        },
      );
      return browserAutomationClaimResult(job, step);
    });
  }

  async renewLease(input: {
    jobId: string;
    leaseSeconds: number;
    subject: AuthSubject;
  }): Promise<BrowserAutomationTaskClaimResult> {
    assertScope(input.subject, "tools:manage");
    const job = await this.repository.renewBackgroundJobLease({
      orgId: input.subject.orgId,
      jobId: input.jobId,
      workerId: input.subject.id,
      leaseSeconds: input.leaseSeconds,
    });
    if (job === undefined) {
      throw new ApiError(
        "browser_automation_task_lease_invalid",
        "Browser automation task lease is invalid or expired.",
        409,
      );
    }
    const step = await this.browserWorkflowStep(
      this.repository,
      input.subject,
      job,
    );
    await this.audit(
      this.repository,
      input.subject,
      job,
      "worker.renew_lease",
      "success",
      { leaseSeconds: input.leaseSeconds },
    );
    return browserAutomationClaimResult(job, step);
  }

  async createArtifactUpload(input: {
    contentType: string;
    jobId: string;
    sizeBytes: number;
    subject: AuthSubject;
    type: "screenshot" | "trace";
  }): Promise<BrowserAutomationArtifactUploadRegistration> {
    assertScope(input.subject, "tools:manage");
    const artifactInput = normalizeArtifactUploadInput(input);
    await assertAbuseControlsAllow(this.repository, input.subject, {
      action: "file.upload",
      workerClass: "browser_automation",
    });
    return this.repository.transaction(async (repository) => {
      const job = await this.claimedJob(repository, input.subject, input.jobId);
      const payload = readBrowserAutomationJobPayload(job);
      const storedArtifacts = readBrowserAutomationStoredArtifacts(job);
      if (storedArtifacts.length >= 20) {
        throw new ApiError(
          "browser_automation_artifact_limit_exceeded",
          "Browser automation tasks can register at most 20 artifacts.",
          400,
          { maxArtifacts: 20 },
        );
      }
      const now = new Date().toISOString();
      const artifactId = createId("browser_artifact");
      const storageKey = [
        "browser-automation",
        input.subject.orgId,
        job.id,
        `${artifactId}.${artifactExtension(artifactInput.contentType)}`,
      ].join("/");
      const upload = await this.objectStore.createPresignedUpload({
        key: storageKey,
        contentType: artifactInput.contentType,
        expiresInSeconds: browserAutomationArtifactUploadTtlSeconds,
      });
      const artifact: BrowserAutomationStoredArtifact = {
        artifactId,
        artifactUrl: `/api/v1/browser-automation-artifacts/${encodeURIComponent(artifactId)}`,
        contentType: artifactInput.contentType,
        registeredAt: now,
        registeredBy: input.subject.id,
        sizeBytes: artifactInput.sizeBytes,
        storageKey,
        type: artifactInput.type,
      };
      const artifacts = [...storedArtifacts, artifact];
      await repository.updateBackgroundJob({
        ...job,
        payload: { ...job.payload, browserArtifacts: artifacts },
        updatedAt: now,
      });
      await this.audit(
        repository,
        input.subject,
        job,
        "artifact.register",
        "success",
        {
          artifactCount: artifacts.length,
          artifactId,
          artifactType: artifact.type,
          contentType: artifact.contentType,
          sizeBytes: artifact.sizeBytes,
          workflowRunId: payload.workflowRunId,
        },
      );
      return { artifact: publicBrowserAutomationArtifact(artifact), upload };
    });
  }

  async readArtifact(input: {
    artifactId: string;
    subject: AuthSubject;
  }): Promise<BrowserAutomationArtifactReadResult> {
    assertScope(input.subject, "agents:read");
    const match = await this.findReadableArtifact(
      input.subject,
      input.artifactId,
    );
    if (match === undefined) throw notFound("Browser automation artifact");
    const bytes = await this.objectStore.getObject(match.artifact.storageKey);
    if (bytes === undefined)
      throw new ApiError(
        "browser_automation_artifact_object_missing",
        "Browser automation artifact object was not found.",
        409,
      );
    if (bytes.byteLength !== match.artifact.sizeBytes) {
      throw new ApiError(
        "browser_automation_artifact_size_mismatch",
        "Browser automation artifact size does not match the registered size.",
        409,
      );
    }
    return {
      artifact: publicBrowserAutomationArtifact(match.artifact),
      bytes,
    };
  }

  async complete(input: {
    jobId: string;
    result: BrowserAutomationCompletionResult;
    subject: AuthSubject;
  }): Promise<BrowserAutomationTaskReadbackResult> {
    assertScope(input.subject, "tools:manage");
    const deferredStarts: DeferredRunStart[] = [];
    const readback = await this.repository.transaction(async (repository) => {
      const job = await this.claimedJob(repository, input.subject, input.jobId);
      const result = withRegisteredArtifacts(
        normalizeBrowserAutomationCompletionResult(input.result),
        readBrowserAutomationStoredArtifacts(job),
      );
      const now = new Date().toISOString();
      const completed = await repository.updateBackgroundJob({
        ...job,
        status: "completed",
        payload: {
          ...job.payload,
          result,
          workerCompletedAt: now,
          workerId: input.subject.id,
        },
        updatedAt: now,
        completedAt: now,
      });
      await this.workflows.completeBrowserTaskFromWorker({
        repository,
        subject: input.subject,
        job: completed,
        result,
        deferredStarts,
      });
      await this.audit(
        repository,
        input.subject,
        completed,
        "worker.complete",
        "success",
        {
          artifactCount: result.artifactCount ?? result.artifacts?.length ?? 0,
          finalHost: result.finalHost ?? null,
          navigationCount: result.navigationCount ?? null,
        },
      );
      return browserAutomationReadbackResult(completed, "completed", {
        result,
      });
    });
    for (const start of deferredStarts) start.startExecution();
    return readback;
  }

  async fail(input: {
    errorCode: string;
    jobId: string;
    subject: AuthSubject;
  }): Promise<BrowserAutomationTaskReadbackResult> {
    assertScope(input.subject, "tools:manage");
    return this.repository.transaction(async (repository) => {
      const job = await this.claimedJob(repository, input.subject, input.jobId);
      const failed = await this.failJob(
        repository,
        input.subject,
        job,
        input.errorCode,
      );
      await this.workflows.failBrowserTaskFromWorker({
        repository,
        subject: input.subject,
        job: failed,
        errorCode: input.errorCode,
      });
      return browserAutomationReadbackResult(failed, "failed", {
        errorCode: input.errorCode,
      });
    });
  }

  async expire(input: {
    limit: number;
    queuedTimeoutSeconds: number;
    runningTimeoutSeconds: number;
    subject: AuthSubject;
  }): Promise<BrowserAutomationTaskExpiryResult> {
    assertScope(input.subject, "tools:manage");
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    return this.repository.transaction(async (repository) => {
      const candidates = (
        await repository.listBackgroundJobs(input.subject.orgId)
      )
        .map((job) => expirationCandidate(job, input, nowMs))
        .filter((candidate) => candidate !== undefined)
        .sort(
          (left, right) =>
            left.referenceTimeMs - right.referenceTimeMs ||
            left.job.id.localeCompare(right.job.id),
        )
        .slice(0, input.limit);
      const jobs: BrowserAutomationTaskExpiryResult["jobs"] = [];
      for (const candidate of candidates) {
        const expired = await repository.updateBackgroundJob({
          ...candidate.job,
          status: "failed",
          payload: {
            ...candidate.job.payload,
            errorCode: "browser_automation_task_expired",
            expiration: {
              ageSeconds: candidate.ageSeconds,
              expiredAt: now,
              expiredBy: input.subject.id,
              reasonCode: candidate.reasonCode,
            },
          },
          updatedAt: now,
          completedAt: now,
        });
        await this.workflows.failBrowserTaskFromWorker({
          repository,
          subject: input.subject,
          job: expired,
          errorCode: "browser_automation_task_expired",
        });
        await this.audit(
          repository,
          input.subject,
          expired,
          "worker.expire",
          "failure",
          {
            errorCode: "browser_automation_task_expired",
            reasonCode: candidate.reasonCode,
          },
        );
        jobs.push({
          ...browserAutomationReadbackResult(expired, "failed", {
            errorCode: "browser_automation_task_expired",
          }),
          reasonCode: candidate.reasonCode,
        });
      }
      return {
        expired: jobs.length,
        jobs,
        workerQueue: browserAutomationWorkerQueue,
      };
    });
  }

  private async claimedJob(
    repository: RomeoRepository,
    subject: AuthSubject,
    jobId: string,
  ): Promise<BackgroundJob> {
    const job = (await repository.listBackgroundJobs(subject.orgId)).find(
      (item) => item.id === jobId && item.type === browserAutomationJobType,
    );
    if (job === undefined) throw notFound("Browser automation task");
    if (job.status !== "running") {
      throw new ApiError(
        "browser_automation_task_not_claimed",
        "Browser automation task is not claimed by this worker.",
        409,
        { status: job.status },
      );
    }
    const lease = readBrowserAutomationWorkerLease(job);
    if (
      lease === undefined ||
      lease.workerId !== subject.id ||
      Date.parse(lease.expiresAt) <= Date.now()
    ) {
      throw new ApiError(
        "browser_automation_task_lease_invalid",
        "Browser automation task lease is invalid or expired.",
        409,
      );
    }
    return job;
  }

  private async browserWorkflowStep(
    repository: RomeoRepository,
    subject: AuthSubject,
    job: BackgroundJob,
  ): Promise<WorkflowStep> {
    const payload = readBrowserAutomationJobPayload(job);
    const workflow = await repository.getWorkflowDefinition(payload.workflowId);
    if (workflow === undefined || workflow.orgId !== subject.orgId)
      throw notFound("Workflow");
    if (
      subject.isAdmin !== true &&
      !subject.workspaceIds.includes(workflow.workspaceId)
    ) {
      throw new ApiError(
        "browser_automation_workspace_forbidden",
        "Browser automation task is outside the caller workspace access.",
        403,
      );
    }
    const step = workflow.steps.find((item) => item.id === payload.stepId);
    if (step?.type !== "browser_task") {
      throw new ApiError(
        "browser_automation_task_invalid",
        "Browser automation task does not reference a browser workflow step.",
        409,
      );
    }
    return step;
  }

  private async deadLetter(
    repository: RomeoRepository,
    subject: AuthSubject,
    job: BackgroundJob,
    nextAttempt: number,
  ): Promise<BackgroundJob> {
    const now = new Date().toISOString();
    const deadLettered = await repository.updateBackgroundJob({
      ...job,
      status: "failed",
      payload: {
        ...job.payload,
        deadLetter: {
          failedAt: now,
          maxAttempts: browserAutomationMaxAttempts,
          nextAttempt,
          reasonCode: "max_attempts_exhausted",
          workerId: subject.id,
        },
        errorCode: "browser_automation_attempts_exhausted",
        workerFailedAt: now,
        workerId: subject.id,
      },
      updatedAt: now,
      completedAt: now,
    });
    await this.audit(
      repository,
      subject,
      deadLettered,
      "worker.dead_letter",
      "failure",
      {
        errorCode: "browser_automation_attempts_exhausted",
        maxAttempts: browserAutomationMaxAttempts,
        nextAttempt,
        reasonCode: "max_attempts_exhausted",
      },
    );
    return deadLettered;
  }

  private async failJob(
    repository: RomeoRepository,
    subject: AuthSubject,
    job: BackgroundJob,
    errorCode: string,
  ): Promise<BackgroundJob> {
    const now = new Date().toISOString();
    const failed = await repository.updateBackgroundJob({
      ...job,
      status: "failed",
      payload: {
        ...job.payload,
        errorCode,
        workerFailedAt: now,
        workerId: subject.id,
      },
      updatedAt: now,
      completedAt: now,
    });
    await this.audit(repository, subject, failed, "worker.fail", "failure", {
      errorCode,
    });
    return failed;
  }

  private async findReadableArtifact(
    subject: AuthSubject,
    artifactId: string,
  ): Promise<
    | { artifact: BrowserAutomationStoredArtifact; job: BackgroundJob }
    | undefined
  > {
    const jobs = await this.repository.listBackgroundJobs(subject.orgId);
    for (const job of jobs) {
      if (job.type !== browserAutomationJobType) continue;
      const artifact = readBrowserAutomationStoredArtifacts(job).find(
        (item) => item.artifactId === artifactId,
      );
      if (artifact === undefined) continue;
      const payload = readBrowserAutomationJobPayload(job);
      if (
        subject.isAdmin === true ||
        subject.workspaceIds.includes(payload.workspaceId)
      ) {
        return { artifact, job };
      }
    }
    return undefined;
  }

  private async audit(
    repository: RomeoRepository,
    subject: AuthSubject,
    job: BackgroundJob,
    action: string,
    outcome: "failure" | "success",
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const payload = readBrowserAutomationJobPayload(job);
    await writeAuditLog(repository, {
      subject,
      action: `workflow.browser_task.${action}`,
      resourceType: "workflow",
      resourceId: payload.workflowRunId,
      outcome,
      metadata: {
        jobId: job.id,
        stepId: payload.stepId,
        targetHost: payload.targetHost,
        targetOrigin: payload.targetOrigin,
        workflowId: payload.workflowId,
        workerQueue: payload.workerQueue,
        ...metadata,
      },
    });
  }
}

interface BrowserAutomationExpirationCandidate {
  ageSeconds: number;
  job: BackgroundJob;
  reasonCode: "queued_timeout" | "running_lease_timeout";
  referenceTimeMs: number;
}

function expirationCandidate(
  job: BackgroundJob,
  input: {
    queuedTimeoutSeconds: number;
    runningTimeoutSeconds: number;
  },
  nowMs: number,
): BrowserAutomationExpirationCandidate | undefined {
  if (job.type !== browserAutomationJobType) return undefined;
  if (job.status === "completed" || job.status === "failed") return undefined;
  if (job.status === "queued") {
    const createdAtMs = Date.parse(job.createdAt);
    if (!Number.isFinite(createdAtMs)) return undefined;
    const ageSeconds = Math.floor((nowMs - createdAtMs) / 1000);
    if (ageSeconds < input.queuedTimeoutSeconds) return undefined;
    return {
      ageSeconds,
      job,
      reasonCode: "queued_timeout",
      referenceTimeMs: createdAtMs,
    };
  }
  const lease = readBrowserAutomationWorkerLease(job);
  if (lease === undefined) return undefined;
  const leaseExpiresAtMs = Date.parse(lease.expiresAt);
  if (!Number.isFinite(leaseExpiresAtMs)) return undefined;
  const leaseExpiredSeconds = Math.floor((nowMs - leaseExpiresAtMs) / 1000);
  if (leaseExpiredSeconds < input.runningTimeoutSeconds) return undefined;
  return {
    ageSeconds: Math.max(
      0,
      Math.floor((nowMs - Date.parse(job.createdAt)) / 1000),
    ),
    job,
    reasonCode: "running_lease_timeout",
    referenceTimeMs: leaseExpiresAtMs,
  };
}

const allowedScreenshotArtifactContentTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const allowedTraceArtifactContentTypes = new Set([
  "application/gzip",
  "application/json",
  "application/octet-stream",
  "application/x-ndjson",
  "application/zip",
]);

function normalizeArtifactUploadInput(input: {
  contentType: string;
  sizeBytes: number;
  type: "screenshot" | "trace";
}): {
  contentType: string;
  sizeBytes: number;
  type: "screenshot" | "trace";
} {
  const contentType = input.contentType.trim().toLowerCase();
  const allowed =
    input.type === "screenshot"
      ? allowedScreenshotArtifactContentTypes
      : allowedTraceArtifactContentTypes;
  if (!allowed.has(contentType)) {
    throw new ApiError(
      "browser_automation_artifact_content_type_invalid",
      "Browser automation artifact content type is not allowed.",
      400,
      {
        allowedContentTypes: [...allowed].sort(),
        type: input.type,
      },
    );
  }
  if (
    !Number.isInteger(input.sizeBytes) ||
    input.sizeBytes <= 0 ||
    input.sizeBytes > browserAutomationArtifactMaxBytes
  ) {
    throw new ApiError(
      "browser_automation_artifact_size_invalid",
      "Browser automation artifact size is outside the allowed range.",
      400,
      { maxBytes: browserAutomationArtifactMaxBytes },
    );
  }
  return { contentType, sizeBytes: input.sizeBytes, type: input.type };
}

function artifactExtension(contentType: string): string {
  switch (contentType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "application/gzip":
      return "gz";
    case "application/json":
      return "json";
    case "application/x-ndjson":
      return "ndjson";
    case "application/zip":
      return "zip";
    default:
      return "bin";
  }
}

function withRegisteredArtifacts(
  result: BrowserAutomationCompletionResult,
  storedArtifacts: BrowserAutomationStoredArtifact[],
): BrowserAutomationCompletionResult {
  const registeredArtifacts = storedArtifacts.map(
    publicBrowserAutomationArtifact,
  );
  if (registeredArtifacts.length === 0) {
    if (result.artifacts === undefined) return result;
    return {
      ...result,
      artifacts: result.artifacts.map(withoutArtifactUrl),
    };
  }
  if (result.artifacts === undefined) {
    return {
      ...result,
      artifactCount: result.artifactCount ?? registeredArtifacts.length,
      artifacts: registeredArtifacts,
    };
  }
  const registeredById = new Map(
    registeredArtifacts.map((artifact) => [artifact.artifactId, artifact]),
  );
  const artifacts = result.artifacts.map(
    (artifact) =>
      registeredById.get(artifact.artifactId) ?? withoutArtifactUrl(artifact),
  );
  const seen = new Set(artifacts.map((artifact) => artifact.artifactId));
  for (const registered of registeredArtifacts) {
    if (!seen.has(registered.artifactId)) artifacts.push(registered);
  }
  return {
    ...result,
    artifactCount: result.artifactCount ?? artifacts.length,
    artifacts,
  };
}

function withoutArtifactUrl(
  artifact: BrowserAutomationArtifactSummary,
): BrowserAutomationArtifactSummary {
  return {
    artifactId: artifact.artifactId,
    type: artifact.type,
    ...(artifact.contentType === undefined
      ? {}
      : { contentType: artifact.contentType }),
    ...(artifact.sizeBytes === undefined
      ? {}
      : { sizeBytes: artifact.sizeBytes }),
  };
}

function browserAutomationQueuePosture(
  jobs: BackgroundJob[],
  nowMs: number,
): BrowserAutomationPostureReport["queue"] {
  let completed = 0;
  let deadLettered = 0;
  let failed = 0;
  let oldestQueuedAgeSeconds: number | null = null;
  let queued = 0;
  let running = 0;
  let staleQueued = 0;
  let staleRunning = 0;
  for (const job of jobs) {
    if (job.status === "completed") completed += 1;
    if (job.status === "failed") failed += 1;
    if (job.status === "queued") {
      queued += 1;
      const ageSeconds = ageSecondsSince(job.createdAt, nowMs);
      if (ageSeconds !== undefined) {
        oldestQueuedAgeSeconds =
          oldestQueuedAgeSeconds === null
            ? ageSeconds
            : Math.max(oldestQueuedAgeSeconds, ageSeconds);
        if (ageSeconds >= browserAutomationDefaultQueuedTimeoutSeconds)
          staleQueued += 1;
      }
    }
    if (job.status === "running") {
      running += 1;
      const lease = readBrowserAutomationWorkerLease(job);
      const leaseExpiresAtMs =
        lease === undefined ? undefined : Date.parse(lease.expiresAt);
      if (
        leaseExpiresAtMs !== undefined &&
        Number.isFinite(leaseExpiresAtMs) &&
        nowMs - leaseExpiresAtMs >=
          browserAutomationDefaultRunningTimeoutSeconds * 1000
      ) {
        staleRunning += 1;
      }
    }
    if (job.payload?.deadLetter !== undefined) deadLettered += 1;
  }
  return {
    completed,
    deadLettered,
    failed,
    oldestQueuedAgeSeconds,
    queued,
    running,
    staleQueued,
    staleRunning,
    total: jobs.length,
  };
}

function browserAutomationArtifactPosture(
  jobs: BackgroundJob[],
): BrowserAutomationPostureReport["artifacts"] {
  let registeredCount = 0;
  let taskCountWithRegisteredArtifacts = 0;
  for (const job of jobs) {
    const artifacts = readBrowserAutomationStoredArtifacts(job);
    if (artifacts.length > 0) {
      taskCountWithRegisteredArtifacts += 1;
      registeredCount += artifacts.length;
    }
  }
  return {
    allowedScreenshotContentTypes: [
      ...allowedScreenshotArtifactContentTypes,
    ].sort(),
    allowedTraceContentTypes: [...allowedTraceArtifactContentTypes].sort(),
    registeredCount,
    taskCountWithRegisteredArtifacts,
  };
}

async function readBrowserAutomationLiveEvidence(
  evidencePath: string,
): Promise<BrowserAutomationPostureReport["liveEvidence"]> {
  const emptyChecks = Object.fromEntries(
    browserAutomationRequiredLiveEvidenceChecks.map((check) => [check, false]),
  ) as BrowserAutomationPostureReport["liveEvidence"]["checks"];
  const notConfigured: BrowserAutomationPostureReport["liveEvidence"] = {
    configured: false,
    source: "not_configured",
    status: "not_configured",
    checks: emptyChecks,
    failureCodes: [],
    redaction: liveEvidenceRedaction(),
  };
  if (evidencePath.trim().length === 0) return notConfigured;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(evidencePath, "utf8"));
  } catch (error) {
    return {
      ...notConfigured,
      configured: true,
      source: "configured_file",
      status: "invalid",
      failureCodes: [isSyntaxError(error) ? "invalid_json" : "read_failed"],
      invalidReason: isSyntaxError(error) ? "invalid_json" : "read_failed",
    };
  }
  if (!isRecord(parsed)) {
    return invalidLiveEvidence("schema_mismatch", ["evidence_not_object"]);
  }
  const schemaVersion =
    stringValue(parsed.schemaVersion) ?? stringValue(parsed.schema);
  if (schemaVersion !== browserAutomationLiveEvidenceSchema) {
    return invalidLiveEvidence("schema_mismatch", ["schema_mismatch"]);
  }
  const checks = liveEvidenceChecks(parsed.checks);
  const redaction = liveEvidenceRedactionFrom(parsed.redaction);
  const evidenceStatus = evidenceStatusValue(parsed.status);
  const mode = modeValue(parsed.mode);
  const deployment = deploymentValue(parsed.deployment);
  const failureCodes = browserAutomationLiveEvidenceFailureCodes({
    checks,
    deployment,
    evidence: parsed,
    mode,
    redaction,
  });
  const failed = evidenceStatus !== "passed" || failureCodes.length > 0;
  return {
    configured: true,
    source: "configured_file",
    status: failed ? "failed" : "satisfied",
    schemaVersion: browserAutomationLiveEvidenceSchema,
    evidenceStatus,
    ...(typeof parsed.generatedAt === "string"
      ? { generatedAt: parsed.generatedAt }
      : {}),
    mode,
    deployment,
    checks,
    failureCodes,
    redaction,
  };
}

function invalidLiveEvidence(
  invalidReason: "invalid_json" | "read_failed" | "schema_mismatch",
  failureCodes: string[],
): BrowserAutomationPostureReport["liveEvidence"] {
  const checks = Object.fromEntries(
    browserAutomationRequiredLiveEvidenceChecks.map((check) => [check, false]),
  ) as BrowserAutomationPostureReport["liveEvidence"]["checks"];
  return {
    configured: true,
    source: "configured_file",
    status: "invalid",
    checks,
    failureCodes,
    invalidReason,
    redaction: liveEvidenceRedaction(),
  };
}

function liveEvidenceChecks(
  value: unknown,
): BrowserAutomationPostureReport["liveEvidence"]["checks"] {
  const source = Array.isArray(value) ? value : [];
  const passed = new Set(
    source.flatMap((item) => {
      if (typeof item === "string") return [item];
      if (
        isRecord(item) &&
        typeof item.id === "string" &&
        (item.status === "passed" || item.passed === true)
      ) {
        return [item.id];
      }
      return [];
    }),
  );
  return Object.fromEntries(
    browserAutomationRequiredLiveEvidenceChecks.map((check) => [
      check,
      passed.has(check),
    ]),
  ) as BrowserAutomationPostureReport["liveEvidence"]["checks"];
}

function liveEvidenceRedaction(): BrowserAutomationPostureReport["liveEvidence"]["redaction"] {
  return {
    artifactBytesReturned: false,
    rawEvidencePathsReturned: false,
    rawPageContentReturned: false,
    rawRunnerUrlReturned: false,
    rawTaskTextReturned: false,
    secretValuesReturned: false,
  };
}

function liveEvidenceRedactionFrom(
  value: unknown,
): BrowserAutomationPostureReport["liveEvidence"]["redaction"] {
  if (!isRecord(value)) return liveEvidenceRedaction();
  return {
    artifactBytesReturned: value.artifactBytesReturned === true,
    rawEvidencePathsReturned: value.rawEvidencePathsReturned === true,
    rawPageContentReturned: value.rawPageContentReturned === true,
    rawRunnerUrlReturned: value.rawRunnerUrlReturned === true,
    rawTaskTextReturned: value.rawTaskTextReturned === true,
    secretValuesReturned: value.secretValuesReturned === true,
  };
}

function allLiveEvidenceRedactionFalse(
  redaction: BrowserAutomationPostureReport["liveEvidence"]["redaction"],
): boolean {
  return (
    redaction.artifactBytesReturned === false &&
    redaction.rawEvidencePathsReturned === false &&
    redaction.rawPageContentReturned === false &&
    redaction.rawRunnerUrlReturned === false &&
    redaction.rawTaskTextReturned === false &&
    redaction.secretValuesReturned === false
  );
}

function browserAutomationLiveEvidenceFailureCodes(input: {
  checks: BrowserAutomationPostureReport["liveEvidence"]["checks"];
  deployment: BrowserAutomationPostureReport["liveEvidence"]["deployment"];
  evidence: Record<string, unknown>;
  mode: BrowserAutomationPostureReport["liveEvidence"]["mode"];
  redaction: BrowserAutomationPostureReport["liveEvidence"]["redaction"];
}): string[] {
  const failures: string[] = [];
  if (input.mode !== "live") {
    failures.push("browser_automation_live_evidence_not_live");
  }
  if (input.deployment !== "kubernetes" && input.deployment !== "target") {
    failures.push("browser_automation_live_deployment_invalid");
  }
  for (const check of browserAutomationRequiredLiveEvidenceChecks) {
    if (input.checks[check] !== true) {
      failures.push(`browser_automation_live_missing_check:${check}`);
    }
  }

  const runnerSandbox = recordValue(input.evidence.runnerSandbox);
  if (
    runnerSandbox.reviewedRunnerSandbox !== true ||
    runnerSandbox.isolatedContextPerTask !== true ||
    runnerSandbox.runnerProcessIsolated !== true ||
    runnerSandbox.targetOriginOnly !== true
  ) {
    failures.push("browser_automation_live_runner_sandbox_invalid");
  }

  const networkDenial = recordValue(input.evidence.networkDenial);
  if (
    networkDenial.privateNetworkDenied !== true ||
    networkDenial.cniOrNetworkPolicyDenied !== true ||
    networkDenial.dnsRebindingDenied !== true ||
    positiveInteger(networkDenial.deniedNetworkCount) === false ||
    positiveInteger(networkDenial.blockedTargetCount) === false
  ) {
    failures.push("browser_automation_live_network_denial_invalid");
  }

  const crashRetry = recordValue(input.evidence.crashRetry);
  const reclaimedAttempt = crashRetry.reclaimedAttempt;
  if (
    crashRetry.workerCrashRetryVerified !== true ||
    typeof reclaimedAttempt !== "number" ||
    !Number.isInteger(reclaimedAttempt) ||
    reclaimedAttempt < 2 ||
    crashRetry.completedAfterRetry !== true
  ) {
    failures.push("browser_automation_live_crash_retry_invalid");
  }

  const retention = recordValue(input.evidence.retention);
  if (
    retention.workerExecutionVerified !== true ||
    positiveInteger(retention.deletedArtifactCount) === false ||
    positiveInteger(retention.cleanedJobCount) === false
  ) {
    failures.push("browser_automation_live_retention_invalid");
  }

  const logRedaction = recordValue(input.evidence.logRedaction);
  if (
    logRedaction.podLogRedactionVerified !== true ||
    logRedaction.workerLogRedactionVerified !== true ||
    positiveInteger(logRedaction.podLogScanCount) === false ||
    positiveInteger(logRedaction.workerLogScanCount) === false ||
    logRedaction.rawTaskSentinelHitCount !== 0 ||
    logRedaction.rawPageSentinelHitCount !== 0 ||
    logRedaction.secretSentinelHitCount !== 0
  ) {
    failures.push("browser_automation_live_log_redaction_invalid");
  }

  for (const field of browserAutomationLiveEvidenceRedactionFields) {
    if (
      !isRecord(input.evidence.redaction) ||
      input.redaction[field] !== false
    ) {
      failures.push(`browser_automation_live_redaction_invalid:${field}`);
    }
  }

  return Array.from(new Set(failures));
}

function browserAutomationWarnings(input: {
  deadLettered: number;
  liveEvidenceStatus: BrowserAutomationPostureReport["liveEvidence"]["status"];
  networkPolicyConfigured: boolean;
  runnerOriginConfigured: boolean;
  runnerConfigured: boolean;
  staleQueued: number;
  staleRunning: number;
  workerEnabled: boolean;
}): BrowserAutomationPostureReport["warnings"] {
  const warnings: BrowserAutomationPostureReport["warnings"] = [];
  if (!input.workerEnabled)
    warnings.push("browser_automation_worker_not_enabled");
  if (!input.runnerConfigured)
    warnings.push("browser_automation_runner_not_configured");
  if (input.runnerConfigured && !input.runnerOriginConfigured)
    warnings.push("browser_automation_runner_origin_not_https");
  if (!input.networkPolicyConfigured)
    warnings.push("browser_automation_network_policy_not_configured");
  if (input.liveEvidenceStatus === "not_configured")
    warnings.push("browser_automation_live_evidence_required");
  if (
    input.liveEvidenceStatus === "invalid" ||
    input.liveEvidenceStatus === "failed"
  )
    warnings.push("browser_automation_live_evidence_invalid");
  if (input.staleQueued > 0 || input.staleRunning > 0)
    warnings.push("browser_automation_stale_tasks_present");
  if (input.deadLettered > 0)
    warnings.push("browser_automation_dead_letters_present");
  return warnings;
}

function safeRunnerOriginConfigured(value: string): boolean {
  if (value.length === 0) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function ageSecondsSince(value: string, nowMs: number): number | undefined {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return undefined;
  return Math.max(0, Math.floor((nowMs - time) / 1000));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function positiveInteger(value: unknown): boolean {
  return Number.isInteger(value) && typeof value === "number" && value > 0;
}

function evidenceStatusValue(
  value: unknown,
): "failed" | "passed" | "planned" | "unknown" {
  if (value === "failed" || value === "passed" || value === "planned") {
    return value;
  }
  return "unknown";
}

function modeValue(value: unknown): "dry-run" | "live" | "unknown" {
  if (value === "dry-run" || value === "live") return value;
  return "unknown";
}

function deploymentValue(
  value: unknown,
): "compose" | "kubernetes" | "target" | "unknown" {
  if (value === "compose" || value === "kubernetes" || value === "target") {
    return value;
  }
  return "unknown";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isSyntaxError(error: unknown): boolean {
  return error instanceof SyntaxError;
}
