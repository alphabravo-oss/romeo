import { QueryClient, QueryObserver, skipToken } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Message } from "../features/types";
import { activeMessagePageQueryOptions } from "./message-page-query";
import {
  cancelActiveRun,
  getActiveRun,
  getStreamingAssistantMessage,
  markActiveRunsOffline,
  messagesQueryKey,
  reconcileStreamingTranscript,
  releaseActiveRunsAfterReconnect,
  resetRunRegistryForTests,
  reasoningSeconds,
  streamingMessageQueryKey,
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
      if (value instanceof Error) throw value;
      yield value;
    }
  },
}));

async function emit(event: Record<string, unknown> | null): Promise<void> {
  stream.push(event);
  // Let the consumer take the event, then wait past the 16ms cadence flush.
  await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
  await new Promise((resolve) => globalThis.setTimeout(resolve, 25));
}

function transcript(queryClient: QueryClient, chatId: string): Message[] {
  return queryClient.getQueryData<Message[]>(messagesQueryKey(chatId)) ?? [];
}

function answer(queryClient: QueryClient, chatId: string): string {
  const run = getActiveRun(chatId);
  const live =
    run === undefined
      ? undefined
      : queryClient.getQueryData<Message>(
          streamingMessageQueryKey(chatId, run.assistantMessageId),
        );
  return live?.content ?? transcript(queryClient, chatId).at(-1)?.content ?? "";
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
    releaseActiveRunsAfterReconnect();
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
  });

  afterEach(() => {
    resetRunRegistryForTests();
    while (stream.pending > 0) stream.take();
    vi.unstubAllGlobals();
  });

  // The whole point of moving the stream out of React: unmounting the chat
  // panel (switching chats, opening another route) used to abort the answer,
  // which is why the UI refused to navigate while streaming at all.
  it("keeps streaming into the message-scoped cache after subscribers detach", async () => {
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
    let scopedRemovals = 0;
    const unsubscribeCache = queryClient.getQueryCache().subscribe((event) => {
      if (
        event.type === "removed" &&
        event.query.queryKey[0] === "streamingMessage" &&
        event.query.queryKey[1] === "chat_1"
      )
        scopedRemovals += 1;
    });
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
    expect(scopedRemovals).toBe(1);
    expect(
      queryClient.getQueryData(
        streamingMessageQueryKey("chat_1", "msg_run_terminal_run_1"),
      ),
    ).toBeUndefined();
    unsubscribeCache();
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
      reconcileStreamingTranscript(
        "chat_3",
        current,
        (current ?? []).slice(0, 1),
      ),
    );
    await emit({
      type: "message.delta",
      runId: "run_3",
      sequence: 2,
      data: { text: "tial" },
    });
    await emit({
      type: "run.completed",
      runId: "run_3",
      sequence: 3,
      data: {},
    });
    await emit(null);

    expect(transcript(queryClient, "chat_3")).toHaveLength(2);
    expect(answer(queryClient, "chat_3")).toBe("partial");
  });

  it("batches a burst of token deltas into one transcript cache update", async () => {
    const queryClient = loadedChat("chat_batch");
    trackRun({
      chatId: "chat_batch",
      runId: "run_batch",
      queryClient,
      t: (key) => key,
    });
    let transcriptUpdates = 0;
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (
        event.type === "updated" &&
        event.query.queryHash.includes("chat_batch")
      ) {
        transcriptUpdates += 1;
      }
    });

    for (let sequence = 1; sequence <= 100; sequence += 1) {
      stream.push({
        type: "message.delta",
        runId: "run_batch",
        sequence,
        data: { text: "x" },
      });
    }
    stream.push({
      type: "run.completed",
      runId: "run_batch",
      sequence: 101,
      data: {},
    });
    stream.push(null);
    await new Promise((resolve) => globalThis.setTimeout(resolve, 30));
    unsubscribe();

    expect(answer(queryClient, "chat_batch")).toBe("x".repeat(100));
    expect(transcriptUpdates).toBeLessThanOrEqual(2);
  });

  it("keeps a 750-row topology stable across 2,000 streamed deltas", async () => {
    const chatId = "chat_long_stream";
    const queryClient = new QueryClient();
    const history: Message[] = Array.from({ length: 750 }, (_, index) => ({
      id: `history_${index}`,
      chatId,
      role: index % 2 === 0 ? "user" : "assistant",
      content: `message ${index}`,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      ...(index === 0 ? {} : { parentId: `history_${index - 1}` }),
    }));
    const pageOptions = activeMessagePageQueryOptions(
      chatId,
      history.at(-1)!.id,
    );
    const historicalPages = {
      pageParams: [pageOptions.initialPageParam],
      pages: [
        {
          data: history,
          meta: {
            activeBranchChanged: false,
            branchVariants: [],
            branchLeafMessageId: history.at(-1)!.id,
            currentActiveLeafMessageId: history.at(-1)!.id,
            direction: "older" as const,
            hasOlder: false,
            limit: 50,
            mode: "branch" as const,
            transcriptVersion: "750",
          },
        },
      ],
    };
    queryClient.setQueryData(pageOptions.queryKey, historicalPages);
    queryClient.setQueryData<Message[]>(messagesQueryKey(chatId), []);
    trackRun({
      chatId,
      runId: "run_long_stream",
      parentMessageId: history.at(-1)!.id,
      queryClient,
      t: (key) => key,
    });

    const stableTopology = queryClient.getQueryData(pageOptions.queryKey);
    const stableOverlay = transcript(queryClient, chatId);
    expect(stableOverlay).toHaveLength(1);
    expect(stableOverlay.at(-1)).toMatchObject({
      id: "msg_run_terminal_run_long_stream",
      parentId: "history_749",
    });
    let transcriptWrites = 0;
    let historicalWrites = 0;
    let liveRowWrites = 0;
    let runNotifications = 0;
    let transcriptObserverNotifications = 0;
    let liveRowObserverNotifications = 0;
    const unsubscribeRuns = subscribeToRuns(() => {
      runNotifications += 1;
    });
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated") return;
      const key = event.query.queryKey;
      if (key[0] === "streamingMessage" && key[1] === chatId) {
        liveRowWrites += 1;
      } else if (
        typeof key[0] === "object" &&
        key[0] !== null &&
        (key[0] as { _id?: string })._id === "chatsListMessagePage"
      ) {
        historicalWrites += 1;
      } else if (key[0] === "optimisticMessages" && key[1] === chatId) {
        transcriptWrites += 1;
      }
    });
    const transcriptObserver = new QueryObserver<Message[]>(queryClient, {
      queryKey: messagesQueryKey(chatId),
      queryFn: skipToken,
    });
    const historicalObserver = new QueryObserver(queryClient, {
      queryKey: pageOptions.queryKey,
      queryFn: skipToken,
    });
    const liveRowObserver = new QueryObserver<Message>(queryClient, {
      queryKey: streamingMessageQueryKey(
        chatId,
        "msg_run_terminal_run_long_stream",
      ),
      queryFn: skipToken,
    });
    const unsubscribeTranscriptObserver = transcriptObserver.subscribe(() => {
      transcriptObserverNotifications += 1;
    });
    let historicalObserverNotifications = 0;
    const unsubscribeHistoricalObserver = historicalObserver.subscribe(() => {
      historicalObserverNotifications += 1;
    });
    const unsubscribeLiveRowObserver = liveRowObserver.subscribe(() => {
      liveRowObserverNotifications += 1;
    });
    const transcriptObserverBaseline = transcriptObserverNotifications;
    const liveRowObserverBaseline = liveRowObserverNotifications;
    const historicalObserverBaseline = historicalObserverNotifications;

    for (let sequence = 1; sequence <= 2_000; sequence += 1) {
      stream.push({
        type: "message.delta",
        runId: "run_long_stream",
        sequence,
        data: { text: "x" },
      });
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 30));

    // `useWorkspaceData` keys its topology/variant memos by this reference, so
    // identity is direct evidence that neither derivation can rerun per frame.
    expect(queryClient.getQueryData(pageOptions.queryKey)).toBe(stableTopology);
    expect(transcript(queryClient, chatId)).toBe(stableOverlay);
    expect(historicalWrites).toBe(0);
    expect(transcriptWrites).toBe(0);
    expect(liveRowWrites).toBe(1);
    expect(runNotifications).toBe(2);
    expect(transcriptObserverNotifications - transcriptObserverBaseline).toBe(
      0,
    );
    expect(liveRowObserverNotifications - liveRowObserverBaseline).toBe(1);
    expect(historicalObserverNotifications - historicalObserverBaseline).toBe(
      0,
    );
    expect(answer(queryClient, chatId)).toBe("x".repeat(2_000));
    queryClient.removeQueries({
      queryKey: streamingMessageQueryKey(
        chatId,
        "msg_run_terminal_run_long_stream",
      ),
    });
    expect(
      getStreamingAssistantMessage(chatId, "msg_run_terminal_run_long_stream")
        ?.content,
    ).toBe("x".repeat(2_000));

    stream.push({
      type: "run.completed",
      runId: "run_long_stream",
      sequence: 2_001,
      data: {},
    });
    stream.push(null);
    await new Promise((resolve) => globalThis.setTimeout(resolve, 30));
    unsubscribe();
    unsubscribeRuns();
    unsubscribeTranscriptObserver();
    unsubscribeHistoricalObserver();
    unsubscribeLiveRowObserver();

    expect(transcriptWrites).toBe(1);
    expect(historicalWrites).toBe(0);
    const committedTranscript = transcript(queryClient, chatId);
    expect(committedTranscript.at(-1)?.content).toBe("x".repeat(2_000));
    expect(queryClient.getQueryData(pageOptions.queryKey)).toBe(stableTopology);
    expect(historicalPages.pages[0]!.data[0]).toBe(history[0]);
    expect(historicalPages.pages[0]!.data[375]).toBe(history[375]);
    expect(historicalPages.pages[0]!.data[749]).toBe(history[749]);
  });

  it("flushes and commits a pending frame exactly once when cancelled", async () => {
    const chatId = "chat_cancel_pending";
    const queryClient = loadedChat(chatId);
    trackRun({
      chatId,
      runId: "run_cancel_pending",
      queryClient,
      t: (key) => key,
    });
    let transcriptWrites = 0;
    let scopedRemovals = 0;
    const transcriptActions: string[] = [];
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[1] !== chatId) return;
      if (
        event.type === "updated" &&
        event.query.queryKey[0] === "optimisticMessages"
      ) {
        transcriptWrites += 1;
        transcriptActions.push(event.action.type);
      }
      if (
        event.type === "removed" &&
        event.query.queryKey[0] === "streamingMessage"
      )
        scopedRemovals += 1;
    });

    stream.push({
      type: "message.delta",
      runId: "run_cancel_pending",
      sequence: 1,
      data: { text: "accepted before cancel" },
    });
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    cancelActiveRun(chatId);
    stream.push(null);
    await new Promise((resolve) => globalThis.setTimeout(resolve, 25));
    unsubscribe();

    expect(transcript(queryClient, chatId).at(-1)?.content).toBe(
      "accepted before cancel",
    );
    expect(transcriptActions).toEqual(["success"]);
    expect(transcriptWrites).toBe(1);
    expect(scopedRemovals).toBe(1);
    expect(getActiveRun(chatId)).toMatchObject({
      isStreaming: false,
      streamState: "cancelled",
    });
  });

  it("deduplicates replay after reconnect and cleans the scoped row once", async () => {
    const chatId = "chat_reconnect_exact";
    const queryClient = loadedChat(chatId);
    trackRun({
      chatId,
      runId: "run_reconnect_exact",
      queryClient,
      t: (key) => key,
    });
    let scopedRemovals = 0;
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (
        event.type === "removed" &&
        event.query.queryKey[0] === "streamingMessage" &&
        event.query.queryKey[1] === chatId
      )
        scopedRemovals += 1;
    });

    await emit({
      id: "evt_reconnect_1",
      type: "message.delta",
      runId: "run_reconnect_exact",
      sequence: 1,
      data: { text: "a" },
    });
    stream.push(new Error("connection reset"));
    await new Promise((resolve) => globalThis.setTimeout(resolve, 285));
    stream.push({
      id: "evt_reconnect_1",
      type: "message.delta",
      runId: "run_reconnect_exact",
      sequence: 1,
      data: { text: "a" },
    });
    stream.push({
      id: "evt_reconnect_2",
      type: "message.delta",
      runId: "run_reconnect_exact",
      sequence: 2,
      data: { text: "b" },
    });
    stream.push({
      id: "evt_reconnect_3",
      type: "run.completed",
      runId: "run_reconnect_exact",
      sequence: 3,
      data: {},
    });
    stream.push(null);
    await new Promise((resolve) => globalThis.setTimeout(resolve, 35));
    unsubscribe();

    expect(transcript(queryClient, chatId).at(-1)?.content).toBe("ab");
    expect(scopedRemovals).toBe(1);
    expect(getActiveRun(chatId)).toMatchObject({
      isStreaming: false,
      streamState: "completed",
    });
  });

  it("never presents an active stream as live while the browser is offline", async () => {
    const chatId = "chat_browser_offline";
    const queryClient = loadedChat(chatId);
    trackRun({
      chatId,
      runId: "run_browser_offline",
      queryClient,
      t: (key) => key,
    });
    await emit({
      id: "evt_offline_1",
      type: "message.delta",
      runId: "run_browser_offline",
      sequence: 1,
      data: { text: "a" },
    });
    expect(getActiveRun(chatId)?.streamState).toBe("live");

    markActiveRunsOffline();
    expect(getActiveRun(chatId)).toMatchObject({
      streamState: "reconnecting",
      wait: { phase: "reconnecting" },
    });

    await emit({
      id: "evt_offline_2",
      type: "message.delta",
      runId: "run_browser_offline",
      sequence: 2,
      data: { text: "b" },
    });
    expect(getActiveRun(chatId)).toMatchObject({
      streamState: "reconnecting",
      wait: { phase: "reconnecting" },
    });
    expect(answer(queryClient, chatId)).toBe("ab");

    releaseActiveRunsAfterReconnect();
    expect(getActiveRun(chatId)).toMatchObject({
      streamState: "live",
      wait: { phase: "streaming" },
    });
    await emit({
      id: "evt_offline_3",
      type: "run.completed",
      runId: "run_browser_offline",
      sequence: 3,
      data: {},
    });
    await emit(null);
  });

  it("accumulates only provider-safe summaries outside the answer", async () => {
    const queryClient = loadedChat("chat_4");
    trackRun({
      chatId: "chat_4",
      runId: "run_4",
      queryClient,
      t: (key) => key,
    });

    await emit({
      type: "reasoning.summary.delta",
      runId: "run_4",
      sequence: 1,
      data: {
        classification: "provider_safe_summary",
        contentPolicyApplied: true,
        text: "First ",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await emit({
      type: "reasoning.summary.delta",
      runId: "run_4",
      sequence: 2,
      data: {
        classification: "provider_safe_summary",
        contentPolicyApplied: true,
        text: "then.",
      },
      createdAt: "2026-01-01T00:00:12.000Z",
    });
    await emit({
      type: "reasoning.summary.completed",
      runId: "run_4",
      sequence: 3,
      data: {
        classification: "provider_safe_summary",
        status: "completed",
        durationMs: 12_000,
      },
    });
    await emit({
      type: "message.delta",
      runId: "run_4",
      sequence: 4,
      data: { text: "Answer" },
    });
    await emit(null);

    expect(getActiveRun("chat_4")?.reasoning).toEqual({
      completed: true,
      seconds: 12,
      text: "First then.",
    });
    expect(answer(queryClient, "chat_4")).toBe("Answer");
  });

  it("ignores malicious unclassified reasoning replayed from persistence", async () => {
    const rawSentinel = "raw-private-ui-replay-secret";
    const queryClient = loadedChat("chat_private_reasoning");
    trackRun({
      chatId: "chat_private_reasoning",
      runId: "run_private_reasoning",
      queryClient,
      t: (key) => key,
    });

    await emit({
      type: "reasoning.summary.delta",
      runId: "run_private_reasoning",
      sequence: 1,
      data: { text: rawSentinel, authorization: "Bearer hidden" },
    });
    await emit({
      type: "message.delta",
      runId: "run_private_reasoning",
      sequence: 2,
      data: { text: "Public answer" },
    });
    await emit({
      type: "run.completed",
      runId: "run_private_reasoning",
      sequence: 3,
      data: {},
    });
    await emit(null);

    expect(getActiveRun("chat_private_reasoning")?.reasoning).toBeUndefined();
    expect(
      JSON.stringify(getActiveRun("chat_private_reasoning")),
    ).not.toContain(rawSentinel);
    expect(answer(queryClient, "chat_private_reasoning")).toBe("Public answer");
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
      type: "reasoning.summary.delta",
      runId: "run_6",
      sequence: 2,
      data: {
        classification: "provider_safe_summary",
        contentPolicyApplied: true,
        text: "Dead provider ",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await emit({
      type: "reasoning.summary.delta",
      runId: "run_6",
      sequence: 3,
      data: {
        classification: "provider_safe_summary",
        contentPolicyApplied: true,
        text: "thinking.",
      },
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
      type: "reasoning.summary.delta",
      runId: "run_6",
      sequence: 5,
      data: {
        classification: "provider_safe_summary",
        contentPolicyApplied: true,
        text: "Fresh ",
      },
      createdAt: "2026-01-01T00:00:42.000Z",
    });
    await emit({
      type: "reasoning.summary.delta",
      runId: "run_6",
      sequence: 6,
      data: {
        classification: "provider_safe_summary",
        contentPolicyApplied: true,
        text: "thinking.",
      },
      createdAt: "2026-01-01T00:00:45.000Z",
    });
    await emit({
      type: "reasoning.summary.completed",
      runId: "run_6",
      sequence: 7,
      data: {
        classification: "provider_safe_summary",
        status: "completed",
        durationMs: 3_000,
      },
    });
    await emit({
      type: "message.delta",
      runId: "run_6",
      sequence: 8,
      data: { text: "Answer" },
    });
    await vi.waitFor(() => {
      expect(answer(queryClient, "chat_6")).toBe("Answer");
    });
    await emit({
      type: "run.completed",
      runId: "run_6",
      sequence: 9,
      data: {},
    });
    await emit(null);

    expect(getActiveRun("chat_6")?.reasoning).toEqual({
      completed: true,
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
    await emit({
      type: "run.completed",
      runId: "run_5",
      sequence: 3,
      data: {},
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
    let transcriptWrites = 0;
    let scopedRemovals = 0;
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[1] !== "chat_2") return;
      if (
        event.type === "updated" &&
        event.query.queryKey[0] === "optimisticMessages"
      )
        transcriptWrites += 1;
      if (
        event.type === "removed" &&
        event.query.queryKey[0] === "streamingMessage"
      )
        scopedRemovals += 1;
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
    unsubscribe();

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
    expect(transcriptWrites).toBe(1);
    expect(scopedRemovals).toBe(1);
  });

  it("settles as suspended when a tool approval pauses the stream", async () => {
    const queryClient = loadedChat("chat_suspended");
    trackRun({
      chatId: "chat_suspended",
      runId: "run_suspended",
      queryClient,
      t: (key) => key,
    });

    await emit({
      id: "evt_run_suspended_1",
      type: "run.waiting_tool_approval",
      runId: "run_suspended",
      sequence: 1,
      data: { toolId: "write_crm" },
    });
    await emit(null);

    expect(getActiveRun("chat_suspended")).toMatchObject({
      isStreaming: false,
      streamState: "suspended",
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
