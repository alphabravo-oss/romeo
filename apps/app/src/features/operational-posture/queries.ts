import { operationalPostureGetPostgres } from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export async function getPostgresOperationalPosture() {
  configureBrowserApiClients();
  const response = await operationalPostureGetPostgres({ throwOnError: true });
  return response.data.data;
}
