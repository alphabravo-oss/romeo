import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import type { Message } from "../features/types";
import { messagesQueryKey } from "../lib/run-registry";
import { chatPath } from "./message-tree";
import { useChatMessageState } from "./useChatMessageState";

vi.mock("../features", () => ({
  deleteMessage: vi.fn(() => Promise.resolve({})),
  updateAttachmentRetention: vi.fn(),
  updateMessageFeedback: vi.fn(),
}));

function message(id: string, parentId?: string): Message {
  return {
    id,
    chatId: "chat_x",
    role: id.startsWith("u") ? "user" : "assistant",
    content: id,
    // Distinct timestamps so ordering is the tree's, not a tie-break's.
    createdAt: `2026-08-11T00:00:0${id.slice(1)}.000Z`,
    ...(parentId === undefined ? {} : { parentId }),
  };
}

function seeded(): QueryClient {
  const queryClient = new QueryClient();
  queryClient.setQueryData<Message[]>(messagesQueryKey("chat_x"), [
    message("u1"),
    message("a1", "u1"),
    message("u2", "a1"),
    message("a2", "u2"),
  ]);
  return queryClient;
}

function idsOf(queryClient: QueryClient, leafId: string): string[] {
  const all =
    queryClient.getQueryData<Message[]>(messagesQueryKey("chat_x")) ?? [];
  return chatPath(all, leafId).map((item) => item.id);
}

// The server splices children onto their grandparent on delete. Until this
// cache did the same, deleting a turn mid-conversation left every row above it
// naming a parent that was gone -- and nothing refetched, because the
// transcript query is staleTime: Infinity.
describe("deleting a message", () => {
  it("keeps the turns above it on the branch", async () => {
    const queryClient = seeded();
    const state = useChatMessageState({
      activeChatId: "chat_x",
      isStreaming: false,
      queryClient,
      setError: () => {},
    });

    await state.handleDeleteMessage("u2");

    expect(idsOf(queryClient, "a2")).toEqual(["u1", "a1", "a2"]);
  });

  it("promotes the children of a deleted root", async () => {
    const queryClient = seeded();
    const state = useChatMessageState({
      activeChatId: "chat_x",
      isStreaming: false,
      queryClient,
      setError: () => {},
    });

    await state.handleDeleteMessage("u1");

    const all =
      queryClient.getQueryData<Message[]>(messagesQueryKey("chat_x")) ?? [];
    // Absent, not `undefined`: Message is exactOptionalPropertyTypes.
    expect("parentId" in all.find((item) => item.id === "a1")!).toBe(false);
    expect(idsOf(queryClient, "a2")).toEqual(["a1", "u2", "a2"]);
  });
});
