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
import type { Message } from "../features/types";
import { useRouterApiClient } from "../lib/router-context";
import { optimisticMessagesQueryOptions } from "../lib/optimistic-message-query-options";
import {
  activeMessagePageQueryOptions,
  activeMessagePageSnapshot,
  isMessagePageResetError,
  resetActiveMessagePages,
  snapshotBranchLeafForChat,
} from "../lib/message-page-query";
import { useWorkspaceCatalogData } from "./useWorkspaceCatalogData";
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
  const { workspace } = useWorkspace();
  const queryClient = useQueryClient();
  const apiClient = useRouterApiClient();
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
  const catalog = useWorkspaceCatalogData(activeAgentId, {
    ...(chatAgentId === undefined ? {} : { chatAgentId }),
    ...(options.includeDrafts === undefined
      ? {}
      : { includeDrafts: options.includeDrafts }),
    ...(options.requestedAgentId === undefined
      ? {}
      : { requestedAgentId: options.requestedAgentId }),
  });

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
    ...catalog,
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
    messages,
    messagePageNeedsReset: isMessagePageResetError(messagePagesQuery.error),
    variantsByMessageId: pageSnapshot?.variantsByMessageId ?? {},
  };
}
