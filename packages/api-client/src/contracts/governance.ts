export interface AuditLogFilter {
  action?: string;
  actorId?: string;
  outcome?: "failure" | "success";
  resourceId?: string;
  resourceType?: string;
}

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
  cleanedBrowserAutomationJobCount?: number | undefined;
  deletedBrowserAutomationArtifactCount?: number | undefined;
  cleanedVoiceArtifactUsageEventCount?: number | undefined;
  deletedVoiceArtifactCount?: number | undefined;
  missingVoiceArtifactCount?: number | undefined;
  deletedDataExportPackageCount?: number | undefined;
  missingDataExportPackageCount?: number | undefined;
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

export interface DataDeletionPreview {
  schema: "romeo.data-deletion-preview.v1";
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
  previewedAt: string;
}

export interface DataDeletionResult {
  schema: "romeo.data-deletion-result.v1";
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
  deletedAt: string;
}

export interface PreviewDataDeletionInput {
  resourceType: DataDeletionResourceType;
  resourceId: string;
}

export interface ExecuteDataDeletionInput extends PreviewDataDeletionInput {
  confirmResourceId: string;
}

export type DataExportScope = "org" | "workspace";

export interface DataExportInput {
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

export interface DataExportDocument {
  schema: "romeo.data-export.v1";
  orgId: string;
  request: DataExportResolvedRequest;
  counts: DataExportCounts;
  limits: DataExportLimits;
  warnings: string[];
  exclusions: string[];
  data: Record<string, unknown>;
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

export interface DeleteDataExportPackageInput {
  confirmPackageId: string;
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

export interface ComplianceControl {
  id: string;
  title: string;
  status: ComplianceControlStatus;
  evidence: Record<string, boolean | number | string | null>;
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
  policy: IdentityLifecyclePolicyPosture;
  summary: {
    activeServiceAccountApiKeyCount: number;
    activeSupportSessionCount: number;
    activeUserApiKeyCount: number;
    activeUserSessionCount: number;
    dataConnectorCount: number;
    delegatedOAuthConnectionCount: number;
    disabledServiceAccountCount: number;
    disabledUserCount: number;
    groupCount: number;
    groupMembershipCount: number;
    pendingSupportRequestCount: number;
    queuedWorkerJobCount: number;
    resourceGrantCount: number;
    riskyToolConnectorCount: number;
    runningWorkerJobCount: number;
    serviceAccountCount: number;
    toolConnectorCount: number;
    userCount: number;
  };
  users: Array<{
    id: string;
    email: string;
    name: string;
    disabledAt?: string;
    source: "local" | "oidc_derived";
    groupIds: string[];
    activeApiKeyCount: number;
    activeSessionCount: number;
  }>;
  groups: Array<{
    id: string;
    name: string;
    slug: string;
    memberCount: number;
    createdAt: string;
  }>;
  serviceAccounts: Array<{
    id: string;
    name: string;
    scopes: string[];
    createdBy: string;
    disabledAt?: string;
    activeApiKeyCount: number;
    createdAt: string;
  }>;
  resourceGrants: ResourceGrant[];
  connectorOwnership: {
    dataConnectors: Array<Record<string, unknown>>;
    delegatedOAuthConnections: Array<Record<string, unknown>>;
  };
  toolRisk: {
    connectors: Array<Record<string, unknown>>;
    workerJobs: Array<Record<string, unknown>>;
  };
  supportAccess: {
    requests: Array<Record<string, unknown>>;
    sessions: Array<Record<string, unknown>>;
    routeAuditCount: number;
  };
}

export interface IdentityLifecyclePolicyPosture {
  accountLinking: "disabled";
  destructiveMembershipSync: "disabled";
  localAdminSource: "local";
  oidcGroupSync: "additive_known_groups_only";
  scim: "disabled" | "enabled";
  supportAccess: "time_bound_approved_audited";
}

export interface IdentityLifecyclePolicy {
  schema: "romeo.identity-lifecycle-policy.v1";
  orgId: string;
  generatedAt: string;
  policy: IdentityLifecyclePolicyPosture;
  accountLinking: {
    status: "disabled";
    rationale: string;
  };
  scim: {
    status: "disabled" | "enabled";
    supportedResources: Array<"User" | "Group">;
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

export interface UpdateRetentionPolicyInput {
  auditLogRetentionDays: number;
}

export interface ResourceGrant {
  id: string;
  resourceType:
    | "agent"
    | "chat"
    | "knowledge_base"
    | "model"
    | "organization"
    | "provider"
    | "run"
    | "tool"
    | "voice_profile"
    | "workspace";
  resourceId: string;
  principalType: "group" | "service_account" | "user";
  principalId: string;
  permission: "read" | "run" | "use" | "write";
}
