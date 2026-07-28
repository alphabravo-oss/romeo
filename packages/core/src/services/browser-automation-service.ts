import { assertScope, type AuthSubject } from "@romeo/auth";

import type { BackgroundJob } from "../domain/entities";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { assertAbuseControlsAllow } from "./abuse-control-service";
import {
  artifactExtension,
  browserAutomationArtifactMaxBytes,
  browserAutomationArtifactUploadTtlSeconds,
  normalizeArtifactUploadInput,
} from "./browser-automation-artifacts";
import {
  browserAutomationArtifactPosture,
  browserAutomationLiveEvidenceSchema,
  browserAutomationQueuePosture,
  browserAutomationRequiredLiveEvidenceChecks,
  browserAutomationWarnings,
  readBrowserAutomationLiveEvidence,
  safeRunnerOriginConfigured,
} from "./browser-automation-posture";
import { BrowserAutomationWorkerService } from "./browser-automation-worker-service";
import {
  browserAutomationJobType,
  browserAutomationMaxAttempts,
  browserAutomationWorkerQueue,
  publicBrowserAutomationArtifact,
  readBrowserAutomationJobPayload,
  readBrowserAutomationStoredArtifacts,
  type BrowserAutomationArtifactReadResult,
  type BrowserAutomationArtifactUploadRegistration,
  type BrowserAutomationStoredArtifact,
} from "./workflow-browser-tasks";

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

export class BrowserAutomationService extends BrowserAutomationWorkerService {
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

  protected async findReadableArtifact(
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
}
