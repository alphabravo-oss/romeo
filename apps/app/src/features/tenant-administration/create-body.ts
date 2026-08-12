import type { CreateTenantOrganizationRequest } from "./types";

/**
 * Builds a create-org request body from form fields.
 * Omits empty optional fields so the contract stays strict-object clean.
 */
export function buildCreateTenantOrganizationBody(input: {
  name: string;
  slug?: string;
  defaultWorkspaceName?: string;
  initialAdminEmail?: string;
  initialAdminName?: string;
  initialAdminPassword?: string;
}): CreateTenantOrganizationRequest {
  const name = input.name.trim();
  const body: CreateTenantOrganizationRequest = { name };

  const slug = input.slug?.trim();
  if (slug) body.slug = slug;

  const workspaceName = input.defaultWorkspaceName?.trim();
  if (workspaceName) {
    body.defaultWorkspace = { name: workspaceName };
  }

  const email = input.initialAdminEmail?.trim();
  const adminName = input.initialAdminName?.trim();
  if (email && adminName) {
    const password = input.initialAdminPassword?.trim();
    body.initialAdmin = {
      email,
      name: adminName,
      ...(password ? { password } : {}),
    };
  }

  return body;
}

/** Reason codes for suspend: matches tenantAdministration reasonCode regex. */
export function isValidTenantReasonCode(value: string): boolean {
  return /^[A-Za-z0-9_.:/@-]+$/u.test(value.trim()) && value.trim().length > 0;
}
