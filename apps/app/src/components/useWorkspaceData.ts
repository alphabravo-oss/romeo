import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { getChat, listChatsPage } from "../features";
import { getChatExperience } from "../features/chat-experience";
import {
  listAgentGallery,
  listAgents,
  type AgentGalleryItem,
} from "../features/managed-models";
import { getServerInterfacePreferences } from "../features/interface-preferences";
import {
  getProviderOperationalSummary,
  listModels,
  listProviders,
} from "../features/providers/queries";
import { listAgentTools } from "../features/tools";
import { resolveActiveAssistant } from "./assistant-selection";
import { useWorkspace } from "./WorkspaceContext";

export function useWorkspaceData(
  activeAgentId: string | undefined,
  options: {
    activeChatId?: string;
    includeDrafts?: boolean;
    requestedAgentId?: string;
  } = {},
) {
  // The selected workspace is owned by WorkspaceProvider (persisted +
  // validated). This deduplicates the same ["bootstrap"] query rather than
  // re-fetching. Falls back to nothing while the selection reconciles.
  const { latestChatEvent, subject, workspace } = useWorkspace();
  const agentsQuery = useQuery({
    queryKey: [
      options.includeDrafts ? "agents" : "agentGallery",
      workspace?.id,
    ],
    queryFn: async (): Promise<AgentGalleryItem[]> =>
      options.includeDrafts
        ? (await listAgents(workspace!.id)).map((agent) => ({
            ...agent,
            favorite: false,
            readinessStatus:
              agent.publishedVersionId === undefined ? "blocked" : "ready",
            ...(agent.publishedVersionId === undefined
              ? { readinessReason: "Publish this assistant before using it." }
              : {}),
          }))
        : listAgentGallery(workspace!.id),
    enabled: workspace !== undefined,
    refetchOnWindowFocus: true,
  });
  const chatsQuery = useInfiniteQuery({
    queryKey: ["chats", workspace?.id],
    queryFn: ({ pageParam }) =>
      listChatsPage(workspace!.id, { limit: 50, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.offset + lastPage.items.length : undefined,
    enabled: workspace !== undefined,
  });
  const activeChatQuery = useQuery({
    queryKey: ["chat", options.activeChatId],
    queryFn: () => getChat(options.activeChatId!),
    enabled: options.activeChatId !== undefined,
  });
  const chatExperienceQuery = useQuery({
    queryKey: ["chatExperience"],
    queryFn: getChatExperience,
  });
  const modelsQuery = useQuery({
    queryKey: ["models"],
    queryFn: listModels,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const providersQuery = useQuery({
    queryKey: ["providers"],
    queryFn: listProviders,
    refetchInterval: (query) =>
      query.state.data?.some(
        (provider) =>
          provider.catalogSync === undefined ||
          ["never", "stale", "syncing"].includes(provider.catalogSync.status),
      )
        ? 3_000
        : 60_000,
    refetchOnWindowFocus: true,
  });
  const providerOperationalSummaryQuery = useQuery({
    queryKey: ["providerOperationalSummary"],
    queryFn: getProviderOperationalSummary,
  });
  const interfacePreferencesQuery = useQuery({
    queryKey: ["interfacePreferences"],
    queryFn: getServerInterfacePreferences,
  });

  const agents = useMemo(() => agentsQuery.data ?? [], [agentsQuery.data]);
  const chats = useMemo(() => {
    const pagedChats =
      chatsQuery.data?.pages.flatMap((page) => page.items) ?? [];
    const activeChat = activeChatQuery.data;
    return activeChat !== undefined &&
      activeChat.archivedAt === undefined &&
      !pagedChats.some((chat) => chat.id === activeChat.id)
      ? [activeChat, ...pagedChats]
      : pagedChats;
  }, [activeChatQuery.data, chatsQuery.data]);
  const chatAgentId = chats.find(
    (chat) => chat.id === options.activeChatId,
  )?.agentId;
  const activeAgent = useMemo(
    () =>
      resolveActiveAssistant({
        ...(activeAgentId === undefined ? {} : { activeAgentId }),
        agents,
        ...(chatAgentId === undefined ? {} : { chatAgentId }),
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
      chatAgentId,
      interfacePreferencesQuery.data,
      options.includeDrafts,
      options.requestedAgentId,
      workspace,
    ],
  );
  const toolsQuery = useQuery({
    queryKey: ["agentTools", activeAgent?.id],
    queryFn: () => listAgentTools(activeAgent!.id),
    enabled: activeAgent !== undefined,
  });

  return {
    activeAgent,
    agents,
    chats,
    chatExperience: chatExperienceQuery.data,
    chatsTotal: chatsQuery.data?.pages[0]?.total ?? 0,
    hasMoreChats: chatsQuery.hasNextPage,
    isLoadingMoreChats: chatsQuery.isFetchingNextPage,
    loadMoreChats: chatsQuery.fetchNextPage,
    models: modelsQuery.data ?? [],
    providerOperationalSummary: providerOperationalSummaryQuery.data,
    providers: providersQuery.data ?? [],
    interfacePreferences: interfacePreferencesQuery.data,
    latestChatEvent,
    subject,
    tools: toolsQuery.data ?? [],
    workspace,
  };
}
