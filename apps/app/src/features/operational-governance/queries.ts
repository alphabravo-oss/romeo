import {
  operationalGovernanceExportAuditLogs,
  operationalGovernanceExportUsageEvents,
  operationalGovernanceGetQuotaCoordinationStatus,
  operationalGovernanceGetUsageSummary,
  operationalGovernanceListAuditLogs,
  operationalGovernanceListQuotaBuckets,
  operationalGovernanceListUsageAlerts,
  operationalGovernanceListUsageEvents,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

import type { AuditLogFilter } from "./types";

export async function listAuditLogs(
  filter: AuditLogFilter = {},
  options: { limit?: number; cursor?: string } = {},
) {
  configureBrowserApiClients();
  const query = {
    ...filter,
    ...(options.limit === undefined ? {} : { limit: options.limit }),
    ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
  };
  const response = await operationalGovernanceListAuditLogs({
    query,
    throwOnError: true,
  });
  return response.data;
}

export async function exportAuditLogsCsv(filter: AuditLogFilter = {}) {
  configureBrowserApiClients();
  const { limit: _limit, cursor: _cursor, ...query } = filter;
  const response = await operationalGovernanceExportAuditLogs({
    headers: { accept: "text/csv" },
    query,
    parseAs: "text",
    throwOnError: true,
  });
  return response.data;
}

export async function listUsageEvents() {
  configureBrowserApiClients();
  const response = await operationalGovernanceListUsageEvents({
    throwOnError: true,
  });
  return response.data.data;
}

export async function exportUsageEventsCsv() {
  configureBrowserApiClients();
  const response = await operationalGovernanceExportUsageEvents({
    headers: { accept: "text/csv" },
    parseAs: "text",
    throwOnError: true,
  });
  return response.data;
}

export async function getUsageSummary() {
  configureBrowserApiClients();
  const response = await operationalGovernanceGetUsageSummary({
    throwOnError: true,
  });
  return response.data.data;
}

export async function listUsageAlerts() {
  configureBrowserApiClients();
  const response = await operationalGovernanceListUsageAlerts({
    throwOnError: true,
  });
  return response.data.data;
}

export async function listQuotas() {
  configureBrowserApiClients();
  const response = await operationalGovernanceListQuotaBuckets({
    throwOnError: true,
  });
  return response.data.data;
}

export async function getQuotasDistributedStatus() {
  configureBrowserApiClients();
  const response = await operationalGovernanceGetQuotaCoordinationStatus({
    throwOnError: true,
  });
  return response.data.data;
}
