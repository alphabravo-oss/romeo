import { apiJson } from "./http";
import type { Envelope } from "./types";
import type { AdminAnalyticsSummary } from "./analytics-types";

export async function getAdminAnalyticsSummary(): Promise<AdminAnalyticsSummary> {
  const response = await apiJson<Envelope<AdminAnalyticsSummary>>(
    "/api/v1/admin/analytics/summary",
  );
  return response.data;
}

export async function exportAdminAnalyticsSummaryCsv(): Promise<string> {
  const response = await fetch("/api/v1/admin/analytics/summary.csv", {
    headers: { accept: "text/csv" },
  });
  if (!response.ok)
    throw new Error(
      `Romeo admin analytics export failed with ${response.status}.`,
    );
  return response.text();
}
