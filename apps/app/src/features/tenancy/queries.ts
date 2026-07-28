import {
  tenancyExportWorkspace,
  tenancyListOrganizations,
  tenancyListWorkspaces,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export async function listOrganizations() {
  configureBrowserApiClients();
  const response = await tenancyListOrganizations({ throwOnError: true });
  return response.data.data;
}

export async function listWorkspaces() {
  configureBrowserApiClients();
  const response = await tenancyListWorkspaces({ throwOnError: true });
  return response.data.data;
}

export async function exportWorkspace(workspaceId: string) {
  configureBrowserApiClients();
  const response = await tenancyExportWorkspace({
    path: { workspaceId },
    throwOnError: true,
  });
  return response.data.data;
}
