import { RomeoApiError } from "@romeo/api-client";
import { createGeneratedQueryClient } from "@romeo/api-client/runtime/generated-query-client";
import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import type { Message } from "../features/types";
import { streamingMessage as streamingMessageQueryKey } from "./app-query-keys";
import {
  activeMessagePageQueryOptions,
  activeMessagePageSnapshot,
  isMessagePageResetError,
  keepPreviousMessagePages,
  resetActiveMessagePages,
  snapshotBranchLeafForChat,
} from "./message-page-query";

const message = (
  id: string,
  parentId?: string,
  role: Message["role"] = "assistant",
): Message => ({
  chatId: "chat-1",
  content: id,
  createdAt: `2026-08-14T00:00:0${id.slice(-1)}.000Z`,
  id,
  ...(parentId === undefined ? {} : { parentId }),
  role,
});

const page = (
  data: Message[],
  input: {
    activeBranchChanged?: boolean;
    branchVariants?: Array<{
      index: number;
      messageId: string;
      nextLeafMessageId?: string;
      previousLeafMessageId?: string;
      total: number;
    }>;
    branchLeafMessageId?: string;
    currentActiveLeafMessageId?: string;
    hasOlder?: boolean;
    mode?: "branch" | "linear";
    olderCursor?: string;
    transcriptVersion?: string;
  } = {},
) => ({
  data,
  meta: {
    activeBranchChanged: input.activeBranchChanged ?? false,
    branchVariants: input.branchVariants ?? [],
    ...(input.branchLeafMessageId === undefined
      ? {}
      : { branchLeafMessageId: input.branchLeafMessageId }),
    ...(input.currentActiveLeafMessageId === undefined
      ? {}
      : { currentActiveLeafMessageId: input.currentActiveLeafMessageId }),
    direction: "older" as const,
    hasOlder: input.hasOlder ?? false,
    limit: 50,
    mode: input.mode ?? (input.branchLeafMessageId ? "branch" : "linear"),
    ...(input.olderCursor === undefined
      ? {}
      : { olderCursor: input.olderCursor }),
    transcriptVersion: input.transcriptVersion ?? "7",
  },
});

describe("active message page query", () => {
  it("merges older pages in branch order and rejects mixed snapshots", () => {
    const snapshot = activeMessagePageSnapshot([
      page([message("m3"), message("m4", "m3")], {
        branchLeafMessageId: "m4",
        branchVariants: [
          {
            index: 1,
            messageId: "m3",
            previousLeafMessageId: "old-leaf",
            total: 2,
          },
        ],
      }),
      page([message("m1", undefined, "user"), message("m2", "m1")], {
        branchLeafMessageId: "m4",
      }),
    ]);
    expect(snapshot?.messages.map(({ id }) => id)).toEqual([
      "m1",
      "m2",
      "m3",
      "m4",
    ]);
    expect(snapshot?.variantsByMessageId.m3).toEqual({
      index: 1,
      previousLeafMessageId: "old-leaf",
      total: 2,
    });
    expect(
      activeMessagePageSnapshot([
        page([message("m4")], {
          activeBranchChanged: true,
          branchLeafMessageId: "m4",
        }),
      ])?.resetRequired,
    ).toBe(false);
    expect(
      activeMessagePageSnapshot([
        page([message("m4")], { branchLeafMessageId: "m4" }),
        page([message("m1")], { branchLeafMessageId: "other" }),
      ])?.resetRequired,
    ).toBe(true);
    expect(
      activeMessagePageSnapshot([
        page([message("m4")], {
          branchLeafMessageId: "m4",
          transcriptVersion: "7",
        }),
        page([message("m1")], {
          branchLeafMessageId: "m4",
          transcriptVersion: "8",
        }),
      ])?.resetRequired,
    ).toBe(true);
  });

  it("uses a generated, browser-only infinite key and sends its cursor", async () => {
    const urls: string[] = [];
    const apiClient = createGeneratedQueryClient({
      baseUrl: "https://romeo.test",
      fetchImpl: (input) => {
        urls.push(String(input));
        return Promise.resolve(
          Response.json(
            urls.length === 1
              ? page([], { hasOlder: true, olderCursor: "signed-cursor" })
              : page([]),
          ),
        );
      },
    });
    const options = activeMessagePageQueryOptions("chat-1", apiClient);
    const queryClient = new QueryClient();
    const observer = new InfiniteQueryObserver(queryClient, options);

    await observer.refetch();
    await observer.fetchNextPage();

    expect(options.queryKey[0]).toMatchObject({
      _id: "chatsListMessagePage",
      _infinite: true,
      path: { chatId: "chat-1" },
      query: { direction: "older", limit: 50 },
    });
    expect(options.queryKey[0].query).not.toHaveProperty("branchLeafMessageId");
    expect(options.meta?.ssr).toBe(false);
    expect(urls[0]).toContain("direction=older");
    expect(urls[1]).toContain("cursor=signed-cursor");
  });

  it("cancels and resets only the requested chat", async () => {
    let signal: AbortSignal | undefined;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const apiClient = createGeneratedQueryClient({
      baseUrl: "https://romeo.test",
      fetchImpl: (_input, init) => {
        signal = init?.signal ?? undefined;
        markStarted();
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      },
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const first = activeMessagePageQueryOptions("chat-1", apiClient);
    const other = activeMessagePageQueryOptions("chat-2", apiClient);
    const liveRowKey = streamingMessageQueryKey("chat-1", "assistant-live");
    queryClient.setQueryData(liveRowKey, message("assistant-live"));
    queryClient.setQueryData(other.queryKey, {
      pages: [page([])],
      pageParams: [],
    });
    const pending = queryClient
      .fetchInfiniteQuery(first)
      .catch(() => undefined);
    await started;

    await resetActiveMessagePages(queryClient, "chat-1");
    await pending;

    expect(signal?.aborted).toBe(true);
    expect(queryClient.getQueryData(first.queryKey)).toBeUndefined();
    expect(queryClient.getQueryData(other.queryKey)).toBeDefined();
    expect(queryClient.getQueryData(liveRowKey)).toMatchObject({
      id: "assistant-live",
    });
  });

  it("keeps placeholder pages only for the same chat", () => {
    const previous = {
      pageParams: [],
      pages: [page([message("m4")], { branchLeafMessageId: "m4" })],
    };
    const previousQuery = {
      queryKey: [
        { _id: "chatsListMessagePage", path: { chatId: "chat-1" } },
      ],
    };
    expect(
      keepPreviousMessagePages("chat-1")(previous, previousQuery),
    ).toBe(previous);
    expect(
      keepPreviousMessagePages("chat-2")(previous, previousQuery),
    ).toBeUndefined();
    expect(
      snapshotBranchLeafForChat(
        activeMessagePageSnapshot(previous.pages),
        "chat-1",
      ),
    ).toBe("m4");
    expect(
      snapshotBranchLeafForChat(
        activeMessagePageSnapshot(previous.pages),
        "chat-2",
      ),
    ).toBeUndefined();
  });

  it("recognizes only privacy-safe cursor reset codes", () => {
    for (const code of ["invalid_page_cursor", "message_page_reset_required"]) {
      expect(
        isMessagePageResetError(
          new RomeoApiError("untrusted detail", 409, {
            error: {
              code,
              message: "untrusted detail",
              request_id: "request-1",
            },
          }),
        ),
      ).toBe(true);
    }
    expect(isMessagePageResetError(new Error("invalid_page_cursor"))).toBe(
      false,
    );
  });
});
