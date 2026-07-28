import { voicesList } from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";
export async function listVoices() {
  configureBrowserApiClients();
  const response = await voicesList({ throwOnError: true });
  return response.data.data;
}
