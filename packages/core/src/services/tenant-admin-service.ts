import { assertScope, type AuthSubject } from "@romeo/auth";
import { disabledObjectStore, type ObjectStore } from "@romeo/storage";

import type { Organization, User, Workspace } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import { writeAuditLog } from "./audit-log";
import {
  AbuseControlService,
  readAbuseControlPolicy,
} from "./abuse-control-service";
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
import { hashLocalPassword, normalizeLocalAuthEmail } from "./local-password";

const deletionRequestKeyPrefix = "tenant_lifecycle.deletion_request.v1:";
const reasonCodePattern = /^[A-Za-z0-9_.:/@-]+$/u;

export interface TenantAdminOrganizationSummary {
  organization: Organization;
  counts: {
    activeApiKeys: number;
    disabledUsers: number;
    serviceAccounts: number;
    users: number;
    workspaces: number;
  };
  suspension: {
    suspended: boolean;
    reasonCode?: string;
    suspendedAt?: string;
    suspendedBy?: string;
  };
  deletionRequest?: TenantDeletionRequestSummary;
}

export interface TenantProvisioningResult extends TenantAdminOrganizationSummary {
  initialAdmin?: {
    id: string;
    email: string;
    name: string;
    role: "org_admin";
    localPasswordConfigured: boolean;
  };
  defaultWorkspace: Workspace;
}

export interface TenantDeletionRequestSummary {
  status: "cancelled" | "requested";
  reasonCode: string;
  requestedAt: string;
  requestedBy: string;
  cancelledAt?: string;
  cancelledBy?: string;
}

interface StoredTenantDeletionRequest extends TenantDeletionRequestSummary {
  schemaVersion: "romeo.tenant-deletion-request.v1";
  orgId: string;
}

export class TenantAdminService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly abuseControls: AbuseControlService,
    private readonly objectStore: ObjectStore = disabledObjectStore,
  ) {}

  async list(subject: AuthSubject): Promise<TenantAdminOrganizationSummary[]> {
    this.assertGlobalAdmin(subject);
    const organizations = await this.repository.listAllOrganizations();
    return Promise.all(
      organizations.map((organization) =>
        this.summaryForOrganization(organization),
      ),
    );
  }

  async get(input: {
    subject: AuthSubject;
    orgId: string;
  }): Promise<TenantAdminOrganizationSummary> {
    this.assertGlobalAdmin(input.subject);
    const organization = await this.requireOrganization(input.orgId);
    return this.summaryForOrganization(organization);
  }

  async create(input: {
    subject: AuthSubject;
    name: string;
    slug?: string;
    defaultWorkspace?: { name?: string; slug?: string };
    initialAdmin?: { email: string; name: string; password?: string };
  }): Promise<TenantProvisioningResult> {
    this.assertGlobalAdmin(input.subject);
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

      const summary = await this.summaryForOrganizationWithRepository(
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
    this.assertGlobalAdmin(input.subject);
    const existing = await this.requireOrganization(input.orgId);
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
      return this.summaryForOrganization(existing);
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
    return this.summaryForOrganization(updated);
  }

  async suspend(input: {
    subject: AuthSubject;
    orgId: string;
    confirmOrgId: string;
    reasonCode: string;
  }): Promise<TenantAdminOrganizationSummary> {
    this.assertGlobalAdmin(input.subject);
    this.assertConfirmed(input.orgId, input.confirmOrgId);
    const organization = await this.requireOrganization(input.orgId);
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
      return this.summaryForOrganizationWithRepository(
        repository,
        organization,
      );
    });
  }

  async reactivate(input: {
    subject: AuthSubject;
    orgId: string;
    confirmOrgId: string;
  }): Promise<TenantAdminOrganizationSummary> {
    this.assertGlobalAdmin(input.subject);
    this.assertConfirmed(input.orgId, input.confirmOrgId);
    const organization = await this.requireOrganization(input.orgId);
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
      return this.summaryForOrganizationWithRepository(
        repository,
        organization,
      );
    });
  }

  async requestDeletion(input: {
    subject: AuthSubject;
    orgId: string;
    confirmOrgId: string;
    reasonCode: string;
  }): Promise<TenantAdminOrganizationSummary> {
    this.assertGlobalAdmin(input.subject);
    this.assertConfirmed(input.orgId, input.confirmOrgId);
    const organization = await this.requireOrganization(input.orgId);
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
      return this.summaryForOrganizationWithRepository(
        repository,
        organization,
      );
    });
  }

  async cancelDeletionRequest(input: {
    subject: AuthSubject;
    orgId: string;
    confirmOrgId: string;
  }): Promise<TenantAdminOrganizationSummary> {
    this.assertGlobalAdmin(input.subject);
    this.assertConfirmed(input.orgId, input.confirmOrgId);
    const organization = await this.requireOrganization(input.orgId);
    const existing = await this.readDeletionRequest(input.orgId);
    if (existing === undefined || existing.status === "cancelled") {
      return this.summaryForOrganization(organization);
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
      return this.summaryForOrganizationWithRepository(
        repository,
        organization,
      );
    });
  }

  async deletionFinalizationPreview(input: {
    subject: AuthSubject;
    orgId: string;
  }): Promise<TenantDeletionFinalizationPreview> {
    this.assertGlobalAdmin(input.subject);
    const organization = await this.requireOrganization(input.orgId);
    const summary = await this.summaryForOrganization(organization);
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
    this.assertGlobalAdmin(input.subject);
    this.assertConfirmed(input.orgId, input.confirmOrgId);
    const organization = await this.requireOrganization(input.orgId);
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
      const summary = await this.summaryForOrganizationWithRepository(
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
    this.assertGlobalAdmin(input.subject);
    this.assertConfirmed(input.orgId, input.confirmOrgId);
    if (input.confirmPermanentDeletion !== true) {
      throw new ApiError(
        "tenant_purge_confirmation_required",
        "Final tenant deletion requires explicit permanent-deletion confirmation.",
        400,
      );
    }
    const organization = await this.requireOrganization(input.orgId);
    const summary = await this.summaryForOrganization(organization);
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

  private async summaryForOrganization(
    organization: Organization,
  ): Promise<TenantAdminOrganizationSummary> {
    return this.summaryForOrganizationWithRepository(
      this.repository,
      organization,
    );
  }

  private async summaryForOrganizationWithRepository(
    repository: RomeoRepository,
    organization: Organization,
  ): Promise<TenantAdminOrganizationSummary> {
    const [users, workspaces, serviceAccounts, apiKeys, abuseControls] =
      await Promise.all([
        repository.listUsers(organization.id),
        repository.listWorkspaces(organization.id),
        repository.listServiceAccounts(organization.id),
        repository.listApiKeys(organization.id),
        readAbuseControlPolicy(repository, organization.id),
      ]);
    const deletionRequest = await this.readDeletionRequestWithRepository(
      repository,
      organization.id,
    );
    return {
      organization,
      counts: {
        activeApiKeys: apiKeys.filter(
          (apiKey) => apiKey.revokedAt === undefined,
        ).length,
        disabledUsers: users.filter((user) => user.disabledAt !== undefined)
          .length,
        serviceAccounts: serviceAccounts.length,
        users: users.length,
        workspaces: workspaces.length,
      },
      suspension: abuseControls.suspension,
      ...(deletionRequest === undefined ? {} : { deletionRequest }),
    };
  }

  private async requireOrganization(orgId: string): Promise<Organization> {
    const organization = await this.repository.getOrganization(orgId);
    if (organization === undefined) {
      throw new ApiError(
        "organization_not_found",
        "Organization was not found.",
        404,
      );
    }
    return organization;
  }

  private async readDeletionRequest(
    orgId: string,
  ): Promise<TenantDeletionRequestSummary | undefined> {
    return this.readDeletionRequestWithRepository(this.repository, orgId);
  }

  private async readDeletionRequestWithRepository(
    repository: RomeoRepository,
    orgId: string,
  ): Promise<TenantDeletionRequestSummary | undefined> {
    const setting = await repository.getSystemSetting(
      deletionRequestKey(orgId),
    );
    if (setting === undefined) return undefined;
    const parsed = parseDeletionRequest(setting.value, orgId);
    if (parsed === undefined) return undefined;
    const { schemaVersion: _schemaVersion, orgId: _orgId, ...summary } = parsed;
    return summary;
  }

  private assertGlobalAdmin(subject: AuthSubject): void {
    assertScope(subject, "admin:read");
    if (subject.adminRole !== "global_admin") {
      throw new ApiError(
        "global_admin_required",
        "Global admin role is required for organization administration.",
        403,
      );
    }
  }

  private assertConfirmed(orgId: string, confirmOrgId: string): void {
    if (orgId !== confirmOrgId) {
      throw new ApiError(
        "organization_confirmation_mismatch",
        "Organization confirmation does not match.",
        400,
      );
    }
  }
}

function normalizeInitialAdmin(input: { email: string; name: string }): {
  email: string;
  name: string;
} {
  return {
    email: normalizeLocalAuthEmail(input.email),
    name: normalizeName(input.name, "Initial admin name"),
  };
}

function normalizeName(value: string, label: string): string {
  const name = value.trim();
  if (name.length === 0 || name.length > 120) {
    throw new ApiError(
      "invalid_tenant_name",
      `${label} must be between 1 and 120 characters.`,
      400,
    );
  }
  return name;
}

function normalizeSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
  if (slug.length === 0) {
    throw new ApiError(
      "invalid_organization_slug",
      "Organization slug must contain letters or numbers.",
      400,
    );
  }
  return slug;
}

function normalizeReasonCode(value: string): string {
  const reasonCode = value.trim();
  if (
    reasonCode.length === 0 ||
    reasonCode.length > 200 ||
    !reasonCodePattern.test(reasonCode)
  ) {
    throw new ApiError(
      "invalid_organization_lifecycle_reason",
      "Organization lifecycle reason code is invalid.",
      400,
    );
  }
  return reasonCode;
}

function parseDeletionRequest(
  value: Record<string, unknown>,
  orgId: string,
): StoredTenantDeletionRequest | undefined {
  if (
    value.schemaVersion !== "romeo.tenant-deletion-request.v1" ||
    value.orgId !== orgId ||
    (value.status !== "requested" && value.status !== "cancelled") ||
    typeof value.reasonCode !== "string" ||
    typeof value.requestedAt !== "string" ||
    typeof value.requestedBy !== "string"
  ) {
    return undefined;
  }
  const request: StoredTenantDeletionRequest = {
    schemaVersion: "romeo.tenant-deletion-request.v1",
    orgId,
    status: value.status,
    reasonCode: value.reasonCode,
    requestedAt: value.requestedAt,
    requestedBy: value.requestedBy,
  };
  if (typeof value.cancelledAt === "string")
    request.cancelledAt = value.cancelledAt;
  if (typeof value.cancelledBy === "string")
    request.cancelledBy = value.cancelledBy;
  return request;
}

function deletionRequestKey(orgId: string): string {
  return `${deletionRequestKeyPrefix}${orgId}`;
}
