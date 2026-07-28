import { runsInspectContext } from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

import type { RunContextPreview } from "./types";

export async function inspectRunContext(input: {
  chatId: string;
  agentId: string;
  content: string;
  modelId?: string;
  fileIds?: string[];
  imageCount?: number;
  webSearch?: boolean;
  urls?: string[];
}): Promise<RunContextPreview> {
  configureBrowserApiClients();
  const response = await runsInspectContext({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}
