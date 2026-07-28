import type {
  AdminAnalyticsEvalSummary,
  AdminAnalyticsJobSummary,
  AdminAnalyticsProviderSummary,
  AdminAnalyticsStatus,
} from "./analytics-service";
import type { JobOperationalSummary } from "./job-service";

export function summarizeJobs(
  summary: JobOperationalSummary,
): AdminAnalyticsJobSummary {
  return {
    alertCount: summary.alerts.length,
    completed: summary.totals.completed,
    criticalAlertCount: summary.alerts.filter(
      (alert) => alert.severity === "critical",
    ).length,
    deadLettered: summary.totals.deadLettered,
    failed: summary.totals.failed,
    queued: summary.totals.queued,
    running: summary.totals.running,
    status: summary.status,
    total: summary.totals.total,
  };
}

export function overallStatus(
  evals: AdminAnalyticsEvalSummary,
  providers: AdminAnalyticsProviderSummary,
  jobs: AdminAnalyticsJobSummary,
): Exclude<AdminAnalyticsStatus, "not_required"> {
  if (
    providers.status === "critical" ||
    jobs.status === "critical" ||
    evals.status === "failed"
  ) {
    return "critical";
  }
  if (
    providers.status === "degraded" ||
    jobs.status === "degraded" ||
    evals.status === "missing"
  ) {
    return "degraded";
  }
  return "healthy";
}
