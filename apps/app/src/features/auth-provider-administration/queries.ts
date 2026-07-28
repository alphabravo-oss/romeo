import {
  authProviderAdministrationGetSettings,
  authProviderAdministrationListCatalog,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export async function getAuthProviderCatalog() {
  configureBrowserApiClients();
  const response = await authProviderAdministrationListCatalog({
    throwOnError: true,
  });
  return response.data.data;
}

export async function getAuthProviderSettings() {
  configureBrowserApiClients();
  const response = await authProviderAdministrationGetSettings({
    throwOnError: true,
  });
  return response.data.data;
}
