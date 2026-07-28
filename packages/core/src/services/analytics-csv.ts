import type { AdminAnalyticsSummary } from "./analytics-service";

export function formatAdminAnalyticsSummaryCsv(
  summary: AdminAnalyticsSummary,
): string {
  const rows: string[][] = [
    ["category", "dimension", "id", "metric", "value"],
    ["overall", "org", summary.orgId, "status", summary.status],
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
    [
      "tool",
      "org",
      summary.orgId,
      "failure_count",
      String(summary.tools.failureCount),
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
