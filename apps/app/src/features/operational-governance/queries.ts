import {
  operationalGovernanceExportAuditLogs,
  operationalGovernanceExportUsageEvents,
  operationalGovernanceGetQuotaCoordinationStatus,
  operationalGovernanceGetUsageSummary,
  operationalGovernanceListAuditLogs,
  operationalGovernanceQueryAuditLogs,
  operationalGovernanceListQuotaBuckets,
  operationalGovernanceListUsageAlerts,
  operationalGovernanceListUsageEvents,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";
import type { UsageInterval } from "@romeo/contracts";

import type { AuditLogFilter, AuditLogTableRequest } from "./types";

export async function listAuditLogs(
  filter: AuditLogFilter = {},
  options: { limit?: number; cursor?: string } = {},
) {
  configureBrowserApiClients();
  const query = compactAuditQuery({
    ...filter,
    ...(options.limit === undefined ? {} : { limit: options.limit }),
    ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
  });
  const response = await operationalGovernanceListAuditLogs({
    query,
    throwOnError: true,
  });
  return response.data;
}

export async function exportAuditLogsCsv(filter: AuditLogFilter = {}) {
  configureBrowserApiClients();
  const {
    limit: _limit,
    cursor: _cursor,
    ...query
  } = compactAuditQuery(filter);
  const response = await operationalGovernanceExportAuditLogs({
    headers: { accept: "text/csv" },
    query,
    parseAs: "text",
    throwOnError: true,
  });
  return response.data;
}

export async function queryAuditLogs(
  body: AuditLogTableRequest,
  signal?: AbortSignal,
) {
  configureBrowserApiClients();
  const response = await operationalGovernanceQueryAuditLogs({
    body,
    ...(signal === undefined ? {} : { signal }),
    throwOnError: true,
  });
  return response.data.data;
}

function compactAuditQuery(filter: AuditLogFilter): AuditLogFilter {
  return Object.fromEntries(
    Object.entries(filter).filter(([, value]) => value !== undefined),
  ) as AuditLogFilter;
}

export async function listUsageEvents(interval: UsageInterval = {}) {
  configureBrowserApiClients();
  const response = await operationalGovernanceListUsageEvents({
    query: compactUsageInterval(interval),
    throwOnError: true,
  });
  return response.data.data;
}

export async function exportUsageEventsCsv(interval: UsageInterval = {}) {
  configureBrowserApiClients();
  const response = await operationalGovernanceExportUsageEvents({
    headers: { accept: "text/csv" },
    parseAs: "text",
    query: compactUsageInterval(interval),
    throwOnError: true,
  });
  return response.data;
}

export async function getUsageSummary(interval: UsageInterval = {}) {
  configureBrowserApiClients();
  const response = await operationalGovernanceGetUsageSummary({
    query: compactUsageInterval(interval),
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

function compactUsageInterval(interval: UsageInterval): {
  from?: string;
  to?: string;
} {
  return {
    ...(interval.from === undefined ? {} : { from: interval.from }),
    ...(interval.to === undefined ? {} : { to: interval.to }),
  };
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
