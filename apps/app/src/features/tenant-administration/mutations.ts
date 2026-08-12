import {
  tenantAdministrationCreateOrganization,
  tenantAdministrationReactivateOrganization,
  tenantAdministrationSuspendOrganization,
  tenantAdministrationUpdateOrganization,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

import type {
  CreateTenantOrganizationRequest,
  TenantOrganizationSummary,
  TenantProvisioningResult,
  UpdateTenantOrganizationRequest,
} from "./types";

export async function createTenantOrganization(
  input: CreateTenantOrganizationRequest,
): Promise<TenantProvisioningResult> {
  configureBrowserApiClients();
  const response = await tenantAdministrationCreateOrganization({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function updateTenantOrganization(input: {
  orgId: string;
  body: UpdateTenantOrganizationRequest;
}): Promise<TenantOrganizationSummary> {
  configureBrowserApiClients();
  const response = await tenantAdministrationUpdateOrganization({
    path: { orgId: input.orgId },
    body: input.body,
    throwOnError: true,
  });
  return response.data.data;
}

export async function suspendTenantOrganization(input: {
  orgId: string;
  reasonCode: string;
}): Promise<TenantOrganizationSummary> {
  configureBrowserApiClients();
  const response = await tenantAdministrationSuspendOrganization({
    path: { orgId: input.orgId },
    body: {
      confirmOrgId: input.orgId,
      reasonCode: input.reasonCode,
    },
    throwOnError: true,
  });
  return response.data.data;
}

export async function reactivateTenantOrganization(
  orgId: string,
): Promise<TenantOrganizationSummary> {
  configureBrowserApiClients();
  const response = await tenantAdministrationReactivateOrganization({
    path: { orgId },
    body: { confirmOrgId: orgId },
    throwOnError: true,
  });
  return response.data.data;
}
