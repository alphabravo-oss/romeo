import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type { GeneratedQueryClient } from "@romeo/api-client/runtime/generated-query-client";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  abortableQuery,
  serverQueryPolicy,
} from "../../lib/server-query-options";
import {
  getChat,
  listChats,
  listChatsPage,
  listMessageFeedback,
  searchChats,
} from "./queries";

export function chatsQueryOptions(
  workspaceId: string | undefined,
  view?: "collaboration",
) {
  return queryOptions({
    ...serverQueryPolicy("interactive", "chats", { view, workspaceId }),
    queryKey: appQueryKeys.chats(workspaceId, view),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () => listChats(workspaceId!)),
    enabled: workspaceId !== undefined,
  });
}

export function chatsInfiniteQueryOptions(
  workspaceId?: string,
  client?: GeneratedQueryClient,
) {
  return infiniteQueryOptions({
    ...serverQueryPolicy("interactive", "chats", { workspaceId }),
    queryKey: appQueryKeys.chats(workspaceId),
    queryFn: ({ pageParam, signal }) =>
      abortableQuery(signal, () =>
        listChatsPage(
          workspaceId!,
          { limit: 50, offset: pageParam },
          client,
          signal,
        ),
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.offset + lastPage.items.length : undefined,
    enabled: workspaceId !== undefined,
  });
}

export function routeChatsInfiniteQueryOptions(
  workspaceId: string,
  client: GeneratedQueryClient,
) {
  const options = chatsInfiniteQueryOptions(workspaceId, client);
  return infiniteQueryOptions({
    ...options,
    meta: { ...options.meta, ssr: true },
  });
}

export function chatQueryOptions(
  chatId?: string,
  client?: GeneratedQueryClient,
) {
  return queryOptions({
    ...serverQueryPolicy("interactive", "chat", { chatId }),
    queryKey: appQueryKeys.chat(chatId),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () => getChat(chatId!, client, signal)),
    enabled: chatId !== undefined,
  });
}

export function routeChatMetadataQueryOptions(
  chatId: string,
  client: GeneratedQueryClient,
) {
  const options = chatQueryOptions(chatId, client);
  return queryOptions({
    ...options,
    meta: { ...options.meta, ssr: true },
  });
}

export function chatSearchQueryOptions(
  workspaceId: string | undefined,
  query: string,
) {
  return queryOptions({
    ...serverQueryPolicy("interactive", "chatSearch", {
      query,
      workspaceId,
    }),
    queryKey: appQueryKeys.chatSearch(workspaceId, query),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () => searchChats(workspaceId!, query)),
    enabled: workspaceId !== undefined && query.length >= 2,
  });
}

export function messageFeedbackQueryOptions(chatId?: string) {
  return queryOptions({
    ...serverQueryPolicy("interactive", "messageFeedback", { chatId }),
    queryKey: appQueryKeys.messageFeedback(chatId),
    queryFn: ({ signal }) =>
      abortableQuery(signal, async () =>
        Object.fromEntries(
          (await listMessageFeedback(chatId!)).map((item) => [
            item.messageId,
            item,
          ]),
        ),
      ),
    enabled: chatId !== undefined,
  });
}
