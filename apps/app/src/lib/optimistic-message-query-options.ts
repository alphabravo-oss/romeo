import { queryOptions } from "@tanstack/react-query";

import type { Message } from "../features/types";
import { queryCacheProfiles } from "./query-cache-policy";
import { devQueryDiagnosticMeta } from "./query-cache-diagnostics";
import { messagesQueryKey } from "./run-registry";

const noOptimisticMessages: Message[] = [];

/**
 * Client-only overlay for accepted rows not yet present in authoritative
 * transcript pages. This never fetches; the run registry is its sole writer.
 * The growing assistant row remains the narrower streamingMessage exception.
 */
export function optimisticMessagesQueryOptions(chatId: string | undefined) {
  return queryOptions({
    ...queryCacheProfiles.interactive,
    enabled: false,
    initialData: noOptimisticMessages,
    queryFn: async () => noOptimisticMessages,
    queryKey: messagesQueryKey(chatId ?? ""),
    meta: {
      ssr: false,
      ...devQueryDiagnosticMeta("optimisticMessages", { chatId }),
    },
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}
