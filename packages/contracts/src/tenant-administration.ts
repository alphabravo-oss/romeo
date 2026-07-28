import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";
import { OrganizationSchema, WorkspaceSchema } from "./identity";

const identifier = z.string().trim().min(1).max(300);
const timestamp = z.iso.datetime();
const nonnegative = z.number().int().nonnegative();
const organizationPath = z.strictObject({ orgId: identifier });

const deletionRequest = z.strictObject({
  status: z.enum(["cancelled", "requested"]),
  reasonCode: z.string(),
  requestedAt: timestamp,
  requestedBy: identifier,
  cancelledAt: timestamp.optional(),
  cancelledBy: identifier.optional(),
});

export const TenantOrganizationSummarySchema = z
  .strictObject({
    organization: OrganizationSchema,
    counts: z.strictObject({
      activeApiKeys: nonnegative,
      disabledUsers: nonnegative,
      serviceAccounts: nonnegative,
      users: nonnegative,
      workspaces: nonnegative,
    }),
    suspension: z.strictObject({
      suspended: z.boolean(),
      reasonCode: z.string().optional(),
      suspendedAt: timestamp.optional(),
      suspendedBy: identifier.optional(),
    }),
    deletionRequest: deletionRequest.optional(),
  })
  .openapi("TenantOrganizationSummary");

export const TenantProvisioningResultSchema =
  TenantOrganizationSummarySchema.extend({
    defaultWorkspace: WorkspaceSchema,
    initialAdmin: z
      .strictObject({
        id: identifier,
        email: z.email(),
        name: z.string(),
        role: z.literal("org_admin"),
        localPasswordConfigured: z.boolean(),
      })
      .optional(),
  }).openapi("TenantProvisioningResult");

export const CreateTenantOrganizationSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(120),
    slug: z.string().trim().min(1).max(80).optional(),
    defaultWorkspace: z
      .strictObject({
        name: z.string().trim().min(1).max(120).optional(),
        slug: z.string().trim().min(1).max(80).optional(),
      })
      .optional(),
    initialAdmin: z
      .strictObject({
        email: z.email().max(320),
        name: z.string().min(1).max(120),
        password: z.string().min(12).max(256).optional(),
      })
      .optional(),
  })
  .openapi("CreateTenantOrganizationRequest");

export const UpdateTenantOrganizationSchema = z
  .strictObject({
    name: z.string().min(1).max(120).optional(),
    slug: z.string().min(1).max(80).optional(),
  })
  .refine((value) => value.name !== undefined || value.slug !== undefined, {
    message: "At least one organization field is required.",
  })
  .openapi("UpdateTenantOrganizationRequest");

export const TenantOrganizationConfirmationSchema = z
  .strictObject({ confirmOrgId: identifier })
  .openapi("TenantOrganizationConfirmationRequest");
export const TenantOrganizationReasonSchema =
  TenantOrganizationConfirmationSchema.extend({
    reasonCode: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9_.:/@-]+$/u),
  }).openapi("TenantOrganizationReasonRequest");

const evidenceControl = z.enum([
  "backup_retention_review",
  "external_secret_store_review",
  "external_vector_purge_review",
  "object_store_purge_plan_review",
  "operational_log_retention_review",
  "postgres_purge_plan_review",
  "support_bundle_retention_review",
]);
const evidenceStatus = z.enum(["failed", "not_applicable", "passed"]);
const evidenceSummary = z.strictObject({
  control: evidenceControl,
  evidenceRefHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/iu)
    .optional(),
  reviewedAt: timestamp,
  reviewedBy: identifier,
  status: evidenceStatus,
});

export const TenantDeletionFinalizationEvidenceSchema =
  TenantOrganizationConfirmationSchema.extend({
    controls: z
      .array(
        z.strictObject({
          control: evidenceControl,
          evidenceRefHash: z
            .string()
            .regex(/^[a-f0-9]{64}$/iu)
            .optional(),
          status: evidenceStatus,
        }),
      )
      .min(1)
      .max(12),
  }).openapi("TenantDeletionFinalizationEvidenceRequest");

export const TenantDeletionFinalizationExecuteSchema =
  TenantOrganizationConfirmationSchema.extend({
    confirmPermanentDeletion: z.literal(true),
  }).openapi("TenantDeletionFinalizationExecuteRequest");

export const TenantDeletionFinalizationPreviewSchema = z
  .strictObject({
    schema: z.literal("romeo.tenant-deletion-finalization-preview.v1"),
    blockers: z.array(z.string()),
    counts: z.strictObject({
      activeApiKeys: nonnegative,
      activeSessions: nonnegative,
      auditLogs: nonnegative,
      backgroundJobs: nonnegative,
      dataExportPackages: nonnegative,
      fileObjects: nonnegative,
      knowledgeBases: nonnegative,
      knowledgeChunkEmbeddings: nonnegative,
      knowledgeChunks: nonnegative,
      knowledgeSourceObjects: nonnegative,
      knowledgeSources: nonnegative,
      serviceAccounts: nonnegative,
      users: nonnegative,
      workspaces: nonnegative,
    }),
    evidence: z.strictObject({
      controls: z.array(evidenceSummary),
      missingControls: z.array(evidenceControl),
      requiredControls: z.array(evidenceControl),
    }),
    generatedAt: timestamp,
    orgId: identifier,
    preconditions: z.strictObject({
      deletionRequestActive: z.boolean(),
      evidenceComplete: z.boolean(),
      suspended: z.boolean(),
    }),
    redaction: z.strictObject({
      evidenceBodiesReturned: z.literal(false),
      objectStoreKeysReturned: z.literal(false),
      rawEvidenceRefsReturned: z.literal(false),
      rawLogsReturned: z.literal(false),
      secretValuesReturned: z.literal(false),
      vectorValuesReturned: z.literal(false),
    }),
    status: z.enum(["blocked", "ready"]),
    storageClasses: z.array(
      z.strictObject({
        evidenceControl,
        id: z.enum([
          "backups",
          "external_secret_store",
          "external_vector_store",
          "object_store_artifacts",
          "operational_logs",
          "postgres_domain_records",
          "support_bundles",
        ]),
        status: z.enum(["app_tracked", "operator_evidence_required"]),
        trackedObjectCount: nonnegative.optional(),
        trackedRecordCount: nonnegative.optional(),
      }),
    ),
  })
  .openapi("TenantDeletionFinalizationPreview");

const trackedObjectCounts = z.record(
  z.enum([
    "browser_automation_artifact",
    "chat_attachment",
    "data_export_package",
    "file_object",
    "knowledge_source",
    "tool_dispatch_payload",
    "voice_artifact",
  ]),
  nonnegative,
);
export const TenantPhysicalPurgeResultSchema = z
  .strictObject({
    schema: z.literal("romeo.tenant-physical-purge-result.v1"),
    orgId: identifier,
    status: z.literal("deleted"),
    deletedAt: timestamp,
    deletedBy: identifier,
    database: z.strictObject({
      organizationDeleted: z.boolean(),
      recordCounts: z.record(z.string(), nonnegative),
      totalRecordCount: nonnegative,
    }),
    objectStore: z.strictObject({
      deletionFailures: z.literal(0),
      objectStoreKeysReturned: z.literal(false),
      trackedObjectCount: nonnegative,
      deletedObjectCount: nonnegative,
      trackedObjectsByClass: trackedObjectCounts,
    }),
    externalEvidence: z.strictObject({
      backupsHandledByEvidence: z.literal(true),
      externalSecretsHandledByEvidence: z.literal(true),
      externalVectorsHandledByEvidence: z.literal(true),
      operationalLogsHandledByEvidence: z.literal(true),
      supportBundlesHandledByEvidence: z.literal(true),
    }),
    redaction: z.strictObject({
      auditLogBodiesReturned: z.literal(false),
      evidenceBodiesReturned: z.literal(false),
      objectStoreKeysReturned: z.literal(false),
      rawEvidenceRefsReturned: z.literal(false),
      secretValuesReturned: z.literal(false),
      vectorValuesReturned: z.literal(false),
    }),
  })
  .openapi("TenantPhysicalPurgeResult");

const metadata = {
  tags: ["Tenant administration"],
  security: authenticationSecurity,
};
const errors = standardErrorResponses;
const body = <T extends z.ZodType>(schema: T) => ({
  required: true as const,
  content: { "application/json": { schema } },
});
const tenantSummaryResponse = jsonResponse(
  "Tenant organization",
  dataEnvelope(TenantOrganizationSummarySchema),
);

export const listTenantOrganizationsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/admin/organizations",
  operationId: "tenantAdministration.listOrganizations",
  summary: "List tenant organizations",
  responses: {
    200: jsonResponse(
      "Tenant organizations",
      dataEnvelope(z.array(TenantOrganizationSummarySchema)),
    ),
    ...errors,
  },
});
export const createTenantOrganizationRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/admin/organizations",
  operationId: "tenantAdministration.createOrganization",
  summary: "Provision a tenant organization",
  request: { body: body(CreateTenantOrganizationSchema) },
  responses: {
    201: jsonResponse(
      "Provisioned tenant",
      dataEnvelope(TenantProvisioningResultSchema),
    ),
    ...errors,
  },
});
export const getTenantOrganizationRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/admin/organizations/{orgId}",
  operationId: "tenantAdministration.getOrganization",
  summary: "Get tenant lifecycle posture",
  request: { params: organizationPath },
  responses: { 200: tenantSummaryResponse, ...errors },
});
export const updateTenantOrganizationRoute = createRoute({
  ...metadata,
  method: "patch",
  path: "/api/v1/admin/organizations/{orgId}",
  operationId: "tenantAdministration.updateOrganization",
  summary: "Update tenant metadata",
  request: {
    params: organizationPath,
    body: body(UpdateTenantOrganizationSchema),
  },
  responses: { 200: tenantSummaryResponse, ...errors },
});
export const suspendTenantOrganizationRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/admin/organizations/{orgId}/suspend",
  operationId: "tenantAdministration.suspendOrganization",
  summary: "Suspend a tenant",
  request: {
    params: organizationPath,
    body: body(TenantOrganizationReasonSchema),
  },
  responses: { 200: tenantSummaryResponse, ...errors },
});
export const reactivateTenantOrganizationRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/admin/organizations/{orgId}/reactivate",
  operationId: "tenantAdministration.reactivateOrganization",
  summary: "Reactivate a tenant",
  request: {
    params: organizationPath,
    body: body(TenantOrganizationConfirmationSchema),
  },
  responses: { 200: tenantSummaryResponse, ...errors },
});
export const requestTenantDeletionRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/admin/organizations/{orgId}/deletion-request",
  operationId: "tenantAdministration.requestDeletion",
  summary: "Request governed tenant deletion",
  request: {
    params: organizationPath,
    body: body(TenantOrganizationReasonSchema),
  },
  responses: { 200: tenantSummaryResponse, ...errors },
});
export const cancelTenantDeletionRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/admin/organizations/{orgId}/deletion-request/cancel",
  operationId: "tenantAdministration.cancelDeletion",
  summary: "Cancel governed tenant deletion",
  request: {
    params: organizationPath,
    body: body(TenantOrganizationConfirmationSchema),
  },
  responses: { 200: tenantSummaryResponse, ...errors },
});
export const previewTenantDeletionFinalizationRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/admin/organizations/{orgId}/deletion-finalization-preview",
  operationId: "tenantAdministration.previewDeletionFinalization",
  summary: "Preview deletion finalization",
  request: { params: organizationPath },
  responses: {
    200: jsonResponse(
      "Deletion finalization preview",
      dataEnvelope(TenantDeletionFinalizationPreviewSchema),
    ),
    ...errors,
  },
});
export const recordTenantDeletionEvidenceRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/admin/organizations/{orgId}/deletion-finalization-evidence",
  operationId: "tenantAdministration.recordDeletionEvidence",
  summary: "Record deletion evidence",
  request: {
    params: organizationPath,
    body: body(TenantDeletionFinalizationEvidenceSchema),
  },
  responses: {
    200: jsonResponse(
      "Deletion finalization preview",
      dataEnvelope(TenantDeletionFinalizationPreviewSchema),
    ),
    ...errors,
  },
});
export const executeTenantDeletionFinalizationRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/admin/organizations/{orgId}/deletion-finalization/execute",
  operationId: "tenantAdministration.executeDeletionFinalization",
  summary: "Execute final tenant deletion",
  request: {
    params: organizationPath,
    body: body(TenantDeletionFinalizationExecuteSchema),
  },
  responses: {
    200: jsonResponse(
      "Tenant purge result",
      dataEnvelope(TenantPhysicalPurgeResultSchema),
    ),
    ...errors,
  },
});

export const tenantAdministrationRoutes = [
  listTenantOrganizationsRoute,
  createTenantOrganizationRoute,
  getTenantOrganizationRoute,
  updateTenantOrganizationRoute,
  suspendTenantOrganizationRoute,
  reactivateTenantOrganizationRoute,
  requestTenantDeletionRoute,
  cancelTenantDeletionRoute,
  previewTenantDeletionFinalizationRoute,
  recordTenantDeletionEvidenceRoute,
  executeTenantDeletionFinalizationRoute,
] as const;
