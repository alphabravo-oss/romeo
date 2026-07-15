import type { ResourceGrant, Scope } from "@romeo/auth";
import type { DataConnectorType } from "./data-connectors";
import type { DelegatedOAuthProviderId } from "./delegated-oauth";
import type { ToolConnectorType, ToolVisibility } from "./tools";

export interface RetentionPolicy {
  orgId: string;
  auditLogRetentionDays: number;
  updatedBy: string;
  updatedAt: string;
}

export interface RetentionEnforcementResult {
  orgId: string;
  auditLogRetentionDays: number;
  cutoffAt: string;
  cleanedBrowserAutomationJobCount?: number;
  deletedBrowserAutomationArtifactCount?: number;
  cleanedVoiceArtifactUsageEventCount?: number;
  deletedVoiceArtifactCount?: number;
  missingVoiceArtifactCount?: number;
  deletedDataExportPackageCount?: number;
  missingDataExportPackageCount?: number;
  deletedAuditLogCount: number;
  enforcedAt: string;
}

export type DataDeletionResourceType =
  | "chat"
  | "file_object"
  | "knowledge_source";

export interface DataDeletionCounts {
  chats: number;
  messages: number;
  messageParts: number;
  runs: number;
  runSteps: number;
  runEvents: number;
  chatComments: number;
  userNotifications: number;
  notificationDeliveries: number;
  runLinkedToolCalls: number;
  usageEvents: number;
  resourceGrants: number;
  resourceFavorites: number;
  workspaceFolderItems: number;
  fileObjects: number;
  knowledgeSources: number;
  knowledgeChunks: number;
  knowledgeEmbeddings: number;
  objectStoreObjects: number;
  objectStoreBytes: number;
}

export interface DataDeletionPlan {
  orgId: string;
  workspaceId: string;
  resourceType: DataDeletionResourceType;
  resourceId: string;
  knowledgeBaseId?: string;
  legalHold?: {
    until: string;
    reason?: string;
  };
  counts: DataDeletionCounts;
}

export interface DataDeletionPreview extends DataDeletionPlan {
  schema: "romeo.data-deletion-preview.v1";
  previewedAt: string;
}

export interface DataDeletionResult extends DataDeletionPlan {
  schema: "romeo.data-deletion-result.v1";
  deletedAt: string;
}

export type DataExportScope = "org" | "workspace";

export interface DataExportRequest {
  scope: DataExportScope;
  workspaceId?: string;
  includeContent?: boolean;
  includeObjectBytes?: boolean;
  maxObjectBytes?: number;
}

export interface DataExportResolvedRequest {
  scope: DataExportScope;
  workspaceId?: string;
  includeContent: boolean;
  includeObjectBytes: boolean;
  maxObjectBytes: number;
}

export interface DataExportCounts {
  workspaces: number;
  agents: number;
  promptTemplates: number;
  chats: number;
  messages: number;
  messageParts: number;
  chatComments: number;
  knowledgeBases: number;
  knowledgeSources: number;
  knowledgeChunks: number;
  fileObjects: number;
  fileObjectBytesIncluded: number;
  knowledgeSourceBytesIncluded: number;
  dataConnectors: number;
  dataConnectorSyncs: number;
  workflows: number;
  workflowRuns: number;
  usageEvents: number;
  backgroundJobs: number;
}

export interface DataExportLimits {
  maxObjectBytes: number;
  maxTotalObjectBytes: number;
}

export interface DataExportPreview {
  schema: "romeo.data-export-preview.v1";
  orgId: string;
  request: DataExportResolvedRequest;
  counts: DataExportCounts;
  limits: DataExportLimits;
  warnings: string[];
  exclusions: string[];
  previewedAt: string;
}

export interface ExportedObjectBytes {
  included: boolean;
  reason?:
    | "missing_object"
    | "not_requested"
    | "object_too_large"
    | "total_limit_exceeded";
  encoding?: "base64";
  sizeBytes?: number;
  sha256?: string;
  dataBase64?: string;
}

export interface DataExportDocument {
  schema: "romeo.data-export.v1";
  orgId: string;
  request: DataExportResolvedRequest;
  counts: DataExportCounts;
  limits: DataExportLimits;
  warnings: string[];
  exclusions: string[];
  data: {
    workspaces: Array<Record<string, unknown>>;
    agents: Array<Record<string, unknown>>;
    promptTemplates: Array<Record<string, unknown>>;
    chats: Array<Record<string, unknown>>;
    knowledgeBases: Array<Record<string, unknown>>;
    fileObjects: Array<Record<string, unknown>>;
    dataConnectors: Array<Record<string, unknown>>;
    workflows: Array<Record<string, unknown>>;
    usageEvents: Array<Record<string, unknown>>;
    backgroundJobs: Array<Record<string, unknown>>;
    ragVectorPosture: Record<string, unknown>;
  };
  exportedAt: string;
}

export interface DataExportPackageArtifact {
  contentType: "application/json";
  sizeBytes: number;
  sha256: string;
  downloadUrl: string;
  storage: {
    driver: "object_store";
    objectKeyHash: string;
    rawObjectKeyReturned: false;
  };
}

export interface DataExportPackage {
  schema: "romeo.data-export-package.v1";
  packageId: string;
  orgId: string;
  request: DataExportResolvedRequest;
  counts: DataExportCounts;
  limits: DataExportLimits;
  warnings: string[];
  exclusions: string[];
  artifact: DataExportPackageArtifact;
  createdAt: string;
}

export interface DataExportPackageSummary {
  schema: "romeo.data-export-package-summary.v1";
  packageId: string;
  orgId: string;
  request: DataExportResolvedRequest;
  counts: DataExportCounts;
  limits: DataExportLimits;
  warnings: string[];
  exclusions: string[];
  artifact: DataExportPackageArtifact;
  createdAt: string;
}

export interface DataExportPackageList {
  schema: "romeo.data-export-package-list.v1";
  orgId: string;
  packages: DataExportPackageSummary[];
  redaction: {
    packageContentReturned: false;
    rawObjectKeysReturned: false;
  };
  generatedAt: string;
}

export interface DataExportPackageDeleteResult {
  schema: "romeo.data-export-package-delete-result.v1";
  packageId: string;
  orgId: string;
  storage: {
    driver: "object_store";
    objectKeyHash: string;
    rawObjectKeyReturned: false;
  };
  redaction: {
    packageContentReturned: false;
    rawObjectKeysReturned: false;
  };
  deletedAt: string;
}

export type DataRightsCoverageStatus =
  | "implemented"
  | "partial"
  | "planned"
  | "external_retention_required";

export interface DataRightsStorageClassCoverage {
  id: string;
  label: string;
  containsCustomerContent: boolean;
  deletionCoverage: DataRightsCoverageStatus;
  exportCoverage: DataRightsCoverageStatus;
  retentionCoverage: DataRightsCoverageStatus;
  deletionEvidence: string[];
  exportEvidence: string[];
  limitations: string[];
}

export interface DataRightsWorkflowCoverage {
  id: string;
  status: DataRightsCoverageStatus;
  scope: string;
  evidence: string[];
  limitations: string[];
}

export type DataRightsRetentionEvidenceControl = "backups" | "operational_logs";

export type DataRightsRetentionEvidenceStatus =
  | "external_required"
  | "failed"
  | "invalid"
  | "satisfied";

export type DataRightsRetentionEvidenceInvalidReason =
  | "control_mismatch"
  | "invalid_json"
  | "read_failed"
  | "required_fields_missing"
  | "schema_mismatch";

export interface DataRightsRetentionEvidenceSummary {
  requiredForProduction: true;
  control: DataRightsRetentionEvidenceControl;
  status: DataRightsRetentionEvidenceStatus;
  evidence: {
    configured: boolean;
    schemaVersion?: "romeo.data-rights-retention-evidence.v1";
    generatedAt?: string;
    evidenceStatus?: "failed" | "passed" | "unknown";
    retentionDays?: number;
    destructionValidated?: boolean;
    encryptedAtRest?: boolean;
    immutableWindowDays?: number;
    reviewedSystemCount: number;
    failureCodes: string[];
    invalidReason?: DataRightsRetentionEvidenceInvalidReason;
  };
}

export interface DataRightsCoverageReport {
  schema: "romeo.data-rights-coverage.v1";
  orgId: string;
  generatedAt: string;
  supportedDeletionResourceTypes: DataDeletionResourceType[];
  deletionWorkflows: DataRightsWorkflowCoverage[];
  exportWorkflows: DataRightsWorkflowCoverage[];
  storageClasses: DataRightsStorageClassCoverage[];
  retentionEvidence: {
    operationalLogs: DataRightsRetentionEvidenceSummary;
    backups: DataRightsRetentionEvidenceSummary;
    redaction: {
      backupLocationReturned: false;
      evidenceFileBodiesReturned: false;
      logContentReturned: false;
      objectStoreKeysReturned: false;
      rawEvidencePathsReturned: false;
      secretValuesReturned: false;
    };
  };
  backupRetention: {
    status: "externally_governed";
    posture: string;
    evidence: string[];
    limitations: string[];
  };
  supportBundles: {
    status: "implemented";
    evidence: string[];
    redaction: string;
  };
  openGaps: string[];
}

export type ComplianceControlStatus = "attention" | "informational" | "pass";

export interface ComplianceControlEvidence {
  [key: string]: boolean | number | string | null;
}

export interface ComplianceControl {
  id: string;
  title: string;
  status: ComplianceControlStatus;
  evidence: ComplianceControlEvidence;
}

export interface ComplianceReport {
  schema: "romeo.compliance-report.v1";
  orgId: string;
  generatedAt: string;
  controls: ComplianceControl[];
}

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
