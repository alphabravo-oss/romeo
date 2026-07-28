import { ssoAdministrationGetSettings } from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export async function getSsoSettings() {
  configureBrowserApiClients();
  const response = await ssoAdministrationGetSettings({ throwOnError: true });
  return response.data.data;
}
