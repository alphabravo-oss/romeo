import { assertScope, type AuthSubject, type ResourceGrant } from "@romeo/auth";
import type {
  AccessReviewReport,
  ComplianceReport,
  DataDeletionPlan,
  DataDeletionPreview,
  DataDeletionResourceType,
  DataDeletionResult,
  DataExportDocument,
  DataExportPackageDeleteResult,
  DataExportPackage,
  DataExportPackageList,
  DataExportPreview,
  DataExportRequest,
  DataRightsCoverageReport,
  IdentityLifecyclePolicy,
} from "../domain/entities";
import { ApiError } from "../errors";
import { createId } from "../ids";
import {
  accessReviewReportCsv,
  buildAccessReviewReport,
} from "./access-review-report";
import {
  buildComplianceReport,
  complianceReportCsv,
} from "./compliance-report";
import { executeDataExport, previewDataExport } from "./data-export";
import {
  createGovernedDataExportPackage,
  deleteGovernedDataExportPackageObject,
  type DataExportPackageRead,
  listGovernedDataExportPackages,
  prepareGovernedDataExportPackageDelete,
  readGovernedDataExportPackage,
  registerGovernedDataExportPackage,
  removeGovernedDataExportPackageRegistration,
} from "./data-export-package";
import { buildDataRightsCoverageReport } from "./data-rights-coverage";
import {
  defaultDataRightsRetentionEvidence,
  readDataRightsRetentionEvidence,
} from "./data-rights-retention-evidence";
import { deleteFileObjectStoredObjects } from "./file-service";
import { buildIdentityLifecyclePolicy } from "./identity-lifecycle-policy";
import { GovernanceRetentionService } from "./governance-retention-service";

export * from "./governance-retention-service";

export class GovernanceService extends GovernanceRetentionService {
  async previewDataDeletion(input: {
    subject: AuthSubject;
    resourceType: DataDeletionResourceType;
    resourceId: string;
  }): Promise<DataDeletionPreview> {
    assertScope(input.subject, "admin:read");
    const plan = await this.repository.getDataDeletionPlan(
      input.subject.orgId,
      input.resourceType,
      input.resourceId,
    );
    if (!plan) throw notFoundDeletionResource(input.resourceType);
    return {
      schema: "romeo.data-deletion-preview.v1",
      ...plan,
      previewedAt: new Date().toISOString(),
    };
  }

  async executeDataDeletion(input: {
    subject: AuthSubject;
    resourceType: DataDeletionResourceType;
    resourceId: string;
    confirmResourceId: string;
  }): Promise<DataDeletionResult> {
    assertScope(input.subject, "admin:write");
    if (input.confirmResourceId !== input.resourceId) {
      throw new ApiError(
        "data_deletion_confirmation_mismatch",
        "confirmResourceId must exactly match resourceId.",
        400,
      );
    }

    const plan = await this.repository.getDataDeletionPlan(
      input.subject.orgId,
      input.resourceType,
      input.resourceId,
    );
    if (!plan) throw notFoundDeletionResource(input.resourceType);
    if (plan.legalHold !== undefined) {
      throw new ApiError(
        "data_deletion_legal_hold",
        "Resource is under legal hold and cannot be deleted.",
        409,
        {
          legalHoldUntil: plan.legalHold.until,
        },
      );
    }
    const deletedAt = new Date().toISOString();
    if (input.resourceType === "knowledge_source") {
      return this.executeKnowledgeSourceDataDeletion(input, plan, deletedAt);
    }
    if (input.resourceType === "file_object") {
      await this.deleteFileObjectStorage(input.subject.orgId, input.resourceId);
    }

    const deleted = await this.repository.transaction(async (repository) => {
      const deletion = await repository.deleteDataForResource(
        input.subject.orgId,
        input.resourceType,
        input.resourceId,
      );
      if (!deletion) throw notFoundDeletionResource(input.resourceType);
      await writeAuditLog(repository, {
        id: createId("audit"),
        orgId: input.subject.orgId,
        actorId: input.subject.id,
        action: "governance.data_deletion.execute",
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        outcome: "success",
        metadata: {
          workspaceId: deletion.workspaceId,
          counts: deletion.counts,
        },
        createdAt: deletedAt,
      });
      return deletion;
    });
    return {
      schema: "romeo.data-deletion-result.v1",
      ...deleted,
      deletedAt,
    };
  }

  private async deleteFileObjectStorage(
    orgId: string,
    fileId: string,
  ): Promise<void> {
    const file = await this.repository.getFileObject(fileId);
    if (
      file === undefined ||
      file.orgId !== orgId ||
      file.status === "deleted"
    ) {
      return;
    }
    await deleteFileObjectStoredObjects(this.objectStore, file);
  }

  private async executeKnowledgeSourceDataDeletion(
    input: {
      subject: AuthSubject;
      resourceType: DataDeletionResourceType;
      resourceId: string;
    },
    plan: DataDeletionPlan,
    deletedAt: string,
  ): Promise<DataDeletionResult> {
    if (plan.knowledgeBaseId === undefined) {
      throw new ApiError(
        "data_deletion_plan_invalid",
        "Knowledge source deletion plan is missing its knowledge base.",
        500,
      );
    }
    if (this.options.deleteKnowledgeSource === undefined) {
      throw new ApiError(
        "data_deletion_not_configured",
        "Knowledge source deletion is not configured for this runtime.",
        500,
      );
    }
    await this.options.deleteKnowledgeSource({
      subject: input.subject,
      knowledgeBaseId: plan.knowledgeBaseId,
      sourceId: input.resourceId,
    });
    await writeAuditLog(this.repository, {
      id: createId("audit"),
      orgId: input.subject.orgId,
      actorId: input.subject.id,
      action: "governance.data_deletion.execute",
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      outcome: "success",
      metadata: {
        workspaceId: plan.workspaceId,
        knowledgeBaseId: plan.knowledgeBaseId,
        counts: plan.counts,
      },
      createdAt: deletedAt,
    });
    return {
      schema: "romeo.data-deletion-result.v1",
      ...plan,
      deletedAt,
    };
  }

  async dataRightsCoverage(
    subject: AuthSubject,
  ): Promise<DataRightsCoverageReport> {
    assertScope(subject, "admin:read");
    return buildDataRightsCoverageReport({
      orgId: subject.orgId,
      generatedAt: new Date().toISOString(),
      retentionEvidence:
        this.options.env === undefined
          ? defaultDataRightsRetentionEvidence()
          : await readDataRightsRetentionEvidence(this.options.env),
    });
  }

  async previewDataExport(input: {
    subject: AuthSubject;
    request: DataExportRequest;
  }): Promise<DataExportPreview> {
    assertScope(input.subject, "admin:read");
    return previewDataExport({
      repository: this.repository,
      subject: input.subject,
      request: input.request,
    });
  }

  async executeDataExport(input: {
    subject: AuthSubject;
    request: DataExportRequest;
  }): Promise<DataExportDocument> {
    assertScope(input.subject, "admin:read");
    const exported = await executeDataExport({
      repository: this.repository,
      objectStore: this.objectStore,
      subject: input.subject,
      request: input.request,
    });
    await writeAuditLog(this.repository, {
      id: createId("audit"),
      orgId: input.subject.orgId,
      actorId: input.subject.id,
      action: "governance.data_export.execute",
      resourceType:
        exported.request.scope === "workspace" ? "workspace" : "organization",
      resourceId: exported.request.workspaceId ?? input.subject.orgId,
      outcome: "success",
      metadata: {
        scope: exported.request.scope,
        includeContent: exported.request.includeContent,
        includeObjectBytes: exported.request.includeObjectBytes,
        counts: exported.counts,
        warningCount: exported.warnings.length,
      },
      createdAt: exported.exportedAt,
    });
    return exported;
  }

  async createDataExportPackage(input: {
    subject: AuthSubject;
    request: DataExportRequest;
  }): Promise<DataExportPackage> {
    assertScope(input.subject, "admin:read");
    const packaged = await createGovernedDataExportPackage({
      repository: this.repository,
      objectStore: this.objectStore,
      subject: input.subject,
      request: input.request,
      register: false,
    });
    try {
      await this.repository.transaction(async (repository) => {
        await registerGovernedDataExportPackage({
          repository,
          package: packaged,
        });
        await writeAuditLog(repository, {
          id: createId("audit"),
          orgId: input.subject.orgId,
          actorId: input.subject.id,
          action: "governance.data_export.package.create",
          resourceType:
            packaged.request.scope === "workspace"
              ? "workspace"
              : "organization",
          resourceId: packaged.request.workspaceId ?? input.subject.orgId,
          outcome: "success",
          metadata: {
            scope: packaged.request.scope,
            includeContent: packaged.request.includeContent,
            includeObjectBytes: packaged.request.includeObjectBytes,
            counts: packaged.counts,
            warningCount: packaged.warnings.length,
            packageId: packaged.packageId,
            contentType: packaged.artifact.contentType,
            sizeBytes: packaged.artifact.sizeBytes,
            sha256: packaged.artifact.sha256,
            objectKeyHash: packaged.artifact.storage.objectKeyHash,
            rawObjectKeyReturned: false,
          },
          createdAt: packaged.createdAt,
        });
      });
    } catch (error) {
      await deleteGovernedDataExportPackageObject({
        objectStore: this.objectStore,
        orgId: input.subject.orgId,
        packageId: packaged.packageId,
      }).catch(() => {});
      throw error;
    }
    return packaged;
  }

  async listDataExportPackages(
    subject: AuthSubject,
  ): Promise<DataExportPackageList> {
    assertScope(subject, "admin:read");
    return listGovernedDataExportPackages({
      repository: this.repository,
      orgId: subject.orgId,
    });
  }

  async readDataExportPackage(input: {
    subject: AuthSubject;
    packageId: string;
  }): Promise<DataExportPackageRead> {
    assertScope(input.subject, "admin:read");
    return readGovernedDataExportPackage({
      objectStore: this.objectStore,
      orgId: input.subject.orgId,
      packageId: input.packageId,
    });
  }

  async deleteDataExportPackage(input: {
    subject: AuthSubject;
    packageId: string;
    confirmPackageId: string;
  }): Promise<DataExportPackageDeleteResult> {
    assertScope(input.subject, "admin:write");
    const deleted = await prepareGovernedDataExportPackageDelete({
      objectStore: this.objectStore,
      orgId: input.subject.orgId,
      packageId: input.packageId,
      confirmPackageId: input.confirmPackageId,
    });
    await this.repository.transaction(async (repository) => {
      await removeGovernedDataExportPackageRegistration({
        repository,
        orgId: input.subject.orgId,
        packageId: input.packageId,
      });
      await writeAuditLog(repository, {
        id: createId("audit"),
        orgId: input.subject.orgId,
        actorId: input.subject.id,
        action: "governance.data_export.package.delete",
        resourceType: "organization",
        resourceId: input.subject.orgId,
        outcome: "success",
        metadata: {
          packageId: deleted.packageId,
          contentType: "application/json",
          objectKeyHash: deleted.storage.objectKeyHash,
          rawObjectKeyReturned: false,
          packageContentReturned: false,
        },
        createdAt: deleted.deletedAt,
      });
    });
    await deleteGovernedDataExportPackageObject({
      objectStore: this.objectStore,
      orgId: input.subject.orgId,
      packageId: input.packageId,
    });
    return deleted;
  }

  async accessReview(subject: AuthSubject): Promise<ResourceGrant[]> {
    assertScope(subject, "admin:read");
    return (await this.repository.listResourceGrants(subject.orgId)).sort(
      (left, right) => {
        const leftKey = `${left.resourceType}:${left.resourceId}:${left.principalType}:${left.principalId}:${left.permission}`;
        const rightKey = `${right.resourceType}:${right.resourceId}:${right.principalType}:${right.principalId}:${right.permission}`;
        return leftKey.localeCompare(rightKey);
      },
    );
  }

  async accessReviewCsv(subject: AuthSubject): Promise<string> {
    const rows = await this.accessReview(subject);
    return (
      [
        [
          "id",
          "resource_type",
          "resource_id",
          "principal_type",
          "principal_id",
          "permission",
        ],
        ...rows.map((grant) => [
          grant.id,
          grant.resourceType,
          grant.resourceId,
          grant.principalType,
          grant.principalId,
          grant.permission,
        ]),
      ]
        .map((row) => row.map(csvCell).join(","))
        .join("\n") + "\n"
    );
  }

  async accessReviewReport(subject: AuthSubject): Promise<AccessReviewReport> {
    assertScope(subject, "admin:read");
    return buildAccessReviewReport(this.repository, subject.orgId, {
      scimEnabled: this.options.scimEnabled,
    });
  }

  async accessReviewReportCsv(subject: AuthSubject): Promise<string> {
    return accessReviewReportCsv(await this.accessReviewReport(subject));
  }

  async identityLifecyclePolicy(
    subject: AuthSubject,
  ): Promise<IdentityLifecyclePolicy> {
    assertScope(subject, "admin:read");
    return buildIdentityLifecyclePolicy(subject.orgId, {
      scimEnabled: this.options.scimEnabled,
    });
  }

  async complianceReport(subject: AuthSubject): Promise<ComplianceReport> {
    assertScope(subject, "admin:read");
    return buildComplianceReport(this.repository, subject);
  }

  async complianceReportCsv(subject: AuthSubject): Promise<string> {
    return complianceReportCsv(await this.complianceReport(subject));
  }
}

function csvCell(value: string): string {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function notFoundDeletionResource(
  resourceType: DataDeletionResourceType,
): ApiError {
  return new ApiError(
    "not_found",
    `${resourceType} deletion target was not found.`,
    404,
  );
}
import { writeAuditLog } from "./audit-log";
