import { z } from "@hono/zod-openapi";

import {
  governanceCount as count,
  governanceIdentifier as identifier,
  governanceTimestamp as timestamp,
} from "./governance-schema-primitives";

export const RetentionPolicySchema = z
  .strictObject({
    orgId: identifier,
    auditLogRetentionDays: z.number().int().min(30).max(3650),
    runEventRetentionDays: z.number().int().min(1).max(3650),
    fileRetentionDays: z.number().int().min(1).max(3650).nullable(),
    workspaceFileRetentionDays: z.record(
      z.string(),
      z.number().int().min(1).max(3650).nullable(),
    ),
    userFileRetentionDays: z.record(
      z.string(),
      z.number().int().min(1).max(3650).nullable(),
    ),
    updatedBy: identifier,
    updatedAt: timestamp,
  })
  .openapi("RetentionPolicy");
export const UpdateRetentionPolicyRequestSchema = z
  .strictObject({
    auditLogRetentionDays: z.number().int().min(30).max(3650),
    runEventRetentionDays: z.number().int().min(1).max(3650),
    fileRetentionDays: z.number().int().min(1).max(3650).nullable().optional(),
    workspaceFileRetentionDays: z
      .record(
        z.string().min(1).max(200),
        z.number().int().min(1).max(3650).nullable(),
      )
      .refine((value) => Object.keys(value).length <= 500)
      .optional(),
    userFileRetentionDays: z
      .record(
        z.string().min(1).max(200),
        z.number().int().min(1).max(3650).nullable(),
      )
      .refine((value) => Object.keys(value).length <= 500)
      .optional(),
  })
  .openapi("UpdateRetentionPolicyRequest");
export const RetentionEnforcementResultSchema = z
  .strictObject({
    orgId: identifier,
    auditLogRetentionDays: count,
    runEventRetentionDays: count,
    cutoffAt: timestamp,
    runEventCutoffAt: timestamp,
    cleanedBrowserAutomationJobCount: count.optional(),
    deletedBrowserAutomationArtifactCount: count.optional(),
    cleanedVoiceArtifactUsageEventCount: count.optional(),
    deletedVoiceArtifactCount: count.optional(),
    missingVoiceArtifactCount: count.optional(),
    deletedDataExportPackageCount: count.optional(),
    missingDataExportPackageCount: count.optional(),
    deletedFileObjectCount: count.optional(),
    missingFileObjectCount: count.optional(),
    deletedFileObjectBytes: count.optional(),
    deletedAuditLogCount: count,
    deletedRunEventCount: count,
    runEventCompactionLimitReached: z.boolean(),
    enforcedAt: timestamp,
  })
  .openapi("RetentionEnforcementResult");

export const DataDeletionResourceTypeSchema = z.enum([
  "chat",
  "file_object",
  "knowledge_source",
]);
export const DataDeletionCountsSchema = z
  .strictObject({
    chats: count,
    messages: count,
    messageParts: count,
    runs: count,
    runSteps: count,
    runEvents: count,
    chatComments: count,
    userNotifications: count,
    notificationDeliveries: count,
    runLinkedToolCalls: count,
    usageEvents: count,
    resourceGrants: count,
    resourceFavorites: count,
    workspaceFolderItems: count,
    fileObjects: count,
    knowledgeSources: count,
    knowledgeChunks: count,
    knowledgeEmbeddings: count,
    objectStoreObjects: count,
    objectStoreBytes: count,
  })
  .openapi("DataDeletionCounts");
export const dataDeletionPlan = {
  orgId: identifier,
  workspaceId: identifier,
  resourceType: DataDeletionResourceTypeSchema,
  resourceId: identifier,
  knowledgeBaseId: identifier.optional(),
  legalHold: z
    .strictObject({ until: timestamp, reason: z.string().optional() })
    .optional(),
  counts: DataDeletionCountsSchema,
};
export const GovernanceDataDeletionPreviewSchema = z
  .strictObject({
    schema: z.literal("romeo.data-deletion-preview.v1"),
    ...dataDeletionPlan,
    previewedAt: timestamp,
  })
  .openapi("DataDeletionPreview");
export const GovernanceDataDeletionResultSchema = z
  .strictObject({
    schema: z.literal("romeo.data-deletion-result.v1"),
    ...dataDeletionPlan,
    deletedAt: timestamp,
  })
  .openapi("DataDeletionResult");
export const PreviewDataDeletionRequestSchema = z
  .strictObject({
    resourceType: DataDeletionResourceTypeSchema,
    resourceId: z.string().min(1).max(200),
  })
  .openapi("PreviewDataDeletionRequest");
export const ExecuteDataDeletionRequestSchema =
  PreviewDataDeletionRequestSchema.extend({
    confirmResourceId: z.string().min(1).max(200),
  }).openapi("ExecuteDataDeletionRequest");

export const DataExportRequestSchema = z
  .strictObject({
    scope: z.enum(["org", "workspace"]),
    workspaceId: z.string().min(1).max(200).optional(),
    includeContent: z.boolean().optional(),
    includeObjectBytes: z.boolean().optional(),
    maxObjectBytes: z.number().int().min(0).max(5_000_000).optional(),
  })
  .refine((value) => value.scope !== "workspace" || value.workspaceId, {
    message: "workspaceId is required when scope is workspace.",
  })
  .refine((value) => value.scope !== "org" || value.workspaceId === undefined, {
    message: "workspaceId is only valid when scope is workspace.",
  })
  .openapi("DataExportRequest");
export const DataExportResolvedRequestSchema = z.strictObject({
  scope: z.enum(["org", "workspace"]),
  workspaceId: identifier.optional(),
  includeContent: z.boolean(),
  includeObjectBytes: z.boolean(),
  maxObjectBytes: count,
});
export const DataExportCountsSchema = z.strictObject({
  workspaces: count,
  agents: count,
  promptTemplates: count,
  chats: count,
  messages: count,
  messageParts: count,
  chatComments: count,
  knowledgeBases: count,
  knowledgeSources: count,
  knowledgeChunks: count,
  fileObjects: count,
  fileObjectBytesIncluded: count,
  knowledgeSourceBytesIncluded: count,
  dataConnectors: count,
  dataConnectorSyncs: count,
  workflows: count,
  workflowRuns: count,
  usageEvents: count,
  backgroundJobs: count,
});
export const DataExportLimitsSchema = z.strictObject({
  maxObjectBytes: count,
  maxTotalObjectBytes: count,
});
export const exportCommon = {
  orgId: identifier,
  request: DataExportResolvedRequestSchema,
  counts: DataExportCountsSchema,
  limits: DataExportLimitsSchema,
  warnings: z.array(z.string()),
  exclusions: z.array(z.string()),
};
export const DataExportPreviewSchema = z
  .strictObject({
    schema: z.literal("romeo.data-export-preview.v1"),
    ...exportCommon,
    previewedAt: timestamp,
  })
  .openapi("DataExportPreview");
export const DataExportDocumentSchema = z
  .strictObject({
    schema: z.literal("romeo.data-export.v1"),
    ...exportCommon,
    data: z.strictObject({
      workspaces: z.array(z.record(z.string(), z.unknown())),
      agents: z.array(z.record(z.string(), z.unknown())),
      promptTemplates: z.array(z.record(z.string(), z.unknown())),
      chats: z.array(z.record(z.string(), z.unknown())),
      knowledgeBases: z.array(z.record(z.string(), z.unknown())),
      fileObjects: z.array(z.record(z.string(), z.unknown())),
      dataConnectors: z.array(z.record(z.string(), z.unknown())),
      workflows: z.array(z.record(z.string(), z.unknown())),
      usageEvents: z.array(z.record(z.string(), z.unknown())),
      backgroundJobs: z.array(z.record(z.string(), z.unknown())),
      ragVectorPosture: z.record(z.string(), z.unknown()),
    }),
    exportedAt: timestamp,
  })
  .openapi("DataExportDocument");
export const DataExportPackageArtifactSchema = z.strictObject({
  contentType: z.literal("application/json"),
  sizeBytes: count,
  sha256: z.string(),
  downloadUrl: z.string(),
  storage: z.strictObject({
    driver: z.literal("object_store"),
    objectKeyHash: z.string(),
    rawObjectKeyReturned: z.literal(false),
  }),
});
export const dataExportPackageFields = {
  packageId: identifier,
  ...exportCommon,
  artifact: DataExportPackageArtifactSchema,
  createdAt: timestamp,
};
export const DataExportPackageSchema = z
  .strictObject({
    schema: z.literal("romeo.data-export-package.v1"),
    ...dataExportPackageFields,
  })
  .openapi("DataExportPackage");
export const DataExportPackageSummarySchema = z.strictObject({
  schema: z.literal("romeo.data-export-package-summary.v1"),
  ...dataExportPackageFields,
});
export const DataExportPackageListSchema = z
  .strictObject({
    schema: z.literal("romeo.data-export-package-list.v1"),
    orgId: identifier,
    packages: z.array(DataExportPackageSummarySchema),
    redaction: z.strictObject({
      packageContentReturned: z.literal(false),
      rawObjectKeysReturned: z.literal(false),
    }),
    generatedAt: timestamp,
  })
  .openapi("DataExportPackageList");
export const DeleteDataExportPackageRequestSchema = z
  .strictObject({ confirmPackageId: z.string().min(1).max(200) })
  .openapi("DeleteDataExportPackageRequest");
export const DataExportPackageDeleteResultSchema = z
  .strictObject({
    schema: z.literal("romeo.data-export-package-delete-result.v1"),
    packageId: identifier,
    orgId: identifier,
    storage: z.strictObject({
      driver: z.literal("object_store"),
      objectKeyHash: z.string(),
      rawObjectKeyReturned: z.literal(false),
    }),
    redaction: z.strictObject({
      packageContentReturned: z.literal(false),
      rawObjectKeysReturned: z.literal(false),
    }),
    deletedAt: timestamp,
  })
  .openapi("DataExportPackageDeleteResult");

export const DataRightsCoverageStatusSchema = z.enum([
  "implemented",
  "partial",
  "planned",
  "external_retention_required",
]);
export const DataRightsWorkflowCoverageSchema = z.strictObject({
  id: z.string(),
  status: DataRightsCoverageStatusSchema,
  scope: z.string(),
  evidence: z.array(z.string()),
  limitations: z.array(z.string()),
});
export const DataRightsRetentionEvidenceSummarySchema = z
  .strictObject({
    requiredForProduction: z.literal(true),
    control: z.enum(["backups", "operational_logs"]),
    status: z.enum(["external_required", "failed", "invalid", "satisfied"]),
    evidence: z.strictObject({
      configured: z.boolean(),
      schemaVersion: z
        .literal("romeo.data-rights-retention-evidence.v1")
        .optional(),
      generatedAt: timestamp.optional(),
      evidenceStatus: z.enum(["failed", "passed", "unknown"]).optional(),
      retentionDays: count.optional(),
      destructionValidated: z.boolean().optional(),
      encryptedAtRest: z.boolean().optional(),
      immutableWindowDays: count.optional(),
      reviewedSystemCount: count,
      failureCodes: z.array(z.string()),
      invalidReason: z
        .enum([
          "control_mismatch",
          "invalid_json",
          "read_failed",
          "required_fields_missing",
          "schema_mismatch",
        ])
        .optional(),
    }),
  })
  .openapi("DataRightsRetentionEvidenceSummary");
export const DataRightsCoverageReportSchema = z
  .strictObject({
    schema: z.literal("romeo.data-rights-coverage.v1"),
    orgId: identifier,
    generatedAt: timestamp,
    supportedDeletionResourceTypes: z.array(DataDeletionResourceTypeSchema),
    deletionWorkflows: z.array(DataRightsWorkflowCoverageSchema),
    exportWorkflows: z.array(DataRightsWorkflowCoverageSchema),
    storageClasses: z.array(
      z.strictObject({
        id: z.string(),
        label: z.string(),
        containsCustomerContent: z.boolean(),
        deletionCoverage: DataRightsCoverageStatusSchema,
        exportCoverage: DataRightsCoverageStatusSchema,
        retentionCoverage: DataRightsCoverageStatusSchema,
        deletionEvidence: z.array(z.string()),
        exportEvidence: z.array(z.string()),
        limitations: z.array(z.string()),
      }),
    ),
    retentionEvidence: z.strictObject({
      operationalLogs: DataRightsRetentionEvidenceSummarySchema,
      backups: DataRightsRetentionEvidenceSummarySchema,
      redaction: z.strictObject({
        backupLocationReturned: z.literal(false),
        evidenceFileBodiesReturned: z.literal(false),
        logContentReturned: z.literal(false),
        objectStoreKeysReturned: z.literal(false),
        rawEvidencePathsReturned: z.literal(false),
        secretValuesReturned: z.literal(false),
      }),
    }),
    backupRetention: z.strictObject({
      status: z.literal("externally_governed"),
      posture: z.string(),
      evidence: z.array(z.string()),
      limitations: z.array(z.string()),
    }),
    supportBundles: z.strictObject({
      status: z.literal("implemented"),
      evidence: z.array(z.string()),
      redaction: z.string(),
    }),
    openGaps: z.array(z.string()),
  })
  .openapi("DataRightsCoverageReport");

export const ComplianceReportSchema = z
  .strictObject({
    schema: z.literal("romeo.compliance-report.v1"),
    orgId: identifier,
    generatedAt: timestamp,
    controls: z.array(
      z.strictObject({
        id: z.string(),
        title: z.string(),
        status: z.enum(["attention", "informational", "pass"]),
        evidence: z.record(
          z.string(),
          z.union([z.boolean(), z.number(), z.string(), z.null()]),
        ),
      }),
    ),
  })
  .openapi("ComplianceReport");
