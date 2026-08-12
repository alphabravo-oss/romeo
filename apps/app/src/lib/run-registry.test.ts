import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Message } from "../features/types";
import {
  getActiveRun,
  messagesQueryKey,
  reasoningSeconds,
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

  // Reasoning arrives delta by delta like the answer does, and must stay out of
  // the answer: it is a scratchpad, not content the user asked for.
  it("accumulates reasoning without leaking it into the answer", async () => {
    const queryClient = loadedChat("chat_4");
    trackRun({
      chatId: "chat_4",
      runId: "run_4",
      queryClient,
      t: (key) => key,
    });

    await emit({
      type: "message.reasoning",
      runId: "run_4",
      sequence: 1,
      data: { text: "First " },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await emit({
      type: "message.reasoning",
      runId: "run_4",
      sequence: 2,
      data: { text: "then." },
      createdAt: "2026-01-01T00:00:12.000Z",
    });
    await emit({
      type: "message.delta",
      runId: "run_4",
      sequence: 3,
      data: { text: "Answer" },
    });
    await emit(null);

    expect(getActiveRun("chat_4")?.reasoning).toEqual({
      seconds: 12,
      text: "First then.",
    });
    expect(answer(queryClient, "chat_4")).toBe("Answer");
  });

  // A provider that thinks then dies before answering keeps its retry and
  // fallback budget, so a second attempt streams onto the same run. Its
  // predecessor's thinking is not part of this answer.
  it("drops the reasoning of an attempt the server abandoned", async () => {
    const queryClient = loadedChat("chat_6");
    trackRun({
      chatId: "chat_6",
      runId: "run_6",
      queryClient,
      t: (key) => key,
    });

    await emit({
      type: "message.started",
      runId: "run_6",
      sequence: 1,
      data: { role: "assistant" },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await emit({
      type: "message.reasoning",
      runId: "run_6",
      sequence: 2,
      data: { text: "Dead provider " },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await emit({
      type: "message.reasoning",
      runId: "run_6",
      sequence: 3,
      data: { text: "thinking." },
      createdAt: "2026-01-01T00:00:40.000Z",
    });
    expect(getActiveRun("chat_6")?.reasoning?.seconds).toBe(40);

    // The primary died mid-thought; the fallback restarts the message.
    await emit({
      type: "message.started",
      runId: "run_6",
      sequence: 4,
      data: { role: "assistant" },
      createdAt: "2026-01-01T00:00:41.000Z",
    });
    expect(getActiveRun("chat_6")?.reasoning).toBeUndefined();

    await emit({
      type: "message.reasoning",
      runId: "run_6",
      sequence: 5,
      data: { text: "Fresh " },
      createdAt: "2026-01-01T00:00:42.000Z",
    });
    await emit({
      type: "message.reasoning",
      runId: "run_6",
      sequence: 6,
      data: { text: "thinking." },
      createdAt: "2026-01-01T00:00:45.000Z",
    });
    await emit({
      type: "message.delta",
      runId: "run_6",
      sequence: 7,
      data: { text: "Answer" },
    });
    await emit(null);

    expect(getActiveRun("chat_6")?.reasoning).toEqual({
      seconds: 3,
      text: "Fresh thinking.",
    });
    expect(answer(queryClient, "chat_6")).toBe("Answer");
  });

  // The card replaces the grey "Running tool" line, so the same event must not
  // also produce an activity row: that would read as two calls.
  it("turns tool events into cards instead of activity lines", async () => {
    const queryClient = loadedChat("chat_5");
    trackRun({
      chatId: "chat_5",
      runId: "run_5",
      queryClient,
      t: (key) => key,
    });

    await emit({
      type: "tool.started",
      runId: "run_5",
      sequence: 1,
      data: { toolId: "search_web", riskLevel: "low" },
      createdAt: "2026-01-01T00:00:01.000Z",
    });
    await emit({
      type: "tool.completed",
      runId: "run_5",
      sequence: 2,
      data: { toolId: "search_web", outputKeys: ["results"] },
      createdAt: "2026-01-01T00:00:03.000Z",
    });
    await emit(null);

    const run = getActiveRun("chat_5");
    expect(run?.toolCalls).toHaveLength(1);
    expect(run?.toolCalls[0]).toMatchObject({
      durationMs: 2_000,
      name: "search_web",
      state: "completed",
    });
    expect(run?.activities.map((activity) => activity.type)).not.toContain(
      "tool.started",
    );
  });

  it("records a provider failure inline on the assistant turn", async () => {
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
      data: {
        errorCode: "provider_stream_timeout",
        errorType: "provider.http_429",
      },
    });
    await emit(null);

    // Composer banner stays clear — the transcript owns the failure.
    expect(getActiveRun("chat_2")?.error).toBeUndefined();
    expect(getActiveRun("chat_2")?.isStreaming).toBe(false);
    const messages = queryClient.getQueryData<Message[]>(
      messagesQueryKey("chat_2"),
    );
    expect(messages?.at(-1)).toMatchObject({
      id: "msg_run_terminal_run_2",
      role: "assistant",
      error: {
        code: "provider_stream_timeout",
        message: "providerStreamTimeout",
      },
    });
  });
});

describe("reasoningSeconds", () => {
  it("reports whole seconds between the first and last reasoning event", () => {
    expect(
      reasoningSeconds("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:12.400Z"),
    ).toBe(12);
  });

  it("never reports zero, so a fast model still reads as having thought", () => {
    expect(
      reasoningSeconds("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.080Z"),
    ).toBe(1);
  });

  it("falls back to one second on an unparseable timestamp", () => {
    expect(reasoningSeconds("not-a-date", "2026-01-01T00:00:05.000Z")).toBe(1);
  });
});
