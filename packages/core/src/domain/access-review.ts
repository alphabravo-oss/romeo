import type { ResourceGrant, Scope } from "@romeo/auth";
import type { DataConnectorType } from "./data-connectors";
import type { DelegatedOAuthProviderId } from "./delegated-oauth";
import type { ToolConnectorType, ToolVisibility } from "./tools";

export interface AccessReviewReport {
  schema: "romeo.access-review-report.v1";
  orgId: string;
  generatedAt: string;
  policy: AccessReviewPolicyPosture;
  summary: AccessReviewSummary;
  users: AccessReviewUserPosture[];
  groups: AccessReviewGroupPosture[];
  serviceAccounts: AccessReviewServiceAccountPosture[];
  resourceGrants: ResourceGrant[];
  connectorOwnership: AccessReviewConnectorOwnership;
  toolRisk: AccessReviewToolRiskPosture;
  supportAccess: AccessReviewSupportAccessPosture;
}

export interface IdentityLifecyclePolicy {
  schema: "romeo.identity-lifecycle-policy.v1";
  orgId: string;
  generatedAt: string;
  policy: AccessReviewPolicyPosture;
  accountLinking: {
    status: "disabled";
    rationale: string;
  };
  scim: {
    status: "disabled" | "enabled";
    supportedResources: ("User" | "Group")[];
    rationale: string;
  };
  groupLifecycle: {
    localAdminSource: "local";
    oidcGroupSync: "additive_known_groups_only";
    destructiveMembershipSync: "disabled";
    unknownExternalGroups: "ignored";
  };
  deprovisioning: {
    localUserDisable: "revokes_user_api_keys_and_sessions";
    oidcFeed: "admin_confirmed_issuer_subject";
    supportAccess: "time_bound_approved_audited_revocable";
  };
}

export interface AccessReviewPolicyPosture {
  accountLinking: "disabled";
  scim: "disabled" | "enabled";
  localAdminSource: "local";
  oidcGroupSync: "additive_known_groups_only";
  destructiveMembershipSync: "disabled";
  supportAccess: "time_bound_approved_audited";
}

export interface AccessReviewSummary {
  userCount: number;
  disabledUserCount: number;
  groupCount: number;
  groupMembershipCount: number;
  serviceAccountCount: number;
  disabledServiceAccountCount: number;
  activeUserApiKeyCount: number;
  activeServiceAccountApiKeyCount: number;
  activeUserSessionCount: number;
  resourceGrantCount: number;
  dataConnectorCount: number;
  delegatedOAuthConnectionCount: number;
  toolConnectorCount: number;
  riskyToolConnectorCount: number;
  pendingSupportRequestCount: number;
  activeSupportSessionCount: number;
  runningWorkerJobCount: number;
  queuedWorkerJobCount: number;
}

export interface AccessReviewUserPosture {
  id: string;
  email: string;
  name: string;
  disabledAt?: string;
  source: "local" | "oidc_derived";
  groupIds: string[];
  activeApiKeyCount: number;
  activeSessionCount: number;
}

export interface AccessReviewGroupPosture {
  id: string;
  name: string;
  slug: string;
  memberCount: number;
  createdAt: string;
}

export interface AccessReviewServiceAccountPosture {
  id: string;
  name: string;
  scopes: Scope[];
  createdBy: string;
  disabledAt?: string;
  activeApiKeyCount: number;
  createdAt: string;
}

export interface AccessReviewConnectorOwnership {
  dataConnectors: AccessReviewDataConnectorPosture[];
  delegatedOAuthConnections: AccessReviewDelegatedOAuthConnectionPosture[];
}

export interface AccessReviewDataConnectorPosture {
  id: string;
  workspaceId: string;
  knowledgeBaseId: string;
  type: DataConnectorType;
  status: string;
  createdBy: string;
  configKeys: string[];
  sourceAccessMode?: string;
  delegatedOAuthConnectionId?: string;
  syncIntervalMinutes?: number;
  nextSyncAt?: string;
  lastSyncAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AccessReviewDelegatedOAuthConnectionPosture {
  id: string;
  workspaceId: string;
  userId: string;
  providerId: DelegatedOAuthProviderId;
  connectorType: DataConnectorType;
  providerAccountLoginConfigured: boolean;
  providerAccountLoginHash?: string;
  scopeCount: number;
  status: string;
  accessTokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
  lastUsedAt?: string;
  revokedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AccessReviewToolRiskPosture {
  connectors: AccessReviewToolConnectorPosture[];
  workerJobs: AccessReviewWorkerJobPosture[];
}

export interface AccessReviewToolConnectorPosture {
  id: string;
  type: ToolConnectorType;
  name: string;
  enabled: boolean;
  riskLevel: string;
  approvalPolicy: string;
  visibility: ToolVisibility;
  allowedHostCount: number;
  allowPrivateNetwork: boolean;
  operationCount: number;
  enabledOperationCount: number;
  highRiskOperationCount: number;
  approvalRequiredOperationCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AccessReviewWorkerJobPosture {
  type: string;
  status: string;
  count: number;
  oldestCreatedAt?: string;
}

export interface AccessReviewSupportAccessPosture {
  requests: AccessReviewSupportRequestPosture[];
  sessions: AccessReviewSupportSessionPosture[];
  routeAuditCount: number;
}

export interface AccessReviewSupportRequestPosture {
  id: string;
  status: "approved" | "pending" | "rejected";
  requestedByUserId: string;
  targetUserId: string;
  ttlMinutes: number;
  createdAt: string;
  approvedAt?: string;
  approvedByUserId?: string;
  rejectedAt?: string;
  rejectedByUserId?: string;
  sessionId?: string;
  ticketRef?: string;
  reasonHash?: string;
  reasonLength?: number;
}

export interface AccessReviewSupportSessionPosture {
  sessionId: string;
  status: "active" | "expired" | "revoked";
  adminUserId: string;
  targetUserId: string;
  ttlMinutes?: number;
  approvalRequestId?: string;
  requestedByUserId?: string;
  ticketRef?: string;
  reasonHash?: string;
  reasonLength?: number;
  expiresAt: string;
  revokedAt?: string;
  createdAt: string;
  createdAuditLogId: string;
}
