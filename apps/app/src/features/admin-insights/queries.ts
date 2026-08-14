import {
  adminInsightsExportAnalyticsSummary,
  adminInsightsGetAbuseControls,
  adminInsightsGetAnalyticsSummary,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export async function getAdminAnalyticsSummary(
  input: {
    from?: string;
    to?: string;
  } = {},
) {
  configureBrowserApiClients();
  const response = await adminInsightsGetAnalyticsSummary({
    query: analyticsWindowQuery(input),
    throwOnError: true,
  });
  return response.data.data;
}

export async function exportAdminAnalyticsSummaryCsv(
  input: { from?: string; to?: string } = {},
) {
  configureBrowserApiClients();
  const response = await adminInsightsExportAnalyticsSummary({
    headers: { accept: "text/csv" },
    parseAs: "text",
    query: analyticsWindowQuery(input),
    throwOnError: true,
  });
  return response.data;
}

function analyticsWindowQuery(input: { from?: string; to?: string }): {
  from?: string;
  to?: string;
} {
  const query: { from?: string; to?: string } = {};
  if (input.from !== undefined) query.from = input.from;
  if (input.to !== undefined) query.to = input.to;
  return query;
}

export async function getAbuseControls() {
  configureBrowserApiClients();
  const response = await adminInsightsGetAbuseControls({ throwOnError: true });
  return response.data.data;
}
