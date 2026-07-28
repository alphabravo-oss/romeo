import { readinessGetReport } from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export async function getReadinessReport() {
  configureBrowserApiClients();
  const response = await readinessGetReport({ throwOnError: true });
  return response.data.data;
}
