import { deviceAuthorizationsList } from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export async function listDeviceAuthorizations() {
  configureBrowserApiClients();
  const response = await deviceAuthorizationsList({ throwOnError: true });
  return response.data.data;
}
