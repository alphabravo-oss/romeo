import { readFile } from "node:fs/promises";

import type { BackgroundJob } from "../domain/entities";
import {
  readBrowserAutomationStoredArtifacts,
  readBrowserAutomationWorkerLease,
} from "./workflow-browser-tasks";
import type { BrowserAutomationPostureReport } from "./browser-automation-service";
import {
  allowedScreenshotArtifactContentTypes,
  allowedTraceArtifactContentTypes,
} from "./browser-automation-artifacts";

const browserAutomationDefaultQueuedTimeoutSeconds = 86_400;
const browserAutomationDefaultRunningTimeoutSeconds = 3_600;
export const browserAutomationLiveEvidenceSchema =
  "romeo.browser-automation-live-evidence.v1";
export const browserAutomationRequiredLiveEvidenceChecks = [
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

export function browserAutomationQueuePosture(
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

export function browserAutomationArtifactPosture(
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

export async function readBrowserAutomationLiveEvidence(
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

export function browserAutomationWarnings(input: {
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

export function safeRunnerOriginConfigured(value: string): boolean {
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
