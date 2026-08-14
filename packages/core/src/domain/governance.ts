export interface RetentionPolicy {
  orgId: string;
  auditLogRetentionDays: number;
  runEventRetentionDays: number;
  fileRetentionDays: number | null;
  workspaceFileRetentionDays: Record<string, number | null>;
  userFileRetentionDays: Record<string, number | null>;
  updatedBy: string;
  updatedAt: string;
}

export interface RetentionEnforcementResult {
  orgId: string;
  auditLogRetentionDays: number;
  runEventRetentionDays: number;
  cutoffAt: string;
  runEventCutoffAt: string;
  cleanedBrowserAutomationJobCount?: number;
  deletedBrowserAutomationArtifactCount?: number;
  cleanedVoiceArtifactUsageEventCount?: number;
  deletedVoiceArtifactCount?: number;
  missingVoiceArtifactCount?: number;
  deletedDataExportPackageCount?: number;
  missingDataExportPackageCount?: number;
  deletedFileObjectCount?: number;
  missingFileObjectCount?: number;
  deletedFileObjectBytes?: number;
  deletedAuditLogCount: number;
  deletedRunEventCount: number;
  runEventCompactionLimitReached: boolean;
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

export type * from "./access-review";
