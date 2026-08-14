import type { AdminAnalyticsSummary } from "./analytics-service";

export function formatAdminAnalyticsSummaryCsv(
  summary: AdminAnalyticsSummary,
): string {
  const rows: string[][] = [
    ["category", "dimension", "id", "metric", "value"],
    ["overall", "org", summary.orgId, "status", summary.status],
    [
      "adoption",
      "org",
      summary.orgId,
      "active_users",
      String(summary.adoption.activeUserCount),
    ],
    [
      "adoption",
      "org",
      summary.orgId,
      "engaged_users",
      String(summary.adoption.engagedUserCount),
    ],
    [
      "adoption",
      "org",
      summary.orgId,
      "feedback_positive_rate",
      summary.adoption.feedback.positiveRate === null
        ? ""
        : String(summary.adoption.feedback.positiveRate),
    ],
    ["window", "org", summary.orgId, "from", summary.window.from ?? ""],
    ["window", "org", summary.orgId, "to", summary.window.to],
    ["eval", "org", summary.orgId, "status", summary.evals.status],
    [
      "eval",
      "org",
      summary.orgId,
      "suite_count",
      String(summary.evals.suiteCount),
    ],
    [
      "eval",
      "org",
      summary.orgId,
      "run_count",
      String(summary.evals.generatedRunCount),
    ],
    [
      "usage",
      "org",
      summary.orgId,
      "estimated_cost_usd",
      String(summary.usage.estimatedCostUsd),
    ],
    [
      "usage",
      "org",
      summary.orgId,
      "runs_started",
      String(summary.usage.runsStarted),
    ],
    [
      "usage",
      "org",
      summary.orgId,
      "runs_completed",
      String(summary.usage.runsCompleted),
    ],
    [
      "usage",
      "org",
      summary.orgId,
      "runs_failed",
      String(summary.usage.runsFailed),
    ],
    [
      "usage",
      "org",
      summary.orgId,
      "total_tokens",
      String(summary.usage.totalTokens),
    ],
    [
      "usage",
      "org",
      summary.orgId,
      "activity_event_count",
      String(summary.usage.activityEventCount),
    ],
    [
      "usage",
      "org",
      summary.orgId,
      "unpriced_token_quantity",
      String(summary.usage.unpricedTokenQuantity),
    ],
    [
      "provider",
      "org",
      summary.orgId,
      "critical_alert_count",
      String(summary.providers.criticalAlertCount),
    ],
    [
      "job",
      "org",
      summary.orgId,
      "critical_alert_count",
      String(summary.jobs.criticalAlertCount),
    ],
    ["job", "org", summary.orgId, "failed", String(summary.jobs.failed)],
    [
      "tool",
      "org",
      summary.orgId,
      "failure_count",
      String(summary.tools.failureCount),
    ],
    [
      "attention",
      "org",
      summary.orgId,
      "model_count",
      String(summary.attention.models.length),
    ],
  ];

  for (const suite of summary.evals.suites) {
    rows.push([
      "eval",
      "suite",
      suite.suiteId,
      "latest_status",
      suite.latestStatus,
    ]);
    if (suite.latestScore !== undefined) {
      rows.push([
        "eval",
        "suite",
        suite.suiteId,
        "latest_score",
        String(suite.latestScore),
      ]);
    }
  }
  for (const metric of summary.usage.totals) {
    rows.push([
      "usage",
      "metric",
      `${metric.metric}:${metric.unit}`,
      "quantity",
      String(metric.quantity),
    ]);
  }
  for (const model of summary.attention.models) {
    rows.push([
      "attention",
      "model",
      model.modelId,
      "display_name",
      model.displayName,
    ]);
    rows.push([
      "attention",
      "model",
      model.modelId,
      "issues",
      model.issues.join("|"),
    ]);
  }
  for (const tool of summary.tools.byTool) {
    rows.push([
      "tool",
      "tool",
      tool.toolId,
      "total_count",
      String(tool.totalCount),
    ]);
    rows.push([
      "tool",
      "tool",
      tool.toolId,
      "failure_count",
      String(tool.failureCount),
    ]);
  }

  return `${rows.map(formatCsvRow).join("\n")}\n`;
}

function formatCsvRow(row: string[]): string {
  return row.map(csvCell).join(",");
}

function csvCell(value: string): string {
  return /[",\n\r]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
