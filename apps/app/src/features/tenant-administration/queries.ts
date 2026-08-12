import { tenantAdministrationListOrganizations } from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

import type { TenantOrganizationSummary } from "./types";

export async function listTenantOrganizations(): Promise<
  TenantOrganizationSummary[]
> {
  configureBrowserApiClients();
  const response = await tenantAdministrationListOrganizations({
    throwOnError: true,
  });
  return response.data.data;
}
