import type { BackgroundJob } from "../domain/entities";
import {
  readBrowserAutomationStoredArtifacts,
  readBrowserAutomationWorkerLease,
} from "./browser-automation-tasks";
import type { BrowserAutomationPostureReport } from "./browser-automation-service";
import {
  allowedScreenshotArtifactContentTypes,
  allowedTraceArtifactContentTypes,
} from "./browser-automation-artifacts";

const browserAutomationDefaultQueuedTimeoutSeconds = 86_400;
const browserAutomationDefaultRunningTimeoutSeconds = 3_600;
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

export function browserAutomationWarnings(input: {
  deadLettered: number;
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
