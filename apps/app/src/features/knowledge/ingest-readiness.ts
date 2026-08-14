import { knowledgeGetIngestReadiness } from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export type KnowledgeIngestBlockReason =
  | "embedding_unset"
  | "tiers_disabled"
  | "vector_unconfigured";

export interface KnowledgeIngestReadiness {
  ready: boolean;
  reason?: KnowledgeIngestBlockReason;
}

export async function getKnowledgeIngestReadiness(): Promise<KnowledgeIngestReadiness> {
  configureBrowserApiClients();
  const response = await knowledgeGetIngestReadiness({
    throwOnError: true,
  });
  return response.data.data;
}
