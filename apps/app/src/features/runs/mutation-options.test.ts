import { MutationObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as appQueryKeys from "../../lib/app-query-keys";
import { createRomeoQueryClient } from "../../lib/query-client";
import {
  completeMutationNetworkRevalidation,
  markMutationNetworkOffline,
} from "../../lib/connectivity";
import { advanceMutationSessionBoundary } from "../../lib/mutation-session-boundary";
import {
  enqueueChatTurnMutationOptions,
  refreshAgentTestRunQueries,
} from "./mutation-options";

const mutationMocks = vi.hoisted(() => ({
  cancelQueuedTurn: vi.fn(),
  enqueueChatTurn: vi.fn(),
  startRun: vi.fn(),
}));

vi.mock("./mutations", () => mutationMocks);

describe("run mutation cache policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeMutationNetworkRevalidation();
    advanceMutationSessionBoundary();
  });

  it("refreshes exact test-run projections and every usage range", async () => {
    const client = createRomeoQueryClient();
    const chatsKey = appQueryKeys.chats("workspace-1");
    const otherChatsKey = appQueryKeys.chats("workspace-2");
    const dailyUsageKey = appQueryKeys.usageEvents("24h");
    const monthlyUsageKey = appQueryKeys.usageEvents("30d");
    client.setQueryData(chatsKey, []);
    client.setQueryData(otherChatsKey, []);
    client.setQueryData(dailyUsageKey, []);
    client.setQueryData(monthlyUsageKey, []);

    await refreshAgentTestRunQueries(client, "workspace-1");

    expect(client.getQueryState(chatsKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherChatsKey)?.isInvalidated).toBe(false);
    expect(client.getQueryState(dailyUsageKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(monthlyUsageKey)?.isInvalidated).toBe(true);
  });

  it("reconciles the exact queued-turn cache without touching another chat", async () => {
    const client = createRomeoQueryClient();
    const key = appQueryKeys.queuedTurns("chat-1");
    const otherKey = appQueryKeys.queuedTurns("chat-2");
    client.setQueryData(key, []);
    client.setQueryData(otherKey, [{ id: "other" }]);
    mutationMocks.enqueueChatTurn.mockResolvedValueOnce({
      chatId: "chat-1",
      content: "hello",
      createdAt: "2026-08-14T00:00:00.000Z",
      id: "turn-1",
      idempotencyKey: "idem-1",
      status: "queued",
    });
    const observer = new MutationObserver(
      client,
      enqueueChatTurnMutationOptions(),
    );

    await observer.mutate({
      agentId: "agent-1",
      chatId: "chat-1",
      content: "hello",
    });

    expect(client.getQueryData<Array<{ id: string }>>(key)?.[0]?.id).toBe(
      "turn-1",
    );
    expect(client.getQueryData(otherKey)).toEqual([{ id: "other" }]);
  });

  it("does not queue a run mutation while offline", async () => {
    const client = createRomeoQueryClient();
    markMutationNetworkOffline();
    const observer = new MutationObserver(
      client,
      enqueueChatTurnMutationOptions(),
    );

    await expect(
      observer.mutate({
        agentId: "agent-1",
        chatId: "chat-1",
        content: "hello",
      }),
    ).rejects.toMatchObject({ code: "mutation_network_blocked" });
    expect(mutationMocks.enqueueChatTurn).not.toHaveBeenCalled();
    expect(
      client
        .getMutationCache()
        .getAll()
        .some((entry) => entry.state.isPaused),
    ).toBe(false);
  });
});
