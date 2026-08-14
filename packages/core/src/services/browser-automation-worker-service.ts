import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
import type { ObjectStore } from "@romeo/storage";

import type { BackgroundJob, WorkflowStep } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { assertAbuseControlsAllow } from "./abuse-control-service";
import { writeAuditLog } from "./audit-log";
import type { DeferredRunStart } from "./run-service";
import { continueTelemetryContextFromPayload } from "./telemetry-context";
import type { WorkflowService } from "./workflow-service";
import {
  browserAutomationClaimResult,
  browserAutomationJobType,
  browserAutomationMaxAttempts,
  browserAutomationReadbackResult,
  browserAutomationWorkerQueue,
  normalizeBrowserAutomationCompletionResult,
  readBrowserAutomationJobPayload,
  readBrowserAutomationStoredArtifacts,
  readBrowserAutomationWorkerLease,
  type BrowserAutomationCompletionResult,
  type BrowserAutomationTaskClaimResult,
  type BrowserAutomationTaskExpiryResult,
  type BrowserAutomationTaskReadbackResult,
} from "./workflow-browser-tasks";
import { withRegisteredArtifacts } from "./browser-automation-artifacts";

export class BrowserAutomationWorkerService {
  constructor(
    protected readonly repository: RomeoRepository,
    protected readonly workflows: WorkflowService,
    protected readonly objectStore: ObjectStore,
    protected readonly env: RomeoEnv,
  ) {}

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
      continueTelemetryContextFromPayload(job.payload);
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

  protected async claimedJob(
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

  protected async browserWorkflowStep(
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

  protected async deadLetter(
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

  protected async failJob(
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

  protected async audit(
    repository: RomeoRepository,
    subject: AuthSubject,
    job: BackgroundJob,
    action: BrowserWorkerAuditSuffix,
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

type BrowserWorkerAuditSuffix =
  | "artifact.register"
  | "worker.claim"
  | "worker.complete"
  | "worker.dead_letter"
  | "worker.expire"
  | "worker.fail"
  | "worker.renew_lease";

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
