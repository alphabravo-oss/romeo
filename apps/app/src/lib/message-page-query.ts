import { RomeoApiError } from "@romeo/api-client";
import {
  chatsListMessagePageInfiniteOptions,
  type ChatsListMessagePageResponse,
} from "@romeo/api-client/generated/query";
import type { GeneratedQueryClient } from "@romeo/api-client/runtime/generated-query-client";
import type {
  InfiniteData,
  Query,
  QueryClient,
} from "@tanstack/react-query";

import type { Message } from "../features/types";
import { queryCacheProfiles } from "./query-cache-policy";
import { devQueryDiagnosticMeta } from "./query-cache-diagnostics";

export const MESSAGE_PAGE_LIMIT = 50;

export function activeMessagePageQueryOptions(
  chatId: string | undefined,
  branchLeafOrClient?: string | GeneratedQueryClient,
  client?: GeneratedQueryClient,
) {
  const branchLeafMessageId =
    typeof branchLeafOrClient === "string" ? branchLeafOrClient : undefined;
  const requestClient =
    typeof branchLeafOrClient === "string" || branchLeafOrClient === undefined
      ? client
      : branchLeafOrClient;
  const request = {
    ...(requestClient === undefined ? {} : { client: requestClient }),
    path: { chatId: chatId ?? "" },
    query: {
      direction: "older" as const,
      limit: MESSAGE_PAGE_LIMIT,
      ...(branchLeafMessageId === undefined ? {} : { branchLeafMessageId }),
    },
  };
  return {
    ...chatsListMessagePageInfiniteOptions(request),
    ...queryCacheProfiles.interactive,
    enabled: chatId !== undefined,
    initialPageParam: { path: request.path, query: request.query },
    placeholderData: keepPreviousMessagePages(chatId),
    getNextPageParam: (lastPage: ChatsListMessagePageResponse) =>
      lastPage.meta.hasOlder ? lastPage.meta.olderCursor : undefined,
    meta: {
      // Message bodies are authorized browser data and never cross SSR
      // dehydration. The request-scoped client is still safe if this hook is
      // rendered on the server because it cannot leak into another request.
      ssr: false,
      ...devQueryDiagnosticMeta("activeMessagePages", {
        branchLeafMessageId,
        chatId,
      }),
    },
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  };
}

export interface ActiveMessagePageSnapshot {
  activeBranchChanged: boolean;
  branchLeafMessageId: string | undefined;
  currentActiveLeafMessageId: string | undefined;
  hasOlder: boolean;
  messages: Message[];
  variantsByMessageId: Record<string, MessageBranchVariants>;
  mode: "branch" | "linear";
  resetRequired: boolean;
  transcriptVersion: string;
}

export interface MessageBranchVariants {
  index: number;
  nextLeafMessageId?: string;
  previousLeafMessageId?: string;
  total: number;
}

export function activeMessagePageSnapshot(
  pages: readonly ChatsListMessagePageResponse[] | undefined,
): ActiveMessagePageSnapshot | undefined {
  if (pages === undefined || pages.length === 0) return undefined;
  const first = pages[0]!;
  const oldest = pages.at(-1)!;
  const branchLeafMessageId = first.meta.branchLeafMessageId;
  const mode = first.meta.mode;
  const transcriptVersion = first.meta.transcriptVersion;
  const structurallyMixed = pages.some(
    (page) =>
      page.meta.branchLeafMessageId !== branchLeafMessageId ||
      page.meta.mode !== mode ||
      page.meta.transcriptVersion !== transcriptVersion,
  );
  const byId = new Map<string, Message>();
  for (const page of [...pages].reverse()) {
    for (const message of page.data) byId.set(message.id, message);
  }
  const activeBranchChanged = pages.some(
    (page) => page.meta.activeBranchChanged,
  );
  const variantsByMessageId: Record<string, MessageBranchVariants> = {};
  for (const page of pages) {
    for (const variant of page.meta.branchVariants) {
      variantsByMessageId[variant.messageId] = {
        index: variant.index,
        ...(variant.nextLeafMessageId === undefined
          ? {}
          : { nextLeafMessageId: variant.nextLeafMessageId }),
        ...(variant.previousLeafMessageId === undefined
          ? {}
          : { previousLeafMessageId: variant.previousLeafMessageId }),
        total: variant.total,
      };
    }
  }
  return {
    activeBranchChanged,
    branchLeafMessageId,
    currentActiveLeafMessageId: oldest.meta.currentActiveLeafMessageId,
    hasOlder: oldest.meta.hasOlder && oldest.meta.olderCursor !== undefined,
    messages: [...byId.values()],
    mode,
    // A reader-scoped explicit leaf is intentionally allowed to differ from
    // the chat's shared default. Only mixed cursor snapshots require reset.
    resetRequired: structurallyMixed,
    transcriptVersion,
    variantsByMessageId,
  };
}

/** Same-chat branch switches keep the last page; chat switches must not. */
export function keepPreviousMessagePages(chatId: string | undefined) {
  return (
    previousData: InfiniteData<ChatsListMessagePageResponse> | undefined,
    previousQuery?: Pick<Query, "queryKey">,
  ): InfiniteData<ChatsListMessagePageResponse> | undefined => {
    if (previousData === undefined || chatId === undefined) return undefined;
    if (messagePageQueryChatId(previousQuery) !== chatId) return undefined;
    const belongsToChat = previousData.pages.every((page) =>
      page.data.every((message) => message.chatId === chatId),
    );
    return belongsToChat ? previousData : undefined;
  };
}

export function snapshotBranchLeafForChat(
  snapshot: ActiveMessagePageSnapshot | undefined,
  chatId: string | undefined,
): string | undefined {
  if (snapshot === undefined || chatId === undefined) return undefined;
  if (snapshot.messages.some((message) => message.chatId !== chatId)) {
    return undefined;
  }
  return snapshot.branchLeafMessageId;
}

function messagePageQueryChatId(
  query: Pick<Query, "queryKey"> | undefined,
): string | undefined {
  const head = query?.queryKey[0];
  if (typeof head !== "object" || head === null) return undefined;
  const chatId = (head as { path?: { chatId?: unknown } }).path?.chatId;
  return typeof chatId === "string" && chatId.length > 0 ? chatId : undefined;
}

export function isMessagePageResetError(error: unknown): boolean {
  return (
    error instanceof RomeoApiError &&
    (error.code === "invalid_page_cursor" ||
      error.code === "message_page_reset_required")
  );
}

export function isActiveMessagePageQuery(
  query: Query,
  chatId: string,
): boolean {
  const head = query.queryKey[0];
  if (typeof head !== "object" || head === null) return false;
  const key = head as {
    _id?: unknown;
    _infinite?: unknown;
    path?: { chatId?: unknown };
  };
  return (
    key._id === "chatsListMessagePage" &&
    key._infinite === true &&
    key.path?.chatId === chatId
  );
}

/** Cancels only this chat's page reads, discards cursors, and restarts page 1. */
export async function resetActiveMessagePages(
  queryClient: QueryClient,
  chatId: string,
): Promise<void> {
  const predicate = (query: Query) => isActiveMessagePageQuery(query, chatId);
  await queryClient.cancelQueries({ predicate });
  await queryClient.resetQueries({ predicate });
}
