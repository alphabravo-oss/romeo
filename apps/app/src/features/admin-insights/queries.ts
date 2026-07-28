import {
  adminInsightsExportAnalyticsSummary,
  adminInsightsGetAbuseControls,
  adminInsightsGetAnalyticsSummary,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export async function getAdminAnalyticsSummary() {
  configureBrowserApiClients();
  const response = await adminInsightsGetAnalyticsSummary({
    throwOnError: true,
  });
  return response.data.data;
}

export async function exportAdminAnalyticsSummaryCsv() {
  configureBrowserApiClients();
  const response = await adminInsightsExportAnalyticsSummary({
    headers: { accept: "text/csv" },
    parseAs: "text",
    throwOnError: true,
  });
  return response.data;
}

export async function getAbuseControls() {
  configureBrowserApiClients();
  const response = await adminInsightsGetAbuseControls({ throwOnError: true });
  return response.data.data;
}
