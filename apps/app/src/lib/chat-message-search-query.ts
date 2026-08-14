import {
  chatsSearchMessagesInfiniteOptions,
  type ChatsSearchMessagesResponse,
} from "@romeo/api-client/generated/query";
import type { GeneratedQueryClient } from "@romeo/api-client/runtime/generated-query-client";
import type { QueryClient } from "@tanstack/react-query";

import { queryCacheProfiles } from "./query-cache-policy";
import { devQueryDiagnosticMeta } from "./query-cache-diagnostics";

export const CHAT_MESSAGE_SEARCH_LIMIT = 25;

export function chatMessageSearchInfiniteOptions(
  chatId: string | undefined,
  query: string,
  client?: GeneratedQueryClient,
) {
  const normalizedQuery = query.normalize("NFKC").trim();
  const request = {
    ...(client === undefined ? {} : { client }),
    path: { chatId: chatId ?? "" },
    query: { limit: CHAT_MESSAGE_SEARCH_LIMIT, q: normalizedQuery },
  };
  return {
    ...chatsSearchMessagesInfiniteOptions(request),
    ...queryCacheProfiles.interactive,
    enabled: chatId !== undefined && normalizedQuery.length >= 2,
    initialPageParam: { path: request.path, query: request.query },
    getNextPageParam: (lastPage: ChatsSearchMessagesResponse) =>
      lastPage.meta.hasMore ? lastPage.meta.nextCursor : undefined,
    meta: {
      ssr: false,
      ...devQueryDiagnosticMeta("chatMessageSearch", {
        chatId,
        queryLength: normalizedQuery.length,
      }),
    },
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  };
}

export type ChatMessageSearchHit = ChatsSearchMessagesResponse["data"][number];

export async function resetChatMessageSearch(
  queryClient: QueryClient,
  options: ReturnType<typeof chatMessageSearchInfiniteOptions>,
): Promise<void> {
  await queryClient.cancelQueries({ exact: true, queryKey: options.queryKey });
  await queryClient.resetQueries({ exact: true, queryKey: options.queryKey });
}
