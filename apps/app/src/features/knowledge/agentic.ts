import { knowledgeGetAgenticSettings } from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export interface AgenticRagSettings {
  enabled: boolean;
  userMode: "optional" | "required";
}

export async function getAgenticRagSettings(): Promise<AgenticRagSettings> {
  configureBrowserApiClients();
  const response = await knowledgeGetAgenticSettings({
    throwOnError: true,
  });
  return response.data.data;
}
