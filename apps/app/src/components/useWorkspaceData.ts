import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { chatExperienceQueryOptions } from "../features/chat-experience/query-options";
import {
  chatQueryOptions,
  chatsInfiniteQueryOptions,
} from "../features/chats/query-options";
import { agentToolsQueryOptions } from "../features/tools/query-options";
import type { Message } from "../features/types";
import {
  interfacePreferencesQueryOptions,
  providerOperationalSummaryQueryOptions,
  workspaceDraftAgentsQueryOptions,
  workspaceGalleryAgentsQueryOptions,
  workspaceModelsQueryOptions,
  workspaceProvidersQueryOptions,
} from "../lib/api-query-options";
import { useRouterApiClient } from "../lib/router-context";
import { optimisticMessagesQueryOptions } from "../lib/optimistic-message-query-options";
import {
  activeMessagePageQueryOptions,
  activeMessagePageSnapshot,
  isMessagePageResetError,
  resetActiveMessagePages,
  snapshotBranchLeafForChat,
} from "../lib/message-page-query";
import { resolveActiveAssistant } from "./assistant-selection";
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
    requestedLeafMessageId?: string;
  } = {},
) {
  // The selected workspace is owned by WorkspaceProvider (persisted +
  // validated). This deduplicates the same ["bootstrap"] query rather than
  // re-fetching. Falls back to nothing while the selection reconciles.
  const { latestChatEvent, subject, workspace } = useWorkspace();
  const queryClient = useQueryClient();
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
  const chatsQuery = useInfiniteQuery(
    chatsInfiniteQueryOptions(workspace?.id, apiClient),
  );
  const activeChatQuery = useQuery(
    chatQueryOptions(options.activeChatId, apiClient),
  );
  const messagePagesQuery = useInfiniteQuery(
    activeMessagePageQueryOptions(
      options.activeChatId,
      options.requestedLeafMessageId,
      apiClient,
    ),
  );
  // This disabled query is a client-only overlay. It contains only rows from
  // accepted turns that have not yet reconciled into the authoritative page.
  const optimisticMessagesQuery = useQuery(
    optimisticMessagesQueryOptions(options.activeChatId),
  );
  const chatExperienceQuery = useQuery(chatExperienceQueryOptions());
  const modelsQuery = useQuery(workspaceModelsQueryOptions(apiClient));
  const providersQuery = useQuery(workspaceProvidersQueryOptions(apiClient));
  const providerOperationalSummaryQuery = useQuery(
    providerOperationalSummaryQueryOptions(apiClient),
  );
  const interfacePreferencesQuery = useQuery(
    interfacePreferencesQueryOptions(apiClient),
  );

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
  const toolsQuery = useQuery(agentToolsQueryOptions(activeAgent?.id));

  const pageSnapshot = activeMessagePageSnapshot(messagePagesQuery.data?.pages);
  const optimisticMessages = optimisticMessagesQuery.data;
  const messages = useMemo(() => {
    const byId = new Map(
      (pageSnapshot?.messages ?? noMessages).map((message) => [
        message.id,
        message,
      ]),
    );
    for (const message of optimisticMessages) byId.set(message.id, message);
    return [...byId.values()];
  }, [optimisticMessages, pageSnapshot?.messages]);
  const loadOlderMessages = useCallback(async () => {
    const result = await messagePagesQuery.fetchNextPage();
    if (
      options.activeChatId !== undefined &&
      isMessagePageResetError(result.error)
    ) {
      await resetActiveMessagePages(queryClient, options.activeChatId);
    }
    return result;
  }, [messagePagesQuery, options.activeChatId, queryClient]);
  return {
    activeAgent,
    agents,
    allMessages: optimisticMessages,
    branchLeafMessageId: snapshotBranchLeafForChat(
      pageSnapshot,
      options.activeChatId,
    ),
    chats,
    chatExperience: chatExperienceQuery.data,
    chatsTotal: chatsQuery.data?.pages[0]?.total ?? 0,
    hasMoreChats: chatsQuery.hasNextPage,
    hasOlderMessages: pageSnapshot?.hasOlder ?? false,
    isLoadingOlderMessages: messagePagesQuery.isFetchingNextPage,
    isLoadingMoreChats: chatsQuery.isFetchingNextPage,
    loadMoreChats: chatsQuery.fetchNextPage,
    loadOlderMessages,
    models: modelsQuery.data ?? [],
    providerOperationalSummary: providerOperationalSummaryQuery.data,
    providers: providersQuery.data ?? [],
    interfacePreferences: interfacePreferencesQuery.data,
    latestChatEvent,
    messages,
    messagePageNeedsReset: isMessagePageResetError(messagePagesQuery.error),
    subject,
    tools: toolsQuery.data ?? [],
    variantsByMessageId: pageSnapshot?.variantsByMessageId ?? {},
    workspace,
  };
}
