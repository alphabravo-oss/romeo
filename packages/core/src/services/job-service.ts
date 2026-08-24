import { assertScope, type AuthSubject } from "@romeo/auth";

import type { BackgroundJob } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { createId } from "../ids";
import { collectBackgroundJobs } from "./background-job-query";
import { telemetryJobPayload } from "./telemetry-context";

export interface JobLagThresholds {
  deadLetterCriticalCount: number;
  deadLetterWarningCount: number;
  queuedWarningSeconds: number;
  queuedCriticalSeconds: number;
  runningWarningSeconds: number;
  runningCriticalSeconds: number;
  failedLookbackSeconds: number;
  failedWarningCount: number;
  failedCriticalCount: number;
}

export interface BackgroundJobStatusCounts {
  total: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
}

export interface BackgroundJobTypeSummary extends BackgroundJobStatusCounts {
  type: string;
  deadLettered: number;
  recentFailed: number;
  oldestQueuedAgeSeconds?: number;
  oldestQueuedJobId?: string;
  longestRunningAgeSeconds?: number;
  longestRunningJobId?: string;
}

export interface JobOperationalAlert {
  id: string;
  metric:
    | "dead_letter_jobs"
    | "queued_lag_seconds"
    | "recent_failed_jobs"
    | "running_stale_seconds";
  severity: "critical" | "warning";
  type: string;
  value: number;
  threshold: number;
  jobId?: string;
}

export interface JobOperationalSummary {
  generatedAt: string;
  status: "critical" | "degraded" | "healthy";
  thresholds: JobLagThresholds;
  totals: BackgroundJobStatusCounts & {
    deadLettered: number;
    recentFailed: number;
  };
  byType: BackgroundJobTypeSummary[];
  alerts: JobOperationalAlert[];
}

export const DEFAULT_JOB_LAG_THRESHOLDS: JobLagThresholds = {
  deadLetterCriticalCount: 5,
  deadLetterWarningCount: 1,
  queuedWarningSeconds: 300,
  queuedCriticalSeconds: 900,
  runningWarningSeconds: 900,
  runningCriticalSeconds: 3600,
  failedLookbackSeconds: 3600,
  failedWarningCount: 1,
  failedCriticalCount: 5,
};

export class JobService {
  constructor(private readonly repository: RomeoRepository) {}

  list(subject: AuthSubject): Promise<BackgroundJob[]> {
    assertScope(subject, "admin:read");
    return this.repository.listBackgroundJobs(subject.orgId, { limit: 500 });
  }

  async operationalSummary(
    subject: AuthSubject,
  ): Promise<JobOperationalSummary> {
    assertScope(subject, "admin:read");
    const generatedAt = new Date().toISOString();
    const [jobs, fileLifecycle] = await Promise.all([
      collectBackgroundJobs(this.repository, subject.orgId),
      this.repository.getFileLifecycleQueueSummary(subject.orgId),
    ]);
    return summarizeBackgroundJobs(jobs, {
      generatedAt,
      additionalTypeSummaries: [
        fileLifecycleTypeSummary(fileLifecycle, generatedAt),
      ],
    });
  }
}

export async function startBackgroundJob(
  repository: RomeoRepository,
  input: {
    orgId: string;
    payload: Record<string, unknown>;
    type: string;
    workspaceId?: string;
  },
): Promise<BackgroundJob> {
  const now = new Date().toISOString();
  return repository.createBackgroundJob({
    id: createId("job"),
    orgId: input.orgId,
    ...(input.workspaceId === undefined
      ? {}
      : { workspaceId: input.workspaceId }),
    type: input.type,
    status: "running",
    payload: telemetryJobPayload(input.payload),
    createdAt: now,
    updatedAt: now,
  });
}

export async function queueBackgroundJob(
  repository: RomeoRepository,
  input: {
    id?: string;
    orgId: string;
    payload: Record<string, unknown>;
    type: string;
    workspaceId?: string;
  },
): Promise<BackgroundJob> {
  const now = new Date().toISOString();
  return repository.createBackgroundJob({
    id: input.id ?? createId("job"),
    orgId: input.orgId,
    ...(input.workspaceId === undefined
      ? {}
      : { workspaceId: input.workspaceId }),
    type: input.type,
    status: "queued",
    payload: telemetryJobPayload(input.payload),
    createdAt: now,
    updatedAt: now,
  });
}

export function completeBackgroundJob(
  repository: RomeoRepository,
  job: BackgroundJob,
): Promise<BackgroundJob> {
  const now = new Date().toISOString();
  return repository.updateBackgroundJob({
    ...job,
    status: "completed",
    updatedAt: now,
    completedAt: now,
  });
}

export function failBackgroundJob(
  repository: RomeoRepository,
  job: BackgroundJob,
  errorCode: string,
): Promise<BackgroundJob> {
  const now = new Date().toISOString();
  return repository.updateBackgroundJob({
    ...job,
    status: "failed",
    payload: { ...job.payload, errorCode },
    updatedAt: now,
    completedAt: now,
  });
}

export function summarizeBackgroundJobs(
  jobs: BackgroundJob[],
  input: {
    additionalTypeSummaries?: BackgroundJobTypeSummary[];
    generatedAt?: string;
    now?: string;
    thresholds?: Partial<JobLagThresholds>;
  } = {},
): JobOperationalSummary {
  const generatedAt =
    input.generatedAt ?? input.now ?? new Date().toISOString();
  const nowMs = Date.parse(generatedAt);
  const thresholds = { ...DEFAULT_JOB_LAG_THRESHOLDS, ...input.thresholds };
  const totals = { ...emptyCounts(), deadLettered: 0, recentFailed: 0 };
  const byType = new Map<string, BackgroundJobTypeSummary>();

  for (const job of jobs) {
    incrementCounts(totals, job.status);
    const operationalType = operationalJobType(job.type);
    const summary =
      byType.get(operationalType) ?? createTypeSummary(operationalType);
    byType.set(operationalType, summary);
    incrementCounts(summary, job.status);

    if (job.status === "queued") {
      const ageSeconds = ageSecondsBetween(nowMs, job.createdAt);
      if ((summary.oldestQueuedAgeSeconds ?? -1) < ageSeconds) {
        summary.oldestQueuedAgeSeconds = ageSeconds;
        summary.oldestQueuedJobId = job.id;
      }
    }

    if (job.status === "running") {
      const ageSeconds = ageSecondsBetween(nowMs, job.updatedAt);
      if ((summary.longestRunningAgeSeconds ?? -1) < ageSeconds) {
        summary.longestRunningAgeSeconds = ageSeconds;
        summary.longestRunningJobId = job.id;
      }
    }

    if (
      job.status === "failed" &&
      ageSecondsBetween(nowMs, job.completedAt ?? job.updatedAt) <=
        thresholds.failedLookbackSeconds
    ) {
      totals.recentFailed += 1;
      summary.recentFailed += 1;
    }

    if (isDeadLettered(job)) {
      totals.deadLettered += 1;
      summary.deadLettered += 1;
    }
  }

  for (const additional of input.additionalTypeSummaries ?? []) {
    byType.set(additional.type, additional);
    totals.total += additional.total;
    totals.queued += additional.queued;
    totals.running += additional.running;
    totals.completed += additional.completed;
    totals.failed += additional.failed;
    totals.deadLettered += additional.deadLettered;
    totals.recentFailed += additional.recentFailed;
  }

  const typeSummaries = Array.from(byType.values()).sort((left, right) =>
    left.type.localeCompare(right.type),
  );
  const alerts = typeSummaries
    .flatMap((summary) => alertsForType(summary, thresholds))
    .sort(compareAlerts);
  return {
    generatedAt,
    status: alerts.some((alert) => alert.severity === "critical")
      ? "critical"
      : alerts.length > 0
        ? "degraded"
        : "healthy",
    thresholds,
    totals,
    byType: typeSummaries,
    alerts,
  };
}

function operationalJobType(type: string): string {
  // Run execution jobs include the run ID in their claim type so workers can
  // recover one run independently. That suffix is instance identity, not a
  // job class: aggregating on it would create unbounded metric cardinality and
  // expose internal IDs in operational summaries.
  return type.startsWith("run.execution:") ? "run.execution" : type;
}

function createTypeSummary(type: string): BackgroundJobTypeSummary {
  return { type, ...emptyCounts(), deadLettered: 0, recentFailed: 0 };
}

function emptyCounts(): BackgroundJobStatusCounts {
  return { total: 0, queued: 0, running: 0, completed: 0, failed: 0 };
}

function incrementCounts(
  counts: BackgroundJobStatusCounts,
  status: BackgroundJob["status"],
): void {
  counts.total += 1;
  counts[status] += 1;
}

function alertsForType(
  summary: BackgroundJobTypeSummary,
  thresholds: JobLagThresholds,
): JobOperationalAlert[] {
  const alerts: JobOperationalAlert[] = [];
  if (summary.oldestQueuedAgeSeconds !== undefined) {
    const severity = severityFor(
      summary.oldestQueuedAgeSeconds,
      thresholds.queuedWarningSeconds,
      thresholds.queuedCriticalSeconds,
    );
    if (severity !== undefined) {
      alerts.push({
        id: `job_queued_lag_${alertIdPart(summary.type)}`,
        metric: "queued_lag_seconds",
        severity,
        type: summary.type,
        value: summary.oldestQueuedAgeSeconds,
        threshold:
          severity === "critical"
            ? thresholds.queuedCriticalSeconds
            : thresholds.queuedWarningSeconds,
        ...(summary.oldestQueuedJobId === undefined
          ? {}
          : { jobId: summary.oldestQueuedJobId }),
      });
    }
  }

  if (
    summary.longestRunningAgeSeconds !== undefined &&
    summary.longestRunningJobId !== undefined
  ) {
    const severity = severityFor(
      summary.longestRunningAgeSeconds,
      thresholds.runningWarningSeconds,
      thresholds.runningCriticalSeconds,
    );
    if (severity !== undefined) {
      alerts.push({
        id: `job_running_stale_${alertIdPart(summary.type)}`,
        metric: "running_stale_seconds",
        severity,
        type: summary.type,
        value: summary.longestRunningAgeSeconds,
        threshold:
          severity === "critical"
            ? thresholds.runningCriticalSeconds
            : thresholds.runningWarningSeconds,
        jobId: summary.longestRunningJobId,
      });
    }
  }

  const failedSeverity = severityFor(
    summary.recentFailed,
    thresholds.failedWarningCount,
    thresholds.failedCriticalCount,
  );
  if (failedSeverity !== undefined) {
    alerts.push({
      id: `job_recent_failures_${alertIdPart(summary.type)}`,
      metric: "recent_failed_jobs",
      severity: failedSeverity,
      type: summary.type,
      value: summary.recentFailed,
      threshold:
        failedSeverity === "critical"
          ? thresholds.failedCriticalCount
          : thresholds.failedWarningCount,
    });
  }

  const deadLetterSeverity = severityFor(
    summary.deadLettered,
    thresholds.deadLetterWarningCount,
    thresholds.deadLetterCriticalCount,
  );
  if (deadLetterSeverity !== undefined) {
    alerts.push({
      id: `job_dead_letters_${alertIdPart(summary.type)}`,
      metric: "dead_letter_jobs",
      severity: deadLetterSeverity,
      type: summary.type,
      value: summary.deadLettered,
      threshold:
        deadLetterSeverity === "critical"
          ? thresholds.deadLetterCriticalCount
          : thresholds.deadLetterWarningCount,
    });
  }
  return alerts;
}

function fileLifecycleTypeSummary(
  summary: Awaited<ReturnType<RomeoRepository["getFileLifecycleQueueSummary"]>>,
  generatedAt: string,
): BackgroundJobTypeSummary {
  const oldestQueuedAgeSeconds =
    summary.oldestQueuedAt === undefined
      ? undefined
      : ageSecondsBetween(Date.parse(generatedAt), summary.oldestQueuedAt);
  return {
    type: "file.lifecycle",
    total: summary.queued + summary.deadLettered,
    queued: summary.queued,
    running: 0,
    completed: 0,
    failed: summary.deadLettered,
    deadLettered: summary.deadLettered,
    recentFailed: 0,
    ...(oldestQueuedAgeSeconds === undefined ? {} : { oldestQueuedAgeSeconds }),
  };
}

function isDeadLettered(job: BackgroundJob): boolean {
  const value = job.payload.deadLetter;
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function severityFor(
  value: number,
  warningThreshold: number,
  criticalThreshold: number,
): JobOperationalAlert["severity"] | undefined {
  if (value >= criticalThreshold) return "critical";
  if (value >= warningThreshold) return "warning";
  return undefined;
}

function compareAlerts(
  left: JobOperationalAlert,
  right: JobOperationalAlert,
): number {
  const severity = severityRank(right.severity) - severityRank(left.severity);
  if (severity !== 0) return severity;
  const value = right.value - left.value;
  return value !== 0 ? value : left.id.localeCompare(right.id);
}

function severityRank(severity: JobOperationalAlert["severity"]): number {
  return severity === "critical" ? 2 : 1;
}

function ageSecondsBetween(nowMs: number, iso: string): number {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor((nowMs - parsed) / 1000));
}

function alertIdPart(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  return normalized.length === 0 ? "unknown" : normalized;
}
