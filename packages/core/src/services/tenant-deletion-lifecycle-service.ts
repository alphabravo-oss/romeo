import type { AuthSubject } from "@romeo/auth";
import { disabledObjectStore, type ObjectStore } from "@romeo/storage";

import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { writeAuditLog } from "./audit-log";
import { AbuseControlService } from "./abuse-control-service";
import {
  buildTenantDeletionFinalizationPreview,
  recordTenantDeletionFinalizationEvidence,
  type TenantDeletionEvidenceInput,
  type TenantDeletionFinalizationPreview,
} from "./tenant-deletion-finalization";
import {
  executeTenantPhysicalPurge,
  type TenantPhysicalPurgeResult,
} from "./tenant-physical-purge";
import {
  assertTenantConfirmed,
  assertTenantGlobalAdmin,
  deletionRequestKey,
  normalizeReasonCode,
  readTenantDeletionRequest,
  requireTenantOrganization,
  tenantSummaryForOrganization,
} from "./tenant-admin-support";
import type { TenantAdminOrganizationSummary } from "./tenant-admin-types";

export class TenantDeletionLifecycleService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly abuseControls: AbuseControlService,
    private readonly objectStore: ObjectStore = disabledObjectStore,
  ) {}

  async requestDeletion(input: {
    subject: AuthSubject;
    orgId: string;
    confirmOrgId: string;
    reasonCode: string;
  }): Promise<TenantAdminOrganizationSummary> {
    assertTenantGlobalAdmin(input.subject);
    assertTenantConfirmed(input.orgId, input.confirmOrgId);
    const organization = await requireTenantOrganization(
      this.repository,
      input.orgId,
    );
    const reasonCode = normalizeReasonCode(input.reasonCode);
    const now = new Date().toISOString();
    return this.repository.transaction(async (repository) => {
      await repository.upsertSystemSetting({
        key: deletionRequestKey(input.orgId),
        updatedAt: now,
        value: {
          schemaVersion: "romeo.tenant-deletion-request.v1",
          orgId: input.orgId,
          status: "requested",
          reasonCode,
          requestedAt: now,
          requestedBy: input.subject.id,
        },
      });
      await this.abuseControlService(repository).updateForOrg({
        subject: input.subject,
        orgId: input.orgId,
        policy: { suspension: { suspended: true, reasonCode } },
      });
      await writeAuditLog(repository, {
        subject: input.subject,
        action: "admin.organization.deletion_request",
        resourceType: "organization",
        resourceId: input.orgId,
        metadata: {
          reasonCode,
          suspended: true,
          finalDeletionSupported: true,
        },
      });
      return tenantSummaryForOrganization(repository, organization);
    });
  }

  async cancelDeletionRequest(input: {
    subject: AuthSubject;
    orgId: string;
    confirmOrgId: string;
  }): Promise<TenantAdminOrganizationSummary> {
    assertTenantGlobalAdmin(input.subject);
    assertTenantConfirmed(input.orgId, input.confirmOrgId);
    const organization = await requireTenantOrganization(
      this.repository,
      input.orgId,
    );
    const existing = await readTenantDeletionRequest(
      this.repository,
      input.orgId,
    );
    if (existing === undefined || existing.status === "cancelled") {
      return tenantSummaryForOrganization(this.repository, organization);
    }
    const now = new Date().toISOString();
    return this.repository.transaction(async (repository) => {
      await repository.upsertSystemSetting({
        key: deletionRequestKey(input.orgId),
        updatedAt: now,
        value: {
          schemaVersion: "romeo.tenant-deletion-request.v1",
          orgId: input.orgId,
          ...existing,
          status: "cancelled",
          cancelledAt: now,
          cancelledBy: input.subject.id,
        },
      });
      await writeAuditLog(repository, {
        subject: input.subject,
        action: "admin.organization.deletion_request.cancel",
        resourceType: "organization",
        resourceId: input.orgId,
        metadata: { cancelled: true },
      });
      return tenantSummaryForOrganization(repository, organization);
    });
  }

  async deletionFinalizationPreview(input: {
    subject: AuthSubject;
    orgId: string;
  }): Promise<TenantDeletionFinalizationPreview> {
    assertTenantGlobalAdmin(input.subject);
    const organization = await requireTenantOrganization(
      this.repository,
      input.orgId,
    );
    const summary = await tenantSummaryForOrganization(
      this.repository,
      organization,
    );
    return buildTenantDeletionFinalizationPreview({
      organization,
      repository: this.repository,
      suspension: summary.suspension,
      ...(summary.deletionRequest === undefined
        ? {}
        : { deletionRequest: summary.deletionRequest }),
    });
  }

  async recordDeletionFinalizationEvidence(input: {
    subject: AuthSubject;
    orgId: string;
    confirmOrgId: string;
    controls: TenantDeletionEvidenceInput[];
  }): Promise<TenantDeletionFinalizationPreview> {
    assertTenantGlobalAdmin(input.subject);
    assertTenantConfirmed(input.orgId, input.confirmOrgId);
    const organization = await requireTenantOrganization(
      this.repository,
      input.orgId,
    );
    const reviewedAt = new Date().toISOString();
    return this.repository.transaction(async (repository) => {
      await recordTenantDeletionFinalizationEvidence({
        controls: input.controls,
        orgId: input.orgId,
        repository,
        reviewedAt,
        reviewedBy: input.subject.id,
      });
      await writeAuditLog(repository, {
        subject: input.subject,
        action: "admin.organization.deletion_finalization_evidence",
        resourceType: "organization",
        resourceId: input.orgId,
        metadata: {
          controlCount: input.controls.length,
          controls: input.controls.map((control) => ({
            control: control.control,
            status: control.status,
            evidenceRefHashConfigured: control.evidenceRefHash !== undefined,
          })),
          rawEvidenceReturned: false,
        },
      });
      const summary = await tenantSummaryForOrganization(
        repository,
        organization,
      );
      return buildTenantDeletionFinalizationPreview({
        organization,
        repository,
        suspension: summary.suspension,
        ...(summary.deletionRequest === undefined
          ? {}
          : { deletionRequest: summary.deletionRequest }),
      });
    });
  }

  async executeDeletionFinalization(input: {
    subject: AuthSubject;
    orgId: string;
    confirmOrgId: string;
    confirmPermanentDeletion: true;
  }): Promise<TenantPhysicalPurgeResult> {
    assertTenantGlobalAdmin(input.subject);
    assertTenantConfirmed(input.orgId, input.confirmOrgId);
    if (input.confirmPermanentDeletion !== true) {
      throw new ApiError(
        "tenant_purge_confirmation_required",
        "Final tenant deletion requires explicit permanent-deletion confirmation.",
        400,
      );
    }
    const organization = await requireTenantOrganization(
      this.repository,
      input.orgId,
    );
    const summary = await tenantSummaryForOrganization(
      this.repository,
      organization,
    );
    const preview = await buildTenantDeletionFinalizationPreview({
      organization,
      repository: this.repository,
      suspension: summary.suspension,
      ...(summary.deletionRequest === undefined
        ? {}
        : { deletionRequest: summary.deletionRequest }),
    });
    if (preview.status !== "ready") {
      throw new ApiError(
        "tenant_purge_preconditions_not_met",
        "Final tenant deletion is blocked by unmet finalization preconditions.",
        409,
        {
          blockers: preview.blockers,
          rawEvidenceRefsReturned: false,
        },
      );
    }
    return executeTenantPhysicalPurge({
      deletedBy: input.subject.id,
      objectStore: this.objectStore,
      orgId: input.orgId,
      repository: this.repository,
    });
  }

  private abuseControlService(
    repository: RomeoRepository,
  ): AbuseControlService {
    return repository === this.repository
      ? this.abuseControls
      : new AbuseControlService(repository);
  }
}
