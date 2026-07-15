import type { RomeoTransport } from "../transport";
import type {
  ComplianceReport,
  AccessReviewReport,
  DataDeletionPreview,
  DataDeletionResult,
  DataExportDocument,
  DataExportInput,
  DataExportPackageDeleteResult,
  DataExportPackage,
  DataExportPackageList,
  DataExportPreview,
  DataRightsCoverageReport,
  DeleteDataExportPackageInput,
  ExecuteDataDeletionInput,
  IdentityLifecyclePolicy,
  PreviewDataDeletionInput,
  ResourceGrant,
  RetentionEnforcementResult,
  RetentionPolicy,
  UpdateRetentionPolicyInput,
} from "../types";

export function createGovernanceResource(transport: RomeoTransport) {
  return {
    retentionPolicy: () =>
      transport.data<RetentionPolicy>("GET", "/api/v1/governance/retention"),
    updateRetentionPolicy: (input: UpdateRetentionPolicyInput) =>
      transport.data<RetentionPolicy>(
        "PATCH",
        "/api/v1/governance/retention",
        input,
      ),
    enforceRetention: () =>
      transport.data<RetentionEnforcementResult>(
        "POST",
        "/api/v1/governance/retention/enforce",
      ),
    previewDataDeletion: (input: PreviewDataDeletionInput) =>
      transport.data<DataDeletionPreview>(
        "POST",
        "/api/v1/governance/data-deletions/preview",
        input,
      ),
    executeDataDeletion: (input: ExecuteDataDeletionInput) =>
      transport.data<DataDeletionResult>(
        "POST",
        "/api/v1/governance/data-deletions/execute",
        input,
      ),
    dataRightsCoverage: () =>
      transport.data<DataRightsCoverageReport>(
        "GET",
        "/api/v1/governance/data-rights/coverage",
      ),
    previewDataExport: (input: DataExportInput) =>
      transport.data<DataExportPreview>(
        "POST",
        "/api/v1/governance/data-exports/preview",
        input,
      ),
    executeDataExport: (input: DataExportInput) =>
      transport.data<DataExportDocument>(
        "POST",
        "/api/v1/governance/data-exports/execute",
        input,
      ),
    listDataExportPackages: () =>
      transport.data<DataExportPackageList>(
        "GET",
        "/api/v1/governance/data-exports/packages",
      ),
    createDataExportPackage: (input: DataExportInput) =>
      transport.data<DataExportPackage>(
        "POST",
        "/api/v1/governance/data-exports/packages",
        input,
      ),
    deleteDataExportPackage: (
      packageId: string,
      input: DeleteDataExportPackageInput,
    ) =>
      transport.data<DataExportPackageDeleteResult>(
        "DELETE",
        `/api/v1/governance/data-exports/packages/${encodeURIComponent(
          packageId,
        )}`,
        input,
      ),
    downloadDataExportPackage: (packageId: string) =>
      transport.text(
        "GET",
        `/api/v1/governance/data-exports/packages/${encodeURIComponent(
          packageId,
        )}/content`,
        "application/json",
      ),
    complianceReport: () =>
      transport.data<ComplianceReport>(
        "GET",
        "/api/v1/governance/compliance-report",
      ),
    complianceReportCsv: () =>
      transport.text(
        "GET",
        "/api/v1/governance/compliance-report.csv",
        "text/csv",
      ),
    accessReview: () =>
      transport.data<ResourceGrant[]>("GET", "/api/v1/access-review"),
    accessReviewCsv: () =>
      transport.text("GET", "/api/v1/access-review.csv", "text/csv"),
    accessReviewReport: () =>
      transport.data<AccessReviewReport>("GET", "/api/v1/access-review/report"),
    accessReviewReportCsv: () =>
      transport.text("GET", "/api/v1/access-review/report.csv", "text/csv"),
    identityLifecyclePolicy: () =>
      transport.data<IdentityLifecyclePolicy>(
        "GET",
        "/api/v1/governance/identity-lifecycle-policy",
      ),
  };
}
