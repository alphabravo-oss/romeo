import type {
  OperationalGovernanceListAuditLogsData,
  OperationalGovernanceQueryAuditLogsData,
} from "@romeo/api-client/generated/sdk";

export type {
  AuditLog,
  AuditLogPage,
  AuditLogTablePage,
  AuditLogTableQuery,
  CreateQuotaBucketRequest,
  QuotaBucket,
  QuotaCoordinationStatus,
  UpdateQuotaBucketRequest,
  UsageAlert,
  UsageEvent,
  UsageSummary,
  UsageSummaryMetric,
} from "@romeo/api-client/generated/sdk";

export type AuditLogFilter = NonNullable<
  OperationalGovernanceListAuditLogsData["query"]
>;

export type AuditLogTableRequest =
  OperationalGovernanceQueryAuditLogsData["body"];
