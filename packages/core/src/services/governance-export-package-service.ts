import { assertScope, type AuthSubject } from "@romeo/auth";
import type { ObjectStore } from "@romeo/storage";

import type {
  DataExportPackageDeleteResult,
  DataExportPackageJob,
  DataExportPackageList,
  DataExportRequest,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { notFound } from "../errors";
import { createId } from "../ids";
import { writeAuditLog } from "./audit-log";
import { authorizeDataExport } from "./capability-consumer-enforcement";
import type { CapabilityService } from "./capability-resolver";
import {
  deleteGovernedDataExportPackageObject,
  enqueueGovernedDataExportPackage,
  getGovernedDataExportPackageJob,
  type DataExportPackageRead,
  listGovernedDataExportPackages,
  prepareGovernedDataExportPackageDelete,
  readGovernedDataExportPackage,
  removeGovernedDataExportPackageRegistration,
} from "./data-export-package";

export class GovernanceExportPackageService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly objectStore: ObjectStore,
    private readonly capabilities: CapabilityService,
  ) {}

  async create(input: {
    subject: AuthSubject;
    request: DataExportRequest;
  }): Promise<DataExportPackageJob> {
    assertScope(input.subject, "admin:read");
    await this.authorize(input.subject, input.request.workspaceId);
    return this.repository.transaction(async (repository) => {
      const packaged = await enqueueGovernedDataExportPackage({
        repository,
        subject: input.subject,
        request: input.request,
      });
      await writeAuditLog(repository, {
        subject: input.subject,
        action: "governance.data_export.package.create",
        resourceType:
          packaged.request.scope === "workspace" ? "workspace" : "organization",
        resourceId: packaged.request.workspaceId ?? input.subject.orgId,
        metadata: {
          scope: packaged.request.scope,
          includeContent: packaged.request.includeContent,
          includeObjectBytes: packaged.request.includeObjectBytes,
          counts: packaged.counts,
          warningCount: packaged.warnings.length,
          packageId: packaged.packageId,
          status: packaged.state,
        },
      });
      return packaged;
    });
  }

  async get(input: {
    subject: AuthSubject;
    packageId: string;
  }): Promise<DataExportPackageJob> {
    assertScope(input.subject, "admin:read");
    await this.authorize(input.subject);
    const job = await this.getStored(input.subject.orgId, input.packageId);
    await this.authorize(input.subject, job.request.workspaceId);
    return job;
  }

  async list(subject: AuthSubject): Promise<DataExportPackageList> {
    assertScope(subject, "admin:read");
    await this.authorize(subject);
    return listGovernedDataExportPackages({
      repository: this.repository,
      orgId: subject.orgId,
    });
  }

  async read(input: {
    subject: AuthSubject;
    packageId: string;
  }): Promise<DataExportPackageRead> {
    const job = await this.get(input);
    await this.authorize(input.subject, job.request.workspaceId);
    return readGovernedDataExportPackage({
      repository: this.repository,
      objectStore: this.objectStore,
      orgId: input.subject.orgId,
      packageId: input.packageId,
    });
  }

  async remove(input: {
    subject: AuthSubject;
    packageId: string;
    confirmPackageId: string;
  }): Promise<DataExportPackageDeleteResult> {
    assertScope(input.subject, "admin:write");
    await this.authorize(input.subject);
    const job = await this.repository.getGovernanceExportJob(
      input.subject.orgId,
      input.packageId,
    );
    if (job === undefined) throw notFound("Data export package");
    await this.authorize(input.subject, job.request.workspaceId);
    const artifact = await this.repository.getGovernanceExportArtifact(
      input.subject.orgId,
      input.packageId,
    );
    const deleted = await prepareGovernedDataExportPackageDelete({
      repository: this.repository,
      objectStore: this.objectStore,
      orgId: input.subject.orgId,
      packageId: input.packageId,
      confirmPackageId: input.confirmPackageId,
    });
    if (job.state !== "deleted") {
      await this.repository.transaction(async (repository) => {
        await removeGovernedDataExportPackageRegistration({
          repository,
          orgId: input.subject.orgId,
          packageId: input.packageId,
          deletedAt: deleted.deletedAt,
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
            contentType: artifact?.contentType ?? "application/x-ndjson",
            objectKeyHash: deleted.storage.objectKeyHash,
            rawObjectKeyReturned: false,
            packageContentReturned: false,
          },
          createdAt: deleted.deletedAt,
        });
      });
    }
    await deleteGovernedDataExportPackageObject({
      repository: this.repository,
      objectStore: this.objectStore,
      orgId: input.subject.orgId,
      packageId: input.packageId,
    });
    return deleted;
  }

  private getStored(orgId: string, packageId: string) {
    return getGovernedDataExportPackageJob({
      repository: this.repository,
      orgId,
      packageId,
    });
  }

  private authorize(subject: AuthSubject, workspaceId?: string) {
    return authorizeDataExport(
      this.capabilities,
      subject,
      workspaceId === undefined ? {} : { workspaceId },
    );
  }
}
