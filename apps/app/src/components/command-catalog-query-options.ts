import { queryOptions } from "@tanstack/react-query";

import { listAgentGallery } from "../features/managed-models";
import { listKnowledgeBases } from "../features/knowledge";
import { listPromptTemplates } from "../features/prompts";
import { listTools } from "../features/tools";
import { listWorkflows } from "../features/workflows";
import * as appQueryKeys from "../lib/app-query-keys";
import { abortableQuery, serverQueryPolicy } from "../lib/server-query-options";

export function commandAgentsQueryOptions(
  workspaceId: string | undefined,
  enabled: boolean,
) {
  return queryOptions({
    ...serverQueryPolicy("stable", "commandCatalogAgents", { workspaceId }),
    queryKey: appQueryKeys.commandCatalog("agents", workspaceId),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () => listAgentGallery(workspaceId!)),
    enabled: enabled && workspaceId !== undefined,
  });
}

export function commandKnowledgeQueryOptions(
  workspaceId: string | undefined,
  enabled: boolean,
) {
  return queryOptions({
    ...serverQueryPolicy("stable", "commandCatalogKnowledge", {
      workspaceId,
    }),
    queryKey: appQueryKeys.commandCatalog("knowledge", workspaceId),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () => listKnowledgeBases(workspaceId!)),
    enabled: enabled && workspaceId !== undefined,
  });
}

export function commandPromptsQueryOptions(
  workspaceId: string | undefined,
  enabled: boolean,
) {
  return queryOptions({
    ...serverQueryPolicy("stable", "commandCatalogPrompts", { workspaceId }),
    queryKey: appQueryKeys.commandCatalog("prompts", workspaceId),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () => listPromptTemplates(workspaceId!)),
    enabled: enabled && workspaceId !== undefined,
  });
}

export function commandToolsQueryOptions(enabled: boolean) {
  return queryOptions({
    ...serverQueryPolicy("stable", "commandCatalogTools"),
    queryKey: appQueryKeys.commandCatalog("tools"),
    queryFn: ({ signal }) => abortableQuery(signal, listTools),
    enabled,
  });
}

export function commandWorkflowsQueryOptions(
  workspaceId: string | undefined,
  enabled: boolean,
) {
  return queryOptions({
    ...serverQueryPolicy("stable", "commandCatalogWorkflows", {
      workspaceId,
    }),
    queryKey: appQueryKeys.commandCatalog("workflows", workspaceId),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () => listWorkflows(workspaceId!)),
    enabled: enabled && workspaceId !== undefined,
  });
}
