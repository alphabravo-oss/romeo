import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";
import {
  ResourceGrantSchema,
  AccessReviewReportSchema,
  IdentityLifecyclePolicySchema,
} from "./governance-access-schemas";
import {
  RetentionPolicySchema,
  UpdateRetentionPolicyRequestSchema,
  RetentionEnforcementResultSchema,
  GovernanceDataDeletionPreviewSchema,
  GovernanceDataDeletionResultSchema,
  PreviewDataDeletionRequestSchema,
  ExecuteDataDeletionRequestSchema,
  DataExportRequestSchema,
  DataExportPreviewSchema,
  DataExportDocumentSchema,
  DataExportPackageSchema,
  DataExportPackageListSchema,
  DeleteDataExportPackageRequestSchema,
  DataExportPackageDeleteResultSchema,
  DataRightsCoverageReportSchema,
  ComplianceReportSchema,
} from "./governance-data-schemas";
import { governanceIdentifier as identifier } from "./governance-schema-primitives";

export {
  AccessReviewReportSchema,
  IdentityLifecyclePolicySchema,
} from "./governance-access-schemas";
export {
  ComplianceReportSchema,
  DataExportPackageDeleteResultSchema,
  DataExportPackageListSchema,
  DataExportPackageSchema,
  DataExportPreviewSchema,
  DataExportRequestSchema,
  DataRightsCoverageReportSchema,
  DataRightsRetentionEvidenceSummarySchema,
  DeleteDataExportPackageRequestSchema,
  ExecuteDataDeletionRequestSchema,
  GovernanceDataDeletionPreviewSchema,
  GovernanceDataDeletionResultSchema,
  PreviewDataDeletionRequestSchema,
  RetentionEnforcementResultSchema,
  RetentionPolicySchema,
  UpdateRetentionPolicyRequestSchema,
} from "./governance-data-schemas";

const body = <T extends z.ZodType>(schema: T) => ({
  required: true as const,
  content: { "application/json": { schema } },
});
const textResponse = (description: string, contentType = "text/csv") => ({
  description,
  content: { [contentType]: { schema: z.string() } },
});

const metadata = { tags: ["Governance"], security: authenticationSecurity };
const packageParams = z.strictObject({ packageId: identifier });
const routes = {
  getRetention: createRoute({
    ...metadata,
    method: "get",
    path: "/api/v1/governance/retention",
    operationId: "governance.getRetentionPolicy",
    summary: "Get governance retention policy",
    responses: {
      200: jsonResponse(
        "Retention policy",
        dataEnvelope(RetentionPolicySchema),
      ),
      ...standardErrorResponses,
    },
  }),
  updateRetention: createRoute({
    ...metadata,
    method: "patch",
    path: "/api/v1/governance/retention",
    operationId: "governance.updateRetentionPolicy",
    summary: "Update governance retention policy",
    request: { body: body(UpdateRetentionPolicyRequestSchema) },
    responses: {
      200: jsonResponse(
        "Retention policy",
        dataEnvelope(RetentionPolicySchema),
      ),
      ...standardErrorResponses,
    },
  }),
  enforceRetention: createRoute({
    ...metadata,
    method: "post",
    path: "/api/v1/governance/retention/enforce",
    operationId: "governance.enforceRetention",
    summary: "Enforce organization retention policy",
    responses: {
      200: jsonResponse(
        "Retention enforcement result",
        dataEnvelope(RetentionEnforcementResultSchema),
      ),
      ...standardErrorResponses,
    },
  }),
  previewDeletion: createRoute({
    ...metadata,
    method: "post",
    path: "/api/v1/governance/data-deletions/preview",
    operationId: "governance.previewDataDeletion",
    summary: "Preview governed resource deletion",
    request: { body: body(PreviewDataDeletionRequestSchema) },
    responses: {
      200: jsonResponse(
        "Data deletion preview",
        dataEnvelope(GovernanceDataDeletionPreviewSchema),
      ),
      ...standardErrorResponses,
    },
  }),
  executeDeletion: createRoute({
    ...metadata,
    method: "post",
    path: "/api/v1/governance/data-deletions/execute",
    operationId: "governance.executeDataDeletion",
    summary: "Execute governed resource deletion",
    request: { body: body(ExecuteDataDeletionRequestSchema) },
    responses: {
      200: jsonResponse(
        "Data deletion result",
        dataEnvelope(GovernanceDataDeletionResultSchema),
      ),
      ...standardErrorResponses,
    },
  }),
  coverage: createRoute({
    ...metadata,
    method: "get",
    path: "/api/v1/governance/data-rights/coverage",
    operationId: "governance.getDataRightsCoverage",
    summary: "Get data-rights workflow coverage",
    responses: {
      200: jsonResponse(
        "Data-rights coverage",
        dataEnvelope(DataRightsCoverageReportSchema),
      ),
      ...standardErrorResponses,
    },
  }),
  previewExport: createRoute({
    ...metadata,
    method: "post",
    path: "/api/v1/governance/data-exports/preview",
    operationId: "governance.previewDataExport",
    summary: "Preview a governed data export",
    request: { body: body(DataExportRequestSchema) },
    responses: {
      200: jsonResponse(
        "Data export preview",
        dataEnvelope(DataExportPreviewSchema),
      ),
      ...standardErrorResponses,
    },
  }),
  executeExport: createRoute({
    ...metadata,
    method: "post",
    path: "/api/v1/governance/data-exports/execute",
    operationId: "governance.executeDataExport",
    summary: "Execute a governed data export",
    request: { body: body(DataExportRequestSchema) },
    responses: {
      200: jsonResponse(
        "Data export document",
        dataEnvelope(DataExportDocumentSchema),
      ),
      ...standardErrorResponses,
    },
  }),
  listPackages: createRoute({
    ...metadata,
    method: "get",
    path: "/api/v1/governance/data-exports/packages",
    operationId: "governance.listDataExportPackages",
    summary: "List governed data-export packages",
    responses: {
      200: jsonResponse(
        "Data-export packages",
        dataEnvelope(DataExportPackageListSchema),
      ),
      ...standardErrorResponses,
    },
  }),
  createPackage: createRoute({
    ...metadata,
    method: "post",
    path: "/api/v1/governance/data-exports/packages",
    operationId: "governance.createDataExportPackage",
    summary: "Create a governed data-export package",
    request: { body: body(DataExportRequestSchema) },
    responses: {
      200: jsonResponse(
        "Data-export package",
        dataEnvelope(DataExportPackageSchema),
      ),
      ...standardErrorResponses,
    },
  }),
  deletePackage: createRoute({
    ...metadata,
    method: "delete",
    path: "/api/v1/governance/data-exports/packages/{packageId}",
    operationId: "governance.deleteDataExportPackage",
    summary: "Delete a governed data-export package",
    request: {
      params: packageParams,
      body: body(DeleteDataExportPackageRequestSchema),
    },
    responses: {
      200: jsonResponse(
        "Deleted data-export package",
        dataEnvelope(DataExportPackageDeleteResultSchema),
      ),
      ...standardErrorResponses,
    },
  }),
  readPackage: createRoute({
    ...metadata,
    method: "get",
    path: "/api/v1/governance/data-exports/packages/{packageId}/content",
    operationId: "governance.readDataExportPackage",
    summary: "Download governed data-export package content",
    request: { params: packageParams },
    responses: {
      200: textResponse("Data-export package content", "application/json"),
      ...standardErrorResponses,
    },
  }),
  compliance: createRoute({
    ...metadata,
    method: "get",
    path: "/api/v1/governance/compliance-report",
    operationId: "governance.getComplianceReport",
    summary: "Get compliance report",
    responses: {
      200: jsonResponse(
        "Compliance report",
        dataEnvelope(ComplianceReportSchema),
      ),
      ...standardErrorResponses,
    },
  }),
  complianceCsv: createRoute({
    ...metadata,
    method: "get",
    path: "/api/v1/governance/compliance-report.csv",
    operationId: "governance.exportComplianceReportCsv",
    summary: "Export compliance report as CSV",
    responses: {
      200: textResponse("Compliance report CSV"),
      ...standardErrorResponses,
    },
  }),
  access: createRoute({
    ...metadata,
    method: "get",
    path: "/api/v1/access-review",
    operationId: "governance.listAccessReviewGrants",
    summary: "List access-review resource grants",
    responses: {
      200: jsonResponse(
        "Access-review grants",
        dataEnvelope(z.array(ResourceGrantSchema)),
      ),
      ...standardErrorResponses,
    },
  }),
  accessCsv: createRoute({
    ...metadata,
    method: "get",
    path: "/api/v1/access-review.csv",
    operationId: "governance.exportAccessReviewCsv",
    summary: "Export access-review grants as CSV",
    responses: {
      200: textResponse("Access-review CSV"),
      ...standardErrorResponses,
    },
  }),
  accessReport: createRoute({
    ...metadata,
    method: "get",
    path: "/api/v1/access-review/report",
    operationId: "governance.getAccessReviewReport",
    summary: "Get comprehensive access-review report",
    responses: {
      200: jsonResponse(
        "Access-review report",
        dataEnvelope(AccessReviewReportSchema),
      ),
      ...standardErrorResponses,
    },
  }),
  accessReportCsv: createRoute({
    ...metadata,
    method: "get",
    path: "/api/v1/access-review/report.csv",
    operationId: "governance.exportAccessReviewReportCsv",
    summary: "Export access-review report as CSV",
    responses: {
      200: textResponse("Access-review report CSV"),
      ...standardErrorResponses,
    },
  }),
  identityLifecycle: createRoute({
    ...metadata,
    method: "get",
    path: "/api/v1/governance/identity-lifecycle-policy",
    operationId: "governance.getIdentityLifecyclePolicy",
    summary: "Get identity lifecycle policy",
    responses: {
      200: jsonResponse(
        "Identity lifecycle policy",
        dataEnvelope(IdentityLifecyclePolicySchema),
      ),
      ...standardErrorResponses,
    },
  }),
};

export const {
  getRetention: getRetentionPolicyRoute,
  updateRetention: updateRetentionPolicyRoute,
  enforceRetention: enforceRetentionRoute,
  previewDeletion: previewDataDeletionRoute,
  executeDeletion: executeDataDeletionRoute,
  coverage: getDataRightsCoverageRoute,
  previewExport: previewDataExportRoute,
  executeExport: executeDataExportRoute,
  listPackages: listDataExportPackagesRoute,
  createPackage: createDataExportPackageRoute,
  deletePackage: deleteDataExportPackageRoute,
  readPackage: readDataExportPackageRoute,
  compliance: getComplianceReportRoute,
  complianceCsv: exportComplianceReportCsvRoute,
  access: listAccessReviewGrantsRoute,
  accessCsv: exportAccessReviewCsvRoute,
  accessReport: getAccessReviewReportRoute,
  accessReportCsv: exportAccessReviewReportCsvRoute,
  identityLifecycle: getIdentityLifecyclePolicyRoute,
} = routes;
export const governanceRoutes = [
  getRetentionPolicyRoute,
  updateRetentionPolicyRoute,
  enforceRetentionRoute,
  previewDataDeletionRoute,
  executeDataDeletionRoute,
  getDataRightsCoverageRoute,
  previewDataExportRoute,
  executeDataExportRoute,
  listDataExportPackagesRoute,
  createDataExportPackageRoute,
  deleteDataExportPackageRoute,
  readDataExportPackageRoute,
  getComplianceReportRoute,
  exportComplianceReportCsvRoute,
  listAccessReviewGrantsRoute,
  exportAccessReviewCsvRoute,
  getAccessReviewReportRoute,
  exportAccessReviewReportCsvRoute,
  getIdentityLifecyclePolicyRoute,
] as const;
