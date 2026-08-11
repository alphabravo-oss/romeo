import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { getChat, listChatsPage, listMessages } from "../features";
import { getChatExperience } from "../features/chat-experience";
import type { Message } from "../features/types";
import { messagesQueryKey } from "../lib/run-registry";
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
import { chatPath, messageVariants } from "./message-tree";
import { useWorkspace } from "./WorkspaceContext";

// Stable identity for "this chat has no transcript yet", so an idle chat does
// not invalidate every memo that depends on the message list.
const noMessages: Message[] = [];

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
  // Never auto-refetched: the run registry streams deltas into this exact key
  // from outside React, and a background refresh would replace a half-written
  // answer with the empty row the server still has. Refreshes are explicit
  // invalidations, issued once a run has settled.
  //
  // ponytail: the guard is unconditional rather than scoped to a live run, so a
  // transcript changed in another tab or device, or by an admin deletion, never
  // refreshes for the life of this mount. Upgrade path: restore the default
  // refetch behaviour and gate it on getActiveRun(chatId)?.isStreaming.
  const messagesQuery = useQuery({
    queryKey: messagesQueryKey(options.activeChatId ?? ""),
    queryFn: () => listMessages(options.activeChatId!),
    enabled: options.activeChatId !== undefined,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
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

  // The transcript is a tree; what the reader sees is the one branch ending at
  // the chat's active leaf. Both derivations are local, so switching variants
  // is a pointer PATCH and a re-render rather than another round trip.
  const allMessages = messagesQuery.data ?? noMessages;
  const activeLeafMessageId = activeChatQuery.data?.activeLeafMessageId;
  const messages = useMemo(
    () => chatPath(allMessages, activeLeafMessageId),
    [activeLeafMessageId, allMessages],
  );
  const variantsByMessageId = useMemo(
    () => messageVariants(allMessages, messages),
    [allMessages, messages],
  );

  return {
    activeAgent,
    agents,
    allMessages,
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
    messages,
    subject,
    tools: toolsQuery.data ?? [],
    variantsByMessageId,
    workspace,
  };
}
