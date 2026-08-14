import { trustGetPosture } from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export async function getTrustPosture() {
  configureBrowserApiClients();
  const response = await trustGetPosture({ throwOnError: true });
  return response.data.data;
}
