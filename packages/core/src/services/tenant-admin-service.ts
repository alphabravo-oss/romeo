import { type AuthSubject } from "@romeo/auth";
import { disabledObjectStore, type ObjectStore } from "@romeo/storage";

import type { User } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import { writeAuditLog } from "./audit-log";
import { AbuseControlService } from "./abuse-control-service";
import { TenantDeletionLifecycleService } from "./tenant-deletion-lifecycle-service";
import {
  assertTenantConfirmed,
  assertTenantGlobalAdmin,
  normalizeInitialAdmin,
  normalizeName,
  normalizeReasonCode,
  normalizeSlug,
  requireTenantOrganization,
  tenantSummaryForOrganization,
} from "./tenant-admin-support";
import type {
  TenantAdminOrganizationSummary,
  TenantProvisioningResult,
} from "./tenant-admin-types";
import { hashLocalPassword, normalizeLocalAuthEmail } from "./local-password";

export type {
  TenantAdminOrganizationSummary,
  TenantDeletionRequestSummary,
  TenantProvisioningResult,
} from "./tenant-admin-types";

export class TenantAdminService {
  private readonly deletionLifecycle: TenantDeletionLifecycleService;

  constructor(
    private readonly repository: RomeoRepository,
    private readonly abuseControls: AbuseControlService,
    private readonly objectStore: ObjectStore = disabledObjectStore,
  ) {
    this.deletionLifecycle = new TenantDeletionLifecycleService(
      repository,
      abuseControls,
      objectStore,
    );
  }

  async list(subject: AuthSubject): Promise<TenantAdminOrganizationSummary[]> {
    assertTenantGlobalAdmin(subject);
    const organizations = await this.repository.listAllOrganizations();
    return Promise.all(
      organizations.map((organization) =>
        tenantSummaryForOrganization(this.repository, organization),
      ),
    );
  }

  async get(input: {
    subject: AuthSubject;
    orgId: string;
  }): Promise<TenantAdminOrganizationSummary> {
    assertTenantGlobalAdmin(input.subject);
    const organization = await requireTenantOrganization(
      this.repository,
      input.orgId,
    );
    return tenantSummaryForOrganization(this.repository, organization);
  }

  async create(input: {
    subject: AuthSubject;
    name: string;
    slug?: string;
    defaultWorkspace?: { name?: string; slug?: string };
    initialAdmin?: { email: string; name: string; password?: string };
  }): Promise<TenantProvisioningResult> {
    assertTenantGlobalAdmin(input.subject);
    const name = normalizeName(input.name, "Organization name");
    const slug = normalizeSlug(input.slug ?? name);
    const orgId = `org_${slug.replace(/-/gu, "_")}`;
    const workspaceName = normalizeName(
      input.defaultWorkspace?.name ?? "Default",
      "Default workspace name",
    );
    const workspaceSlug = normalizeSlug(
      input.defaultWorkspace?.slug ?? workspaceName,
    );
    const workspaceId = `workspace_${slug.replace(/-/gu, "_")}_${workspaceSlug.replace(/-/gu, "_")}`;

    const passwordHash =
      input.initialAdmin?.password === undefined
        ? undefined
        : await hashLocalPassword(input.initialAdmin.password);
    const initialAdmin =
      input.initialAdmin === undefined
        ? undefined
        : normalizeInitialAdmin(input.initialAdmin);

    return this.repository.transaction(async (repository) => {
      const existing = await repository.listAllOrganizations();
      if (
        existing.some(
          (organization) =>
            organization.id === orgId || organization.slug === slug,
        )
      ) {
        throw new ApiError(
          "organization_slug_unavailable",
          "Organization slug is already reserved.",
          409,
          { slug },
        );
      }
      if ((await repository.getWorkspace(workspaceId)) !== undefined) {
        throw new ApiError(
          "workspace_slug_unavailable",
          "Default workspace slug is already reserved.",
          409,
          { slug: workspaceSlug },
        );
      }

      const organization = await repository.createOrganization({
        id: orgId,
        name,
        slug,
      });
      const defaultWorkspace = await repository.createWorkspace({
        id: workspaceId,
        orgId,
        name: workspaceName,
        slug: workspaceSlug,
      });
      const createdAdmin =
        initialAdmin === undefined
          ? undefined
          : await this.createInitialAdmin(repository, {
              admin: initialAdmin,
              orgId,
              orgSlug: slug,
              ...(passwordHash === undefined ? {} : { passwordHash }),
            });

      await writeAuditLog(repository, {
        subject: input.subject,
        action: "admin.organization.create",
        resourceType: "organization",
        resourceId: organization.id,
        metadata: {
          defaultWorkspaceCreated: true,
          initialAdminCreated: createdAdmin !== undefined,
          localPasswordConfigured: passwordHash !== undefined,
        },
      });

      const summary = await tenantSummaryForOrganization(
        repository,
        organization,
      );
      return {
        ...summary,
        defaultWorkspace,
        ...(createdAdmin === undefined
          ? {}
          : {
              initialAdmin: {
                id: createdAdmin.id,
                email: createdAdmin.email,
                name: createdAdmin.name,
                role: "org_admin",
                localPasswordConfigured: passwordHash !== undefined,
              },
            }),
      };
    });
  }

  async update(input: {
    subject: AuthSubject;
    orgId: string;
    name?: string;
    slug?: string;
  }): Promise<TenantAdminOrganizationSummary> {
    assertTenantGlobalAdmin(input.subject);
    const existing = await requireTenantOrganization(
      this.repository,
      input.orgId,
    );
    const name =
      input.name === undefined
        ? existing.name
        : normalizeName(input.name, "Organization name");
    const slug =
      input.slug === undefined ? existing.slug : normalizeSlug(input.slug);
    const organizations = await this.repository.listAllOrganizations();
    const conflict = organizations.find(
      (organization) =>
        organization.id !== existing.id && organization.slug === slug,
    );
    if (conflict !== undefined) {
      throw new ApiError(
        "organization_slug_unavailable",
        "Organization slug is already reserved.",
        409,
        { slug },
      );
    }
    if (name === existing.name && slug === existing.slug) {
      return tenantSummaryForOrganization(this.repository, existing);
    }

    const updated = await this.repository.transaction(async (repository) => {
      const updatedOrganization = await repository.updateOrganization({
        ...existing,
        name,
        slug,
      });
      await writeAuditLog(repository, {
        subject: input.subject,
        action: "admin.organization.update",
        resourceType: "organization",
        resourceId: updatedOrganization.id,
        metadata: {
          nameChanged: name !== existing.name,
          slugChanged: slug !== existing.slug,
        },
      });
      return updatedOrganization;
    });
    return tenantSummaryForOrganization(this.repository, updated);
  }

  async suspend(input: {
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
    return this.repository.transaction(async (repository) => {
      await this.abuseControlService(repository).updateForOrg({
        subject: input.subject,
        orgId: input.orgId,
        policy: { suspension: { suspended: true, reasonCode } },
      });
      await writeAuditLog(repository, {
        subject: input.subject,
        action: "admin.organization.suspend",
        resourceType: "organization",
        resourceId: input.orgId,
        metadata: { reasonCode },
      });
      return tenantSummaryForOrganization(repository, organization);
    });
  }

  async reactivate(input: {
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
    return this.repository.transaction(async (repository) => {
      await this.abuseControlService(repository).updateForOrg({
        subject: input.subject,
        orgId: input.orgId,
        policy: { suspension: { suspended: false, reasonCode: null } },
      });
      await writeAuditLog(repository, {
        subject: input.subject,
        action: "admin.organization.reactivate",
        resourceType: "organization",
        resourceId: input.orgId,
        metadata: { suspensionCleared: true },
      });
      return tenantSummaryForOrganization(repository, organization);
    });
  }

  requestDeletion(
    input: Parameters<TenantDeletionLifecycleService["requestDeletion"]>[0],
  ) {
    return this.deletionLifecycle.requestDeletion(input);
  }

  cancelDeletionRequest(
    input: Parameters<
      TenantDeletionLifecycleService["cancelDeletionRequest"]
    >[0],
  ) {
    return this.deletionLifecycle.cancelDeletionRequest(input);
  }

  deletionFinalizationPreview(
    input: Parameters<
      TenantDeletionLifecycleService["deletionFinalizationPreview"]
    >[0],
  ) {
    return this.deletionLifecycle.deletionFinalizationPreview(input);
  }

  recordDeletionFinalizationEvidence(
    input: Parameters<
      TenantDeletionLifecycleService["recordDeletionFinalizationEvidence"]
    >[0],
  ) {
    return this.deletionLifecycle.recordDeletionFinalizationEvidence(input);
  }

  executeDeletionFinalization(
    input: Parameters<
      TenantDeletionLifecycleService["executeDeletionFinalization"]
    >[0],
  ) {
    return this.deletionLifecycle.executeDeletionFinalization(input);
  }

  private async createInitialAdmin(
    repository: RomeoRepository,
    input: {
      admin: { email: string; name: string };
      orgId: string;
      orgSlug: string;
      passwordHash?: string;
    },
  ): Promise<User> {
    const user = await repository.createUser({
      id: `user_${input.orgSlug.replace(/-/gu, "_")}_admin`,
      orgId: input.orgId,
      email: input.admin.email,
      name: input.admin.name,
      role: "org_admin",
    });
    if (input.passwordHash !== undefined) {
      const now = new Date().toISOString();
      await repository.createLocalPasswordCredential({
        id: createId("local_password"),
        orgId: input.orgId,
        userId: user.id,
        emailNormalized: normalizeLocalAuthEmail(user.email),
        failedAttemptCount: 0,
        passwordHash: input.passwordHash,
        passwordUpdatedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }
    return user;
  }

  private abuseControlService(
    repository: RomeoRepository,
  ): AbuseControlService {
    if (repository === this.repository) return this.abuseControls;
    return new AbuseControlService(repository);
  }
}
