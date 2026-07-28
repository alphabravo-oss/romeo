import {
  knowledgeGetBase,
  knowledgeListBases,
  knowledgeListSources,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

import type { KnowledgeBase, KnowledgeSource } from "./types";

export async function listKnowledgeBases(
  workspaceId: string,
): Promise<KnowledgeBase[]> {
  configureBrowserApiClients();
  const response = await knowledgeListBases({
    query: { workspaceId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function getKnowledgeBase(
  knowledgeBaseId: string,
): Promise<KnowledgeBase> {
  configureBrowserApiClients();
  const response = await knowledgeGetBase({
    path: { knowledgeBaseId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function listKnowledgeSources(
  knowledgeBaseId: string,
): Promise<KnowledgeSource[]> {
  configureBrowserApiClients();
  const response = await knowledgeListSources({
    path: { knowledgeBaseId },
    throwOnError: true,
  });
  return response.data.data;
}
