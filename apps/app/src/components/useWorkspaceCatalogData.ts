import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { agentToolsQueryOptions } from "../features/tools/query-options";
import {
  interfacePreferencesQueryOptions,
  providerOperationalSummaryQueryOptions,
  workspaceDraftAgentsQueryOptions,
  workspaceGalleryAgentsQueryOptions,
  workspaceModelsQueryOptions,
  workspaceProvidersQueryOptions,
} from "../lib/api-query-options";
import { useRouterApiClient } from "../lib/router-context";
import { resolveActiveAssistant } from "./assistant-selection";
import { useWorkspace } from "./WorkspaceContext";

/** Catalog-only workspace data. It intentionally never starts chat queries. */
export function useWorkspaceCatalogData(
  activeAgentId: string | undefined,
  options: {
    chatAgentId?: string;
    includeDrafts?: boolean;
    requestedAgentId?: string;
  } = {},
) {
  const { latestChatEvent, subject, workspace } = useWorkspace();
  const apiClient = useRouterApiClient();
  const draftAgentsQuery = useQuery(
    workspaceDraftAgentsQueryOptions(
      workspace?.id,
      apiClient,
      options.includeDrafts === true,
    ),
  );
  const galleryAgentsQuery = useQuery(
    workspaceGalleryAgentsQueryOptions(
      workspace?.id,
      apiClient,
      options.includeDrafts !== true,
    ),
  );
  const agentsQuery =
    options.includeDrafts === true ? draftAgentsQuery : galleryAgentsQuery;
  const modelsQuery = useQuery(workspaceModelsQueryOptions(apiClient));
  const providersQuery = useQuery(workspaceProvidersQueryOptions(apiClient));
  const providerOperationalSummaryQuery = useQuery(
    providerOperationalSummaryQueryOptions(apiClient),
  );
  const interfacePreferencesQuery = useQuery(
    interfacePreferencesQueryOptions(apiClient),
  );
  const agents = useMemo(() => agentsQuery.data ?? [], [agentsQuery.data]);
  const activeAgent = useMemo(
    () =>
      resolveActiveAssistant({
        ...(activeAgentId === undefined ? {} : { activeAgentId }),
        agents,
        ...(options.chatAgentId === undefined
          ? {}
          : { chatAgentId: options.chatAgentId }),
        ...(options.includeDrafts === undefined
          ? {}
          : { includeDrafts: options.includeDrafts }),
        ...(options.requestedAgentId === undefined
          ? {}
          : { requestedAgentId: options.requestedAgentId }),
        ...(workspace === undefined
          ? {}
          : {
              ...(interfacePreferencesQuery.data?.defaultAgentByWorkspace[
                workspace.id
              ] === undefined
                ? {}
                : {
                    userDefaultAgentId:
                      interfacePreferencesQuery.data.defaultAgentByWorkspace[
                        workspace.id
                      ],
                  }),
              ...(workspace.defaultAgentId === undefined
                ? {}
                : { workspaceDefaultAgentId: workspace.defaultAgentId }),
            }),
      }),
    [
      activeAgentId,
      agents,
      interfacePreferencesQuery.data,
      options.chatAgentId,
      options.includeDrafts,
      options.requestedAgentId,
      workspace,
    ],
  );
  const toolsQuery = useQuery(agentToolsQueryOptions(activeAgent?.id));

  return {
    activeAgent,
    agents,
    interfacePreferences: interfacePreferencesQuery.data,
    latestChatEvent,
    models: modelsQuery.data ?? [],
    providerOperationalSummary: providerOperationalSummaryQuery.data,
    providers: providersQuery.data ?? [],
    subject,
    tools: toolsQuery.data ?? [],
    workspace,
  };
}
