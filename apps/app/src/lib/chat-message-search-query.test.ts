import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";

import { queryCacheProfiles } from "./query-cache-policy";
import {
  CHAT_MESSAGE_SEARCH_LIMIT,
  chatMessageSearchInfiniteOptions,
  resetChatMessageSearch,
} from "./chat-message-search-query";

describe("chat message search query options", () => {
  it("uses a generated cancellable infinite query with bounded cursor pages", () => {
    const options = chatMessageSearchInfiniteOptions("chat-1", "  security  ");

    expect(options).toMatchObject({
      ...queryCacheProfiles.interactive,
      enabled: true,
      initialPageParam: {
        path: { chatId: "chat-1" },
        query: { limit: CHAT_MESSAGE_SEARCH_LIMIT, q: "security" },
      },
      meta: { ssr: false },
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
    });
    expect(
      options.getNextPageParam({
        data: [],
        meta: {
          hasMore: true,
          limit: 25,
          nextCursor: "opaque-cursor",
          total: 26,
          transcriptVersion: "4",
        },
      }),
    ).toBe("opaque-cursor");
    expect(options.queryKey[0]).toMatchObject({
      _id: "chatsSearchMessages",
      _infinite: true,
      path: { chatId: "chat-1" },
      query: { q: "security" },
    });
  });

  it("does not issue short, closed, or chatless searches", () => {
    expect(chatMessageSearchInfiniteOptions("chat-1", "x").enabled).toBe(false);
    expect(
      chatMessageSearchInfiniteOptions(undefined, "security").enabled,
    ).toBe(false);
  });

  it("cancels and resets only the exact stale search cursor chain", async () => {
    const cancelQueries = vi.fn<() => Promise<void>>().mockResolvedValue();
    const resetQueries = vi.fn<() => Promise<void>>().mockResolvedValue();
    const queryClient = {
      cancelQueries,
      resetQueries,
    } as unknown as QueryClient;
    const options = chatMessageSearchInfiniteOptions("chat-1", "security");

    await resetChatMessageSearch(queryClient, options);

    expect(cancelQueries).toHaveBeenCalledWith({
      exact: true,
      queryKey: options.queryKey,
    });
    expect(resetQueries).toHaveBeenCalledWith({
      exact: true,
      queryKey: options.queryKey,
    });
  });
});
