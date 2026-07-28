import { assertScope, type AuthSubject } from "@romeo/auth";

import type { Organization } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { readAbuseControlPolicy } from "./abuse-control-service";
import { normalizeLocalAuthEmail } from "./local-password";
import type {
  StoredTenantDeletionRequest,
  TenantAdminOrganizationSummary,
  TenantDeletionRequestSummary,
} from "./tenant-admin-types";

const deletionRequestKeyPrefix = "tenant_lifecycle.deletion_request.v1:";
const reasonCodePattern = /^[A-Za-z0-9_.:/@-]+$/u;

export async function requireTenantOrganization(
  repository: RomeoRepository,
  orgId: string,
): Promise<Organization> {
  const organization = await repository.getOrganization(orgId);
  if (organization !== undefined) return organization;
  throw new ApiError(
    "organization_not_found",
    "Organization was not found.",
    404,
  );
}

export async function tenantSummaryForOrganization(
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
  const deletionRequest = await readTenantDeletionRequest(
    repository,
    organization.id,
  );
  return {
    organization,
    counts: {
      activeApiKeys: apiKeys.filter((apiKey) => apiKey.revokedAt === undefined)
        .length,
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

export async function readTenantDeletionRequest(
  repository: RomeoRepository,
  orgId: string,
): Promise<TenantDeletionRequestSummary | undefined> {
  const setting = await repository.getSystemSetting(deletionRequestKey(orgId));
  if (setting === undefined) return undefined;
  const parsed = parseDeletionRequest(setting.value, orgId);
  if (parsed === undefined) return undefined;
  const { schemaVersion: _schemaVersion, orgId: _orgId, ...summary } = parsed;
  return summary;
}

export function assertTenantGlobalAdmin(subject: AuthSubject): void {
  assertScope(subject, "admin:read");
  if (subject.adminRole === "global_admin") return;
  throw new ApiError(
    "global_admin_required",
    "Global admin role is required for organization administration.",
    403,
  );
}

export function assertTenantConfirmed(
  orgId: string,
  confirmOrgId: string,
): void {
  if (orgId === confirmOrgId) return;
  throw new ApiError(
    "organization_confirmation_mismatch",
    "Organization confirmation does not match.",
    400,
  );
}

export function normalizeInitialAdmin(input: { email: string; name: string }): {
  email: string;
  name: string;
} {
  return {
    email: normalizeLocalAuthEmail(input.email),
    name: normalizeName(input.name, "Initial admin name"),
  };
}

export function normalizeName(value: string, label: string): string {
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

export function normalizeSlug(value: string): string {
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

export function normalizeReasonCode(value: string): string {
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

export function parseDeletionRequest(
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

export function deletionRequestKey(orgId: string): string {
  return `${deletionRequestKeyPrefix}${orgId}`;
}
