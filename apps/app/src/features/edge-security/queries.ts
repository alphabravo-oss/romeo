import { edgeSecurityGetPosture } from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export async function getEdgeSecurityPosture() {
  configureBrowserApiClients();
  const response = await edgeSecurityGetPosture({ throwOnError: true });
  return response.data.data;
}
