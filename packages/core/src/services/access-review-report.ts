import type { ResourceGrant } from "@romeo/auth";
import { createHash } from "node:crypto";

import type {
  AccessReviewReport,
  AccessReviewSupportRequestPosture,
  AccessReviewSupportSessionPosture,
  AccessReviewWorkerJobPosture,
  AuditLog,
  BackgroundJob,
  UserSession,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { accessReviewPolicyPosture } from "./identity-lifecycle-policy";

const approvalRequiredPolicies = new Set([
  "admin_only",
  "always",
  "external_side_effects",
  "write_operations",
]);
const highRiskLevels = new Set(["critical", "high"]);

export async function buildAccessReviewReport(
  repository: RomeoRepository,
  orgId: string,
  options: { scimEnabled?: boolean | undefined } = {},
): Promise<AccessReviewReport> {
  const [
    users,
    groups,
    groupMemberships,
    serviceAccounts,
    apiKeys,
    grants,
    dataConnectors,
    delegatedOAuthConnections,
    toolConnectors,
    backgroundJobs,
    auditLogs,
  ] = await Promise.all([
    repository.listUsers(orgId),
    repository.listGroups(orgId),
    repository.listGroupMemberships(orgId),
    repository.listServiceAccounts(orgId),
    repository.listApiKeys(orgId),
    repository.listResourceGrants(orgId),
    repository.listDataConnectors(orgId),
    repository.listDelegatedOAuthConnections(orgId),
    repository.listToolConnectors(orgId),
    repository.listBackgroundJobs(orgId),
    repository.listAuditLogs(orgId),
  ]);
  const sessionsByUser = new Map(
    await Promise.all(
      users.map(
        async (user) =>
          [user.id, await repository.listUserSessions(orgId, user.id)] as const,
      ),
    ),
  );
  const operationsByConnector = new Map(
    await Promise.all(
      toolConnectors.map(
        async (connector) =>
          [
            connector.id,
            await repository.listToolOperations(connector.id),
          ] as const,
      ),
    ),
  );
  const supportAccess = supportAccessPosture(auditLogs, sessionsByUser);
  const activeUserApiKeys = apiKeys.filter(
    (key) => key.userId !== undefined && key.revokedAt === undefined,
  );
  const activeServiceAccountApiKeys = apiKeys.filter(
    (key) => key.serviceAccountId !== undefined && key.revokedAt === undefined,
  );
  const activeUserSessionCount = Array.from(sessionsByUser.values())
    .flat()
    .filter(isActiveSession).length;
  const toolConnectorReports = toolConnectors
    .map((connector) => {
      const operations = operationsByConnector.get(connector.id) ?? [];
      return {
        id: connector.id,
        type: connector.type,
        name: connector.name,
        enabled: connector.enabled,
        riskLevel: connector.riskLevel,
        approvalPolicy: connector.approvalPolicy,
        visibility: connector.visibility,
        allowedHostCount: connector.networkPolicy.allowedHosts.length,
        allowPrivateNetwork: connector.networkPolicy.allowPrivateNetwork,
        operationCount: operations.length,
        enabledOperationCount: operations.filter(
          (operation) => operation.enabled,
        ).length,
        highRiskOperationCount: operations.filter((operation) =>
          highRiskLevels.has(operation.riskLevel),
        ).length,
        approvalRequiredOperationCount: operations.filter((operation) =>
          approvalRequiredPolicies.has(operation.approvalPolicy),
        ).length,
        createdAt: connector.createdAt,
        updatedAt: connector.updatedAt,
      };
    })
    .sort(byId);
  const workerJobs = workerJobPosture(backgroundJobs);

  return {
    schema: "romeo.access-review-report.v1",
    orgId,
    generatedAt: new Date().toISOString(),
    policy: accessReviewPolicyPosture(options),
    summary: {
      userCount: users.length,
      disabledUserCount: users.filter((user) => user.disabledAt !== undefined)
        .length,
      groupCount: groups.length,
      groupMembershipCount: groupMemberships.length,
      serviceAccountCount: serviceAccounts.length,
      disabledServiceAccountCount: serviceAccounts.filter(
        (account) => account.disabledAt !== undefined,
      ).length,
      activeUserApiKeyCount: activeUserApiKeys.length,
      activeServiceAccountApiKeyCount: activeServiceAccountApiKeys.length,
      activeUserSessionCount,
      resourceGrantCount: grants.length,
      dataConnectorCount: dataConnectors.length,
      delegatedOAuthConnectionCount: delegatedOAuthConnections.length,
      toolConnectorCount: toolConnectors.length,
      riskyToolConnectorCount: toolConnectorReports.filter(
        (connector) =>
          connector.enabled &&
          (highRiskLevels.has(connector.riskLevel) ||
            connector.allowPrivateNetwork ||
            connector.approvalRequiredOperationCount > 0),
      ).length,
      pendingSupportRequestCount: supportAccess.requests.filter(
        (request) => request.status === "pending",
      ).length,
      activeSupportSessionCount: supportAccess.sessions.filter(
        (session) => session.status === "active",
      ).length,
      runningWorkerJobCount: workerJobs
        .filter((job) => job.status === "running")
        .reduce((sum, job) => sum + job.count, 0),
      queuedWorkerJobCount: workerJobs
        .filter((job) => job.status === "queued")
        .reduce((sum, job) => sum + job.count, 0),
    },
    users: users
      .map((user) => {
        const sessions = sessionsByUser.get(user.id) ?? [];
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          ...(user.disabledAt === undefined
            ? {}
            : { disabledAt: user.disabledAt }),
          source: user.id.startsWith("user_oidc_")
            ? ("oidc_derived" as const)
            : ("local" as const),
          groupIds: groupMemberships
            .filter((membership) => membership.userId === user.id)
            .map((membership) => membership.groupId)
            .sort(),
          activeApiKeyCount: activeUserApiKeys.filter(
            (key) => key.userId === user.id,
          ).length,
          activeSessionCount: sessions.filter(isActiveSession).length,
        };
      })
      .sort(byId),
    groups: groups
      .map((group) => ({
        id: group.id,
        name: group.name,
        slug: group.slug,
        memberCount: groupMemberships.filter(
          (membership) => membership.groupId === group.id,
        ).length,
        createdAt: group.createdAt,
      }))
      .sort(byId),
    serviceAccounts: serviceAccounts
      .map((account) => ({
        id: account.id,
        name: account.name,
        scopes: [...account.scopes].sort(),
        createdBy: account.createdBy,
        ...(account.disabledAt === undefined
          ? {}
          : { disabledAt: account.disabledAt }),
        activeApiKeyCount: activeServiceAccountApiKeys.filter(
          (key) => key.serviceAccountId === account.id,
        ).length,
        createdAt: account.createdAt,
      }))
      .sort(byId),
    resourceGrants: sortGrants(grants),
    connectorOwnership: {
      dataConnectors: dataConnectors
        .map((connector) => ({
          id: connector.id,
          workspaceId: connector.workspaceId,
          knowledgeBaseId: connector.knowledgeBaseId,
          type: connector.type,
          status: connector.status,
          createdBy: connector.createdBy,
          configKeys: Object.keys(connector.config).sort(),
          ...stringConfig(connector.config, "sourceAccessMode"),
          ...stringConfig(connector.config, "delegatedOAuthConnectionId"),
          ...(connector.syncIntervalMinutes === undefined
            ? {}
            : { syncIntervalMinutes: connector.syncIntervalMinutes }),
          ...(connector.nextSyncAt === undefined
            ? {}
            : { nextSyncAt: connector.nextSyncAt }),
          ...(connector.lastSyncAt === undefined
            ? {}
            : { lastSyncAt: connector.lastSyncAt }),
          createdAt: connector.createdAt,
          updatedAt: connector.updatedAt,
        }))
        .sort(byId),
      delegatedOAuthConnections: delegatedOAuthConnections
        .map((connection) => ({
          id: connection.id,
          workspaceId: connection.workspaceId,
          userId: connection.userId,
          providerId: connection.providerId,
          connectorType: connection.connectorType,
          providerAccountLoginConfigured:
            connection.providerAccountLogin !== undefined,
          ...(connection.providerAccountLogin === undefined
            ? {}
            : {
                providerAccountLoginHash: stableHash(
                  connection.providerAccountLogin,
                ),
              }),
          scopeCount: connection.scopes.length,
          status: connection.status,
          ...(connection.accessTokenExpiresAt === undefined
            ? {}
            : { accessTokenExpiresAt: connection.accessTokenExpiresAt }),
          ...(connection.refreshTokenExpiresAt === undefined
            ? {}
            : { refreshTokenExpiresAt: connection.refreshTokenExpiresAt }),
          ...(connection.lastUsedAt === undefined
            ? {}
            : { lastUsedAt: connection.lastUsedAt }),
          ...(connection.revokedAt === undefined
            ? {}
            : { revokedAt: connection.revokedAt }),
          createdAt: connection.createdAt,
          updatedAt: connection.updatedAt,
        }))
        .sort(byId),
    },
    toolRisk: {
      connectors: toolConnectorReports,
      workerJobs,
    },
    supportAccess,
  };
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

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
  return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

function supportAccessPosture(
  logs: AuditLog[],
  sessionsByUser: Map<string, UserSession[]>,
): AccessReviewReport["supportAccess"] {
  const sessions = Array.from(sessionsByUser.values()).flat();
  const supportSessions = logs
    .filter(
      (log) =>
        log.action === "support.impersonation.create" &&
        log.resourceType === "session",
    )
    .map((log) => {
      const session = sessions.find((item) => item.id === log.resourceId);
      if (session === undefined) return undefined;
      return supportSessionPosture(log, session);
    })
    .filter(
      (session): session is AccessReviewSupportSessionPosture =>
        session !== undefined,
    )
    .sort((left, right) => left.sessionId.localeCompare(right.sessionId));
  return {
    requests: supportRequestPostures(logs),
    sessions: supportSessions,
    routeAuditCount: logs.filter(
      (log) => log.action === "support.impersonation.request",
    ).length,
  };
}

function supportSessionPosture(
  log: AuditLog,
  session: UserSession,
): AccessReviewSupportSessionPosture {
  const metadata = log.metadata;
  return {
    sessionId: session.id,
    status: sessionStatus(session),
    adminUserId: log.actorId,
    targetUserId:
      typeof metadata.targetUserId === "string"
        ? metadata.targetUserId
        : session.userId,
    ...numberMetadata(metadata, "ttlMinutes"),
    ...stringMetadata(metadata, "approvalRequestId"),
    ...stringMetadata(metadata, "requestedByUserId"),
    ...stringMetadata(metadata, "ticketRef"),
    ...stringMetadata(metadata, "reasonHash"),
    ...numberMetadata(metadata, "reasonLength"),
    expiresAt: session.expiresAt,
    ...(session.revokedAt === undefined
      ? {}
      : { revokedAt: session.revokedAt }),
    createdAt: session.createdAt,
    createdAuditLogId: log.id,
  };
}

function supportRequestPostures(
  logs: AuditLog[],
): AccessReviewSupportRequestPosture[] {
  const decisions = logs.filter(
    (log) =>
      log.action === "support.impersonation.request.approve" ||
      log.action === "support.impersonation.request.reject",
  );
  return logs
    .filter(
      (log) =>
        log.action === "support.impersonation.request.create" &&
        log.resourceType === "support_impersonation_request",
    )
    .map((log) => supportRequestPosture(log, decisions))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function supportRequestPosture(
  log: AuditLog,
  decisions: AuditLog[],
): AccessReviewSupportRequestPosture {
  const metadata = log.metadata;
  const requestId = log.resourceId;
  const targetUserId =
    typeof metadata.targetUserId === "string" ? metadata.targetUserId : "";
  const ttlMinutes =
    typeof metadata.ttlMinutes === "number" ? metadata.ttlMinutes : 15;
  const base = {
    id: requestId,
    requestedByUserId: log.actorId,
    targetUserId,
    ttlMinutes,
    createdAt: log.createdAt,
    ...stringMetadata(metadata, "ticketRef"),
    ...stringMetadata(metadata, "reasonHash"),
    ...numberMetadata(metadata, "reasonLength"),
  };
  const decision = decisions.find(
    (item) => item.metadata.approvalRequestId === requestId,
  );
  if (decision?.action === "support.impersonation.request.approve") {
    return {
      ...base,
      status: "approved",
      approvedAt: decision.createdAt,
      approvedByUserId: decision.actorId,
      sessionId: decision.resourceId,
    };
  }
  if (decision?.action === "support.impersonation.request.reject") {
    return {
      ...base,
      status: "rejected",
      rejectedAt: decision.createdAt,
      rejectedByUserId: decision.actorId,
    };
  }
  return { ...base, status: "pending" };
}

function workerJobPosture(
  jobs: BackgroundJob[],
): AccessReviewWorkerJobPosture[] {
  const groups = new Map<string, BackgroundJob[]>();
  for (const job of jobs) {
    const key = `${job.type}:${job.status}`;
    groups.set(key, [...(groups.get(key) ?? []), job]);
  }
  return Array.from(groups.values())
    .map((items) => {
      const oldestCreatedAt = items
        .map((job) => job.createdAt)
        .sort((left, right) => left.localeCompare(right))[0];
      return {
        type: items[0]!.type,
        status: items[0]!.status,
        count: items.length,
        ...(oldestCreatedAt === undefined ? {} : { oldestCreatedAt }),
      };
    })
    .sort((left, right) =>
      `${left.type}:${left.status}`.localeCompare(
        `${right.type}:${right.status}`,
      ),
    );
}

function isActiveSession(session: UserSession): boolean {
  return (
    session.revokedAt === undefined &&
    new Date(session.expiresAt).getTime() > Date.now()
  );
}

function sessionStatus(
  session: UserSession,
): AccessReviewSupportSessionPosture["status"] {
  if (session.revokedAt !== undefined) return "revoked";
  if (new Date(session.expiresAt).getTime() <= Date.now()) return "expired";
  return "active";
}

function sortGrants(grants: ResourceGrant[]): ResourceGrant[] {
  return [...grants].sort((left, right) =>
    `${left.resourceType}:${left.resourceId}:${left.principalType}:${left.principalId}:${left.permission}`.localeCompare(
      `${right.resourceType}:${right.resourceId}:${right.principalType}:${right.principalId}:${right.permission}`,
    ),
  );
}

function stringConfig(
  config: Record<string, unknown>,
  key: "delegatedOAuthConnectionId" | "sourceAccessMode",
): Record<string, string> {
  return typeof config[key] === "string" ? { [key]: config[key] } : {};
}

function stringMetadata(
  metadata: Record<string, unknown>,
  key: "approvalRequestId" | "reasonHash" | "requestedByUserId" | "ticketRef",
): Record<string, string> {
  return typeof metadata[key] === "string" ? { [key]: metadata[key] } : {};
}

function numberMetadata(
  metadata: Record<string, unknown>,
  key: "reasonLength" | "ttlMinutes",
): Record<string, number> {
  return typeof metadata[key] === "number" ? { [key]: metadata[key] } : {};
}

function byId<T extends { id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id);
}

function csvCell(value: string | number | boolean): string {
  const stringValue = String(value);
  if (!/[",\n\r]/.test(stringValue)) return stringValue;
  return `"${stringValue.replace(/"/g, '""')}"`;
}
