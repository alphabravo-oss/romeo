import { webGetConfiguration } from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

import type { WebSearchConfiguration } from "./types";

export async function getWebSearchConfiguration(): Promise<WebSearchConfiguration> {
  configureBrowserApiClients();
  const response = await webGetConfiguration({ throwOnError: true });
  return response.data.data;
}
