import { apiJson } from "./http";
import type {
  AccessReviewReport,
  ApiKeySummary,
  AuditLog,
  AuditLogFilter,
  AuditLogPage,
  BulkActionResult,
  BackgroundJob,
  CreatedApiKey,
  DataDeletionPreview,
  DataDeletionResult,
  DataExportPackage,
  DataExportPackageDeleteResult,
  DataExportPackageList,
  DataExportPreview,
  DataExportRequest,
  DataRightsCoverageReport,
  Envelope,
  IdentityLifecyclePolicy,
  QuotaBucket,
  ReadinessReport,
  RetentionEnforcementResult,
  SecretRewrapExecuteInput,
  SecretRewrapPreviewInput,
  SecretRewrapReport,
  ResourceGrant,
  RetentionPolicy,
  ServiceAccount,
  SsoConnectionTestReport,
  SsoSettingsReport,
  UpdateSsoSettingsInput,
  UsageAlert,
  UsageEvent,
  UsageSummary,
} from "./types";

export async function listApiKeys(): Promise<ApiKeySummary[]> {
  const response = await apiJson<Envelope<ApiKeySummary[]>>("/api/v1/api-keys");
  return response.data;
}

export async function createApiKey(input: { name: string; scopes: string[] }) {
  const response = await apiJson<Envelope<CreatedApiKey>>("/api/v1/api-keys", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return response.data;
}

export async function listServiceAccounts(): Promise<ServiceAccount[]> {
  const response = await apiJson<Envelope<ServiceAccount[]>>(
    "/api/v1/service-accounts",
  );
  return response.data;
}

export async function createServiceAccount(input: {
  name: string;
  scopes: string[];
}): Promise<ServiceAccount> {
  const response = await apiJson<Envelope<ServiceAccount>>(
    "/api/v1/service-accounts",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return response.data;
}

export async function createServiceAccountApiKey(input: {
  serviceAccountId: string;
  name: string;
  scopes: string[];
}): Promise<CreatedApiKey> {
  const response = await apiJson<Envelope<CreatedApiKey>>(
    `/api/v1/service-accounts/${encodeURIComponent(input.serviceAccountId)}/api-keys`,
    {
      method: "POST",
      body: JSON.stringify({ name: input.name, scopes: input.scopes }),
    },
  );
  return response.data;
}

export async function disableServiceAccount(
  serviceAccountId: string,
): Promise<ServiceAccount> {
  const response = await apiJson<Envelope<ServiceAccount>>(
    `/api/v1/service-accounts/${encodeURIComponent(serviceAccountId)}/disable`,
    {
      method: "POST",
    },
  );
  return response.data;
}

export async function revokeApiKey(apiKeyId: string): Promise<ApiKeySummary> {
  const response = await apiJson<Envelope<ApiKeySummary>>(
    `/api/v1/api-keys/${encodeURIComponent(apiKeyId)}/revoke`,
    {
      method: "POST",
    },
  );
  return response.data;
}

export async function bulkRevokeApiKeys(
  apiKeyIds: string[],
): Promise<BulkActionResult> {
  const response = await apiJson<Envelope<BulkActionResult>>(
    "/api/v1/api-keys/bulk-revoke",
    {
      method: "POST",
      body: JSON.stringify({ apiKeyIds }),
    },
  );
  return response.data;
}

export async function bulkDisableServiceAccounts(
  serviceAccountIds: string[],
): Promise<BulkActionResult> {
  const response = await apiJson<Envelope<BulkActionResult>>(
    "/api/v1/service-accounts/bulk-disable",
    {
      method: "POST",
      body: JSON.stringify({ serviceAccountIds }),
    },
  );
  return response.data;
}

export async function listAuditLogs(
  filter: AuditLogFilter = {},
  options: { limit?: number; cursor?: string } = {},
): Promise<AuditLogPage> {
  const response = await apiJson<
    Envelope<AuditLog[]> & { nextCursor?: string }
  >(`/api/v1/audit-logs${auditLogsQuery(filter, options)}`);
  return response.nextCursor !== undefined
    ? { data: response.data, nextCursor: response.nextCursor }
    : { data: response.data };
}

export async function exportAuditLogsCsv(
  filter: AuditLogFilter = {},
): Promise<string> {
  const response = await fetch(
    `/api/v1/audit-logs.csv${auditFilterQuery(filter)}`,
    { headers: { accept: "text/csv" } },
  );
  if (!response.ok)
    throw new Error(`Romeo audit export failed with ${response.status}.`);
  return response.text();
}

export async function exportComplianceReportCsv(): Promise<string> {
  const response = await fetch("/api/v1/governance/compliance-report.csv", {
    headers: { accept: "text/csv" },
  });
  if (!response.ok)
    throw new Error(
      `Romeo compliance report export failed with ${response.status}.`,
    );
  return response.text();
}

export async function exportAccessReviewCsv(): Promise<string> {
  const response = await fetch("/api/v1/access-review.csv", {
    headers: { accept: "text/csv" },
  });
  if (!response.ok)
    throw new Error(
      `Romeo access review export failed with ${response.status}.`,
    );
  return response.text();
}

export async function getRetentionPolicy(): Promise<RetentionPolicy> {
  const response = await apiJson<Envelope<RetentionPolicy>>(
    "/api/v1/governance/retention",
  );
  return response.data;
}

export async function updateRetentionPolicy(input: {
  auditLogRetentionDays: number;
}): Promise<RetentionPolicy> {
  const response = await apiJson<Envelope<RetentionPolicy>>(
    "/api/v1/governance/retention",
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
  return response.data;
}

export async function previewDataDeletion(input: {
  resourceType: "chat";
  resourceId: string;
}): Promise<DataDeletionPreview> {
  const response = await apiJson<Envelope<DataDeletionPreview>>(
    "/api/v1/governance/data-deletions/preview",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return response.data;
}

export async function executeDataDeletion(input: {
  resourceType: "chat";
  resourceId: string;
  confirmResourceId: string;
}): Promise<DataDeletionResult> {
  const response = await apiJson<Envelope<DataDeletionResult>>(
    "/api/v1/governance/data-deletions/execute",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return response.data;
}

export async function listAccessReviewGrants(): Promise<ResourceGrant[]> {
  const response = await apiJson<Envelope<ResourceGrant[]>>(
    "/api/v1/access-review",
  );
  return response.data;
}

export async function getIdentityLifecyclePolicy(): Promise<IdentityLifecyclePolicy> {
  const response = await apiJson<Envelope<IdentityLifecyclePolicy>>(
    "/api/v1/governance/identity-lifecycle-policy",
  );
  return response.data;
}

export async function listJobs(): Promise<BackgroundJob[]> {
  const response = await apiJson<Envelope<BackgroundJob[]>>("/api/v1/jobs");
  return response.data;
}

export async function getReadinessReport(): Promise<ReadinessReport> {
  const response = await apiJson<Envelope<ReadinessReport>>(
    "/api/v1/admin/readiness",
  );
  return response.data;
}

export async function previewSecretRewrap(
  input: SecretRewrapPreviewInput = {},
): Promise<SecretRewrapReport> {
  const response = await apiJson<Envelope<SecretRewrapReport>>(
    "/api/v1/admin/secret-rotation/rewrap/preview",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return response.data;
}

export async function executeSecretRewrap(
  input: SecretRewrapExecuteInput,
): Promise<SecretRewrapReport> {
  const response = await apiJson<Envelope<SecretRewrapReport>>(
    "/api/v1/admin/secret-rotation/rewrap",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return response.data;
}

export async function getSsoSettings(): Promise<SsoSettingsReport> {
  const response = await apiJson<Envelope<SsoSettingsReport>>(
    "/api/v1/admin/sso-settings",
  );
  return response.data;
}

export async function updateSsoSettings(
  input: UpdateSsoSettingsInput,
): Promise<SsoSettingsReport> {
  const response = await apiJson<Envelope<SsoSettingsReport>>(
    "/api/v1/admin/sso-settings",
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
  return response.data;
}

export async function testSsoSettings(): Promise<SsoConnectionTestReport> {
  const response = await apiJson<Envelope<SsoConnectionTestReport>>(
    "/api/v1/admin/sso-settings/test",
    { method: "POST" },
  );
  return response.data;
}

export async function listUsageEvents(): Promise<UsageEvent[]> {
  const response = await apiJson<Envelope<UsageEvent[]>>(
    "/api/v1/usage/events",
  );
  return response.data;
}

export async function getUsageSummary(): Promise<UsageSummary> {
  const response = await apiJson<Envelope<UsageSummary>>(
    "/api/v1/usage/summary",
  );
  return response.data;
}

export async function listUsageAlerts(): Promise<UsageAlert[]> {
  const response = await apiJson<Envelope<UsageAlert[]>>(
    "/api/v1/usage/alerts",
  );
  return response.data;
}

export async function exportUsageEventsCsv(): Promise<string> {
  const response = await fetch("/api/v1/usage/events.csv", {
    headers: { accept: "text/csv" },
  });
  if (!response.ok)
    throw new Error(`Romeo usage export failed with ${response.status}.`);
  return response.text();
}

export async function listQuotas(): Promise<QuotaBucket[]> {
  const response = await apiJson<Envelope<QuotaBucket[]>>("/api/v1/quotas");
  return response.data;
}

export async function createQuotaBucket(
  input: Pick<
    QuotaBucket,
    "scopeType" | "metric" | "limit" | "resetInterval"
  > & { scopeId?: string },
): Promise<QuotaBucket> {
  const response = await apiJson<Envelope<QuotaBucket>>("/api/v1/quotas", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return response.data;
}

export async function updateQuotaBucket(
  quotaBucketId: string,
  input: {
    limit?: number;
    resetInterval?: QuotaBucket["resetInterval"];
    resetUsage?: boolean;
  },
): Promise<QuotaBucket> {
  const response = await apiJson<Envelope<QuotaBucket>>(
    `/api/v1/quotas/${encodeURIComponent(quotaBucketId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
  return response.data;
}

export async function deleteQuotaBucket(
  quotaBucketId: string,
): Promise<QuotaBucket> {
  const response = await apiJson<Envelope<QuotaBucket>>(
    `/api/v1/quotas/${encodeURIComponent(quotaBucketId)}`,
    {
      method: "DELETE",
    },
  );
  return response.data;
}

export async function enforceRetention(): Promise<RetentionEnforcementResult> {
  const response = await apiJson<Envelope<RetentionEnforcementResult>>(
    "/api/v1/governance/retention/enforce",
    {
      method: "POST",
    },
  );
  return response.data;
}

export async function getDataRightsCoverage(): Promise<DataRightsCoverageReport> {
  const response = await apiJson<Envelope<DataRightsCoverageReport>>(
    "/api/v1/governance/data-rights/coverage",
  );
  return response.data;
}

export async function previewDataExport(
  input: DataExportRequest,
): Promise<DataExportPreview> {
  const response = await apiJson<Envelope<DataExportPreview>>(
    "/api/v1/governance/data-exports/preview",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return response.data;
}

export async function executeDataExport(
  input: DataExportRequest,
): Promise<DataExportPackage> {
  const response = await apiJson<Envelope<DataExportPackage>>(
    "/api/v1/governance/data-exports/execute",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return response.data;
}

export async function listDataExportPackages(): Promise<DataExportPackageList> {
  const response = await apiJson<Envelope<DataExportPackageList>>(
    "/api/v1/governance/data-exports/packages",
  );
  return response.data;
}

export async function createDataExportPackage(
  input: DataExportRequest,
): Promise<DataExportPackage> {
  const response = await apiJson<Envelope<DataExportPackage>>(
    "/api/v1/governance/data-exports/packages",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return response.data;
}

export async function deleteDataExportPackage(input: {
  packageId: string;
  confirmPackageId: string;
}): Promise<DataExportPackageDeleteResult> {
  const response = await apiJson<Envelope<DataExportPackageDeleteResult>>(
    `/api/v1/governance/data-exports/packages/${encodeURIComponent(input.packageId)}`,
    {
      method: "DELETE",
      body: JSON.stringify({ confirmPackageId: input.confirmPackageId }),
    },
  );
  return response.data;
}

export async function downloadDataExportPackageContent(
  packageId: string,
): Promise<string> {
  const response = await fetch(
    `/api/v1/governance/data-exports/packages/${encodeURIComponent(packageId)}/content`,
    { headers: { accept: "application/json" } },
  );
  if (!response.ok)
    throw new Error(
      `Romeo data export package download failed with ${response.status}.`,
    );
  return response.text();
}

export async function getAccessReviewReport(): Promise<AccessReviewReport> {
  const response = await apiJson<Envelope<AccessReviewReport>>(
    "/api/v1/access-review/report",
  );
  return response.data;
}

export async function exportAccessReviewReportCsv(): Promise<string> {
  const response = await fetch("/api/v1/access-review/report.csv", {
    headers: { accept: "text/csv" },
  });
  if (!response.ok)
    throw new Error(
      `Romeo access review report export failed with ${response.status}.`,
    );
  return response.text();
}

function auditFilterQuery(filter: AuditLogFilter): string {
  const params = new URLSearchParams();
  if (filter.action !== undefined) params.set("action", filter.action);
  if (filter.outcome !== undefined) params.set("outcome", filter.outcome);
  if (filter.resourceType !== undefined)
    params.set("resourceType", filter.resourceType);
  const query = params.toString();
  return query.length > 0 ? `?${query}` : "";
}

function auditLogsQuery(
  filter: AuditLogFilter,
  options: { limit?: number; cursor?: string },
): string {
  const params = new URLSearchParams();
  if (filter.action !== undefined) params.set("action", filter.action);
  if (filter.outcome !== undefined) params.set("outcome", filter.outcome);
  if (filter.resourceType !== undefined)
    params.set("resourceType", filter.resourceType);
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.cursor !== undefined && options.cursor.length > 0)
    params.set("cursor", options.cursor);
  const query = params.toString();
  return query.length > 0 ? `?${query}` : "";
}
