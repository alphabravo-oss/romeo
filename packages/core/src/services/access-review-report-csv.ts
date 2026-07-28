import type { AccessReviewReport } from "../domain/entities";

export function accessReviewReportCsv(report: AccessReviewReport): string {
  const rows = [
    [
      "category",
      "id",
      "type",
      "status",
      "owner_or_principal",
      "scope",
      "detail",
    ],
    ...report.users.map((user) => [
      "user",
      user.id,
      user.source,
      user.disabledAt === undefined ? "active" : "disabled",
      "",
      user.groupIds.join(";"),
      `activeApiKeys=${user.activeApiKeyCount};activeSessions=${user.activeSessionCount}`,
    ]),
    ...report.groups.map((group) => [
      "group",
      group.id,
      "group",
      "active",
      "",
      "",
      `memberCount=${group.memberCount}`,
    ]),
    ...report.serviceAccounts.map((account) => [
      "service_account",
      account.id,
      "service_account",
      account.disabledAt === undefined ? "active" : "disabled",
      account.createdBy,
      account.scopes.join(";"),
      `activeApiKeys=${account.activeApiKeyCount}`,
    ]),
    ...report.resourceGrants.map((grant) => [
      "resource_grant",
      grant.id,
      grant.resourceType,
      "active",
      `${grant.principalType}:${grant.principalId}`,
      grant.permission,
      `resourceId=${grant.resourceId}`,
    ]),
    ...report.connectorOwnership.dataConnectors.map((connector) => [
      "data_connector",
      connector.id,
      connector.type,
      connector.status,
      connector.createdBy,
      connector.workspaceId,
      `configKeys=${connector.configKeys.join(";")}`,
    ]),
    ...report.connectorOwnership.delegatedOAuthConnections.map((connection) => [
      "delegated_oauth_connection",
      connection.id,
      connection.providerId,
      connection.status,
      connection.userId,
      connection.workspaceId,
      `connectorType=${connection.connectorType};scopeCount=${connection.scopeCount}`,
    ]),
    ...report.toolRisk.connectors.map((connector) => [
      "tool_connector",
      connector.id,
      connector.type,
      connector.enabled ? "enabled" : "disabled",
      "",
      connector.visibility,
      `riskLevel=${connector.riskLevel};approvalPolicy=${connector.approvalPolicy};operations=${connector.operationCount};highRiskOperations=${connector.highRiskOperationCount};approvalRequiredOperations=${connector.approvalRequiredOperationCount};allowedHostCount=${connector.allowedHostCount};allowPrivateNetwork=${connector.allowPrivateNetwork}`,
    ]),
    ...report.toolRisk.workerJobs.map((job) => [
      "worker_job",
      job.type,
      job.type,
      job.status,
      "",
      "",
      `count=${job.count}${job.oldestCreatedAt === undefined ? "" : `;oldestCreatedAt=${job.oldestCreatedAt}`}`,
    ]),
    ...report.supportAccess.requests.map((request) => [
      "support_request",
      request.id,
      "support_impersonation_request",
      request.status,
      request.requestedByUserId,
      request.targetUserId,
      `ttlMinutes=${request.ttlMinutes}${request.ticketRef === undefined ? "" : `;ticketRef=${request.ticketRef}`}`,
    ]),
    ...report.supportAccess.sessions.map((session) => [
      "support_session",
      session.sessionId,
      "support_impersonation_session",
      session.status,
      session.adminUserId,
      session.targetUserId,
      `expiresAt=${session.expiresAt}${session.approvalRequestId === undefined ? "" : `;approvalRequestId=${session.approvalRequestId}`}`,
    ]),
  ];
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function csvCell(value: string | number | boolean): string {
  const stringValue = String(value);
  if (!/[",\n\r]/.test(stringValue)) return stringValue;
  return `"${stringValue.replace(/"/g, '""')}"`;
}
