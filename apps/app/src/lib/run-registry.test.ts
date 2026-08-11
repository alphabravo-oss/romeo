import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Message } from "../features/types";
import {
  getActiveRun,
  messagesQueryKey,
  subscribeToRuns,
  trackRun,
} from "./run-registry";

// A hand-driven stand-in for the SSE iterator: the test pushes events and a
// `null` closes the stream, so a run can be held open across assertions.
const stream = vi.hoisted(() => {
  const queued: unknown[] = [];
  let wake: (() => void) | undefined;
  return {
    push(value: unknown) {
      queued.push(value);
      wake?.();
      wake = undefined;
    },
    next(): Promise<void> {
      return new Promise<void>((resolve) => {
        wake = resolve;
      });
    },
    take(): unknown {
      return queued.shift();
    },
    get pending(): number {
      return queued.length;
    },
  };
});

vi.mock("../features/runs", () => ({
  cancelRun: vi.fn(() => Promise.resolve({})),
  getRun: vi.fn(() => Promise.resolve({ status: "running" })),
  async *streamRunEvents() {
    while (true) {
      if (stream.pending === 0) await stream.next();
      const value = stream.take();
      if (value === null) return;
      yield value;
    }
  },
}));

async function emit(event: Record<string, unknown> | null): Promise<void> {
  stream.push(event);
  await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

function transcript(queryClient: QueryClient, chatId: string): Message[] {
  return queryClient.getQueryData<Message[]>(messagesQueryKey(chatId)) ?? [];
}

function answer(queryClient: QueryClient, chatId: string): string {
  return transcript(queryClient, chatId).at(-1)?.content ?? "";
}

/** The loaded transcript a run streams into: one persisted user turn. */
function loadedChat(chatId: string): QueryClient {
  const queryClient = new QueryClient();
  queryClient.setQueryData<Message[]>(messagesQueryKey(chatId), [
    {
      id: `${chatId}_user`,
      chatId,
      role: "user",
      content: "Hello?",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ]);
  return queryClient;
}

describe("run registry", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // The whole point of moving the stream out of React: unmounting the chat
  // panel (switching chats, opening another route) used to abort the answer,
  // which is why the UI refused to navigate while streaming at all.
  it("keeps streaming into the chat cache after every subscriber detaches", async () => {
    const queryClient = loadedChat("chat_1");
    const settled: string[] = [];
    const unsubscribe = subscribeToRuns(() => {});
    trackRun({
      chatId: "chat_1",
      runId: "run_1",
      queryClient,
      t: (key) => key,
      onSettled: (chatId, runId) => {
        settled.push(`${chatId}:${runId}`);
      },
    });

    expect(transcript(queryClient, "chat_1")).toHaveLength(2);
    await emit({
      type: "message.delta",
      runId: "run_1",
      sequence: 1,
      data: { text: "Hel" },
    });
    expect(answer(queryClient, "chat_1")).toBe("Hel");

    // The user navigates away: React drops its subscription entirely.
    unsubscribe();
    await emit({
      type: "message.delta",
      runId: "run_1",
      sequence: 2,
      data: { text: "lo" },
    });
    expect(answer(queryClient, "chat_1")).toBe("Hello");
    expect(getActiveRun("chat_1")?.isStreaming).toBe(true);

    await emit({
      type: "run.completed",
      runId: "run_1",
      sequence: 3,
      data: {},
    });
    await emit(null);
    expect(getActiveRun("chat_1")?.isStreaming).toBe(false);
    expect(answer(queryClient, "chat_1")).toBe("Hello");
    expect(settled).toEqual(["chat_1:run_1"]);
  });

  // The server has no assistant message until the run finishes, so any
  // transcript refresh that lands mid-answer comes back without the row being
  // streamed. Losing it would silently drop every remaining delta.
  it("re-asserts the streaming row after a refresh drops it", async () => {
    const queryClient = loadedChat("chat_3");
    trackRun({
      chatId: "chat_3",
      runId: "run_3",
      queryClient,
      t: (key) => key,
    });
    await emit({
      type: "message.delta",
      runId: "run_3",
      sequence: 1,
      data: { text: "par" },
    });

    queryClient.setQueryData<Message[]>(messagesQueryKey("chat_3"), (current) =>
      (current ?? []).slice(0, 1),
    );
    await emit({
      type: "message.delta",
      runId: "run_3",
      sequence: 2,
      data: { text: "tial" },
    });
    await emit(null);

    expect(transcript(queryClient, "chat_3")).toHaveLength(2);
    expect(answer(queryClient, "chat_3")).toBe("tial");
  });

  it("records a provider failure on the chat's run instead of losing it", async () => {
    const queryClient = loadedChat("chat_2");
    trackRun({
      chatId: "chat_2",
      runId: "run_2",
      queryClient,
      t: (key) => key,
    });

    await emit({
      type: "run.failed",
      runId: "run_2",
      sequence: 1,
      data: { errorType: "provider.http_429" },
    });
    await emit(null);

    expect(getActiveRun("chat_2")?.error).toBe("providerRateLimited");
    expect(getActiveRun("chat_2")?.isStreaming).toBe(false);
  });
});
