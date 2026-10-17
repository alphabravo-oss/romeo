import { assertScope, type AuthSubject, type ResourceGrant } from "@romeo/auth";
import type { ObjectStore } from "@romeo/storage";
import type {
  AccessReviewReport,
  ComplianceReport,
  DataDeletionPlan,
  DataDeletionPreview,
  DataDeletionResourceType,
  DataDeletionResult,
  DataExportDocument,
  DataExportPreview,
  DataExportRequest,
  DataRightsCoverageReport,
  IdentityLifecyclePolicy,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
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
import { buildDataRightsCoverageReport } from "./data-rights-coverage";
import { ContentDeletionService } from "./content-deletion-service";
import { buildIdentityLifecyclePolicy } from "./identity-lifecycle-policy";
import {
  GovernanceRetentionService,
  type GovernanceServiceOptions,
} from "./governance-retention-service";
import { authorizeDataExport } from "./capability-consumer-enforcement";
import { CapabilityService } from "./capability-resolver";
import { GovernanceExportPackageService } from "./governance-export-package-service";

export * from "./governance-retention-service";

export class GovernanceService extends GovernanceRetentionService {
  private readonly exportPackages: GovernanceExportPackageService;

  constructor(
    repository: RomeoRepository,
    objectStore: ObjectStore,
    options: GovernanceServiceOptions = {},
  ) {
    const capabilities =
      options.capabilities ?? new CapabilityService(repository);
    super(repository, objectStore, { ...options, capabilities });
    this.exportPackages = new GovernanceExportPackageService(
      repository,
      objectStore,
      capabilities,
    );
  }
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
      const file = await this.repository.getFileObject(input.resourceId);
      if (file === undefined || file.orgId !== input.subject.orgId)
        throw notFoundDeletionResource(input.resourceType);
      const operation = await new ContentDeletionService(
        this.repository,
        this.objectStore,
      ).enqueueFile(input.subject, file);
      return {
        schema: "romeo.data-deletion-pending-result.v1",
        ...plan,
        status: "pending",
        operationId: operation.id,
        deletionRequestedAt: deletedAt,
      };
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
    const operation = await this.repository.getActiveContentDeletionOperation(
      input.subject.orgId,
      "knowledge_source",
      input.resourceId,
    );
    if (operation === undefined)
      throw new ApiError(
        "data_deletion_not_configured",
        "Knowledge source deletion did not create a durable operation.",
        500,
      );
    return {
      schema: "romeo.data-deletion-pending-result.v1",
      ...plan,
      status: "pending",
      operationId: operation.id,
      deletionRequestedAt: deletedAt,
    };
  }

  async dataRightsCoverage(
    subject: AuthSubject,
  ): Promise<DataRightsCoverageReport> {
    assertScope(subject, "admin:read");
    return buildDataRightsCoverageReport({
      orgId: subject.orgId,
      generatedAt: new Date().toISOString(),
    });
  }

  async previewDataExport(input: {
    subject: AuthSubject;
    request: DataExportRequest;
  }): Promise<DataExportPreview> {
    assertScope(input.subject, "admin:read");
    await authorizeDataExport(
      this.options.capabilities,
      input.subject,
      input.request.workspaceId === undefined
        ? {}
        : { workspaceId: input.request.workspaceId },
    );
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
    await authorizeDataExport(
      this.options.capabilities,
      input.subject,
      input.request.workspaceId === undefined
        ? {}
        : { workspaceId: input.request.workspaceId },
    );
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
  }) {
    return this.exportPackages.create(input);
  }

  async getDataExportPackage(input: {
    subject: AuthSubject;
    packageId: string;
  }) {
    return this.exportPackages.get(input);
  }

  async listDataExportPackages(subject: AuthSubject) {
    return this.exportPackages.list(subject);
  }

  async readDataExportPackage(input: {
    subject: AuthSubject;
    packageId: string;
  }) {
    return this.exportPackages.read(input);
  }

  async deleteDataExportPackage(input: {
    subject: AuthSubject;
    packageId: string;
    confirmPackageId: string;
  }) {
    return this.exportPackages.remove(input);
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
    await authorizeDataExport(this.options.capabilities, subject);
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
    await authorizeDataExport(this.options.capabilities, subject);
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
    await authorizeDataExport(this.options.capabilities, subject);
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
