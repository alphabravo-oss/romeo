import type { QueryClient } from "@tanstack/react-query";

import {
  cancelRun,
  getRun,
  streamRunEvents,
  type RunEvent,
} from "../features/runs";
import type { Message } from "../features/types";
import type { MessageKey } from "./i18n";
import { reduceToolCalls, type ChatToolCall } from "./run-tool-calls";

// A run outlives the panel that started it. Keeping the stream in React state
// meant unmounting the chat (switching chats, opening a settings route) killed
// the answer mid-sentence, which is why the UI used to refuse to navigate at
// all while streaming. This module owns the stream instead: deltas land in the
// per-chat query cache, and React only subscribes to a snapshot of it.
//
// ponytail: one Map keyed by chat, one global listener Set. Every listener is
// notified on every change and React bails out on an unchanged snapshot, so
// there is no per-chat listener bookkeeping. If a workspace ever streams into
// dozens of chats at once, key the Set by chatId.

export interface ChatRunActivity {
  id: string;
  label: string;
  state: "active" | "complete" | "error";
  type: RunEvent["type"];
}

export type ChatCitation = NonNullable<Message["citations"]>[number];

/**
 * What the model worked through before answering, and how long it spent there.
 *
 * ponytail: live only. `message.reasoning` is persisted as a run event and
 * replays by sequence, but it is not on the Message contract, so re-reading the
 * transcript after a reload brings back the answer without the thinking that
 * produced it. Upgrade path: a `reasoning` field on Message, written by the
 * same terminal persist that writes the content.
 */
export interface ChatReasoning {
  seconds: number;
  text: string;
}

/**
 * Live wait status while the provider has not produced a first token.
 * Updated once a second so the transcript can show "45s / 60s" instead of a
 * silent skeleton during long first-byte waits and retries.
 */
export interface ChatRunWait {
  /** 1-based attempt index (1 = first try, 2 = first retry, …). */
  attempt: number;
  /** Seconds since this attempt started waiting for the first token. */
  elapsedSeconds: number;
  /** True once any assistant content has arrived. */
  hasContent: boolean;
  /** Total attempts = maxRetries + 1. */
  maxAttempts: number;
  phase: "waiting" | "streaming" | "retrying" | "reconnecting";
  /** SSE reconnect attempts after a dropped stream (0 when healthy). */
  reconnectAttempts?: number;
  /** Cap used for user-visible recovery messaging. */
  maxReconnectAttempts?: number;
  /** Per-attempt idle timeout from the server, when known. */
  streamTimeoutMs?: number;
}

export interface ActiveRun {
  activities: ChatRunActivity[];
  assistantMessageId: string;
  chatId: string;
  citations: ChatCitation[];
  error?: string;
  isStreaming: boolean;
  reasoning?: ChatReasoning;
  runId: string;
  toolCalls: ChatToolCall[];
  wait?: ChatRunWait;
}

export const RUN_STREAM_MAX_RECONNECT_ATTEMPTS = 5;

interface TrackedRun extends ActiveRun {
  controller: AbortController;
  /** Model serving this run; written onto the optimistic assistant row. */
  modelId?: string;
  parentMessageId?: string;
  /** First reasoning event of the attempt: the other end of "thought for Ns". */
  reasoningStartedAt?: string;
  t: (key: MessageKey) => string;
  /** Epoch ms when the current wait attempt started. */
  waitAttemptStartedAt: number;
  waitTicker?: ReturnType<typeof setInterval>;
}

/** Whole seconds of thinking, floored at 1 so a fast model still reports one. */
export function reasoningSeconds(firstAt: string, lastAt: string): number {
  const elapsed = Date.parse(lastAt) - Date.parse(firstAt);
  return Number.isFinite(elapsed)
    ? Math.max(1, Math.round(elapsed / 1_000))
    : 1;
}

export interface TrackRunInput {
  chatId: string;
  runId: string;
  parentMessageId?: string;
  queryClient: QueryClient;
  t: (key: MessageKey) => string;
  onSettled?: (chatId: string, runId: string) => void | Promise<void>;
}

export const messagesQueryKey = (chatId: string) =>
  ["messages", chatId] as const;

const runs = new Map<string, TrackedRun>();
const listeners = new Set<() => void>();

export function subscribeToRuns(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getActiveRun(
  chatId: string | undefined,
): ActiveRun | undefined {
  return chatId === undefined ? undefined : runs.get(chatId);
}

/**
 * Attach to a run and stream it into `["messages", chatId]`. Idempotent per
 * chat, so mounting a panel or re-selecting a chat mid-answer rejoins the
 * existing stream instead of starting a second one.
 */
export function trackRun(input: TrackRunInput): void {
  const existing = runs.get(input.chatId);
  if (existing?.runId === input.runId && existing.isStreaming) return;
  existing?.controller.abort("superseded");
  stopWaitTicker(existing);
  const controller = new AbortController();
  const now = Date.now();
  const run: TrackedRun = {
    activities: [],
    // Mirrors the id the server mints on terminal persist, so the refresh that
    // follows replaces this row in place instead of duplicating the answer.
    //
    // ponytail: the client rebuilds a server primary key from a string
    // template, with no contract carrying the format. Change it in
    // packages/core/src/services/run-terminal-effects.ts and every finished
    // answer silently duplicates instead of replacing. Upgrade path: put the
    // persisted message id on the run.completed payload and drop the template.
    assistantMessageId: `msg_run_terminal_${input.runId}`,
    chatId: input.chatId,
    citations: [],
    controller,
    isStreaming: true,
    ...(input.parentMessageId === undefined
      ? {}
      : { parentMessageId: input.parentMessageId }),
    runId: input.runId,
    t: input.t,
    toolCalls: [],
    wait: {
      attempt: 1,
      elapsedSeconds: 0,
      hasContent: false,
      maxAttempts: 2,
      phase: "waiting",
      streamTimeoutMs: 60_000,
    },
    waitAttemptStartedAt: now,
  };
  runs.set(input.chatId, run);
  startWaitTicker(run);
  // Emptied, not just ensured: a re-attach replays the run's events from
  // sequence 0, so anything already in the row would be written twice.
  input.queryClient.setQueryData<Message[]>(
    messagesQueryKey(input.chatId),
    (current) =>
      withAssistantRow(current, run)?.map((message) =>
        message.id === run.assistantMessageId
          ? { ...message, content: "" }
          : message,
      ),
  );
  notify();
  void consumeRun(input, controller, run);
}

export function cancelActiveRun(chatId: string): void {
  const run = runs.get(chatId);
  if (run === undefined || !run.isStreaming) return;
  run.controller.abort();
  void cancelRun(run.runId).catch((caught) =>
    publish(chatId, run.runId, {
      error:
        caught instanceof Error ? caught.message : run.t("unableCancelRun"),
    }),
  );
  stopWaitTicker(run);
  publish(chatId, run.runId, { isStreaming: false });
}

function startWaitTicker(run: TrackedRun): void {
  stopWaitTicker(run);
  run.waitTicker = setInterval(() => {
    const current = runs.get(run.chatId);
    if (
      current === undefined ||
      current.runId !== run.runId ||
      !current.isStreaming
    ) {
      stopWaitTicker(current ?? run);
      return;
    }
    if (current.wait?.hasContent === true) return;
    const elapsedSeconds = Math.max(
      0,
      Math.floor((Date.now() - current.waitAttemptStartedAt) / 1_000),
    );
    if (current.wait?.elapsedSeconds === elapsedSeconds) return;
    publish(current.chatId, current.runId, {
      wait: {
        ...(current.wait ?? {
          attempt: 1,
          hasContent: false,
          maxAttempts: 2,
          phase: "waiting" as const,
        }),
        elapsedSeconds,
      },
    });
  }, 1_000);
  run.waitTicker.unref?.();
}

function stopWaitTicker(run: TrackedRun | undefined): void {
  if (run?.waitTicker === undefined) return;
  clearInterval(run.waitTicker);
  delete run.waitTicker;
}

function beginWaitAttempt(
  run: TrackedRun,
  phase: "waiting" | "retrying",
  attempt: number,
): void {
  run.waitAttemptStartedAt = Date.now();
  publish(run.chatId, run.runId, {
    wait: {
      attempt,
      elapsedSeconds: 0,
      hasContent: false,
      maxAttempts: run.wait?.maxAttempts ?? 2,
      phase,
      ...(run.wait?.streamTimeoutMs === undefined
        ? {}
        : { streamTimeoutMs: run.wait.streamTimeoutMs }),
    },
  });
  startWaitTicker(run);
}

/**
 * Optimistic message writes cancel any list request already in flight for the
 * same chat: a slow response that resolves afterwards would otherwise discard
 * the row the user just sent.
 */
export function writeChatMessages(
  queryClient: QueryClient,
  chatId: string,
  update: (current: Message[]) => Message[],
): void {
  void queryClient.cancelQueries({ queryKey: messagesQueryKey(chatId) });
  queryClient.setQueryData<Message[]>(messagesQueryKey(chatId), (current) =>
    update(current ?? []),
  );
}

function notify(): void {
  for (const listener of listeners) listener();
}

function publish(
  chatId: string,
  runId: string,
  patch: Partial<TrackedRun>,
): void {
  const current = runs.get(chatId);
  // A newer run already owns this chat; a straggler must not resurrect itself.
  if (current === undefined || current.runId !== runId) return;
  runs.set(chatId, { ...current, ...patch });
  notify();
}

async function consumeRun(
  input: TrackRunInput,
  controller: AbortController,
  run: TrackedRun,
): Promise<void> {
  const { chatId, queryClient, runId, t } = input;
  let afterSequence = 0;
  let reconnectAttempts = 0;

  try {
    const consumeEvents = async () => {
      while (!controller.signal.aborted) {
        let terminalSeen = false;
        try {
          for await (const event of streamRunEvents(
            runId,
            controller.signal,
            afterSequence,
          )) {
            if (event.sequence <= afterSequence) continue;
            afterSequence = event.sequence;
            if (reconnectAttempts > 0) {
              reconnectAttempts = 0;
              publish(chatId, runId, {
                wait: {
                  attempt: run.wait?.attempt ?? 1,
                  elapsedSeconds: run.wait?.elapsedSeconds ?? 0,
                  hasContent: run.wait?.hasContent ?? false,
                  maxAttempts: run.wait?.maxAttempts ?? 2,
                  phase: run.wait?.hasContent === true ? "streaming" : "waiting",
                  reconnectAttempts: 0,
                  maxReconnectAttempts: RUN_STREAM_MAX_RECONNECT_ATTEMPTS,
                  ...(run.wait?.streamTimeoutMs === undefined
                    ? {}
                    : { streamTimeoutMs: run.wait.streamTimeoutMs }),
                },
              });
            } else {
              reconnectAttempts = 0;
            }
            if (event.type === "run.started") {
              applyRunStarted(queryClient, run, event.data);
            }
            if (event.type === "message.started") {
              // Re-announce without content: retry/fallback dropped the previous
              // attempt. The first message.started of a run is not a retry.
              if (
                run.wait !== undefined &&
                !run.wait.hasContent &&
                run.wait.elapsedSeconds > 0
              ) {
                beginWaitAttempt(run, "retrying", run.wait.attempt + 1);
              }
            }
            if (event.type === "message.delta") {
              appendAssistantDelta(
                queryClient,
                run,
                (event.data as { text?: string }).text ?? "",
              );
              if (run.wait?.hasContent !== true) {
                stopWaitTicker(run);
                publish(chatId, runId, {
                  wait: {
                    attempt: run.wait?.attempt ?? 1,
                    elapsedSeconds: run.wait?.elapsedSeconds ?? 0,
                    hasContent: true,
                    maxAttempts: run.wait?.maxAttempts ?? 2,
                    phase: "streaming",
                    ...(run.wait?.streamTimeoutMs === undefined
                      ? {}
                      : { streamTimeoutMs: run.wait.streamTimeoutMs }),
                  },
                });
              }
            }
            consumeRunDetail(event, chatId, runId, t);
            if (event.type === "run.failed" || event.type === "run.cancelled") {
              // Inline on the assistant turn — not the composer footer.
              markAssistantRunError(queryClient, run, event, t);
            }
            if (
              event.type === "run.completed" ||
              event.type === "run.failed" ||
              event.type === "run.cancelled"
            ) {
              terminalSeen = true;
            }
          }
          if (terminalSeen || controller.signal.aborted) return;
          throw new Error(t("runStreamClosed"));
        } catch (caught) {
          if (controller.signal.aborted) return;
          reconnectAttempts += 1;
          publish(chatId, runId, {
            wait: {
              attempt: run.wait?.attempt ?? 1,
              elapsedSeconds: run.wait?.elapsedSeconds ?? 0,
              hasContent: run.wait?.hasContent ?? false,
              maxAttempts: run.wait?.maxAttempts ?? 2,
              phase: "reconnecting",
              reconnectAttempts,
              maxReconnectAttempts: RUN_STREAM_MAX_RECONNECT_ATTEMPTS,
              ...(run.wait?.streamTimeoutMs === undefined
                ? {}
                : { streamTimeoutMs: run.wait.streamTimeoutMs }),
            },
          });
          if (reconnectAttempts > RUN_STREAM_MAX_RECONNECT_ATTEMPTS)
            throw caught;
          await abortableDelay(
            Math.min(250 * 2 ** (reconnectAttempts - 1), 4_000),
            controller.signal,
          );
        }
      }
    };
    const observeTerminalRecord = waitForRunTerminal(
      runId,
      controller.signal,
    ).then((status) => {
      if (status === "failed" || status === "cancelled") {
        // Status poll wins when the event stream disconnects mid-timeout. Prefer
        // any error already written from a run.failed event; only fall back here.
        const messages = queryClient.getQueryData<Message[]>(
          messagesQueryKey(chatId),
        );
        const row = messages?.find(
          (message) => message.id === run.assistantMessageId,
        );
        if (row?.error === undefined) {
          markAssistantRunError(
            queryClient,
            run,
            {
              type: status === "cancelled" ? "run.cancelled" : "run.failed",
              data:
                status === "cancelled"
                  ? { errorCode: "run_cancelled" }
                  : { errorCode: "provider_run_failed" },
            },
            t,
          );
        }
      }
      if (status !== undefined) controller.abort("terminal run observed");
    });
    await Promise.race([consumeEvents(), observeTerminalRecord]);
  } catch (caught) {
    markAssistantRunError(
      queryClient,
      run,
      {
        type: "run.failed",
        data: {
          errorCode: "provider_run_failed",
          message:
            caught instanceof Error ? caught.message : t("providerFailed"),
        },
      },
      t,
    );
  } finally {
    controller.abort();
    stopWaitTicker(run);
    publish(chatId, runId, { isStreaming: false });
    await input.onSettled?.(chatId, runId);
  }
}

function applyRunStarted(
  queryClient: QueryClient,
  run: TrackedRun,
  data: unknown,
): void {
  const record =
    typeof data === "object" && data !== null
      ? (data as Record<string, unknown>)
      : {};
  const modelId =
    typeof record.modelId === "string" && record.modelId.length > 0
      ? record.modelId
      : undefined;
  if (modelId !== undefined) {
    run.modelId = modelId;
    stampAssistantModel(queryClient, run, modelId);
  }
  const streamTimeoutMs =
    typeof record.streamTimeoutMs === "number" &&
    Number.isFinite(record.streamTimeoutMs) &&
    record.streamTimeoutMs > 0
      ? record.streamTimeoutMs
      : 60_000;
  const maxRetries =
    typeof record.maxRetries === "number" &&
    Number.isFinite(record.maxRetries) &&
    record.maxRetries >= 0
      ? Math.floor(record.maxRetries)
      : 1;
  run.waitAttemptStartedAt = Date.now();
  publish(run.chatId, run.runId, {
    wait: {
      attempt: 1,
      elapsedSeconds: 0,
      hasContent: false,
      maxAttempts: maxRetries + 1,
      phase: "waiting",
      streamTimeoutMs,
    },
  });
  startWaitTicker(run);
}

/**
 * Re-asserts the streaming row on every write. The server has no assistant
 * message until the run reaches a terminal state, so any transcript refresh
 * that lands mid-answer comes back without it.
 *
 * `undefined` in, `undefined` out: when the transcript has not loaded (or has
 * been evicted) the updater must not conjure a one-message cache entry, which
 * would read as a loaded chat and suppress the fetch that fills it in.
 */
function withAssistantRow(
  current: Message[] | undefined,
  run: TrackedRun,
): Message[] | undefined {
  if (current === undefined) return undefined;
  if (current.some((message) => message.id === run.assistantMessageId)) {
    return current;
  }
  const parentId = run.parentMessageId ?? current.at(-1)?.id;
  return [
    ...current,
    {
      id: run.assistantMessageId,
      chatId: run.chatId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      ...(run.modelId === undefined ? {} : { modelId: run.modelId }),
      ...(parentId === undefined ? {} : { parentId }),
    },
  ];
}

function stampAssistantModel(
  queryClient: QueryClient,
  run: TrackedRun,
  modelId: string,
): void {
  queryClient.setQueryData<Message[]>(messagesQueryKey(run.chatId), (current) =>
    withAssistantRow(current, run)?.map((message) =>
      message.id === run.assistantMessageId
        ? { ...message, modelId }
        : message,
    ),
  );
}

function appendAssistantDelta(
  queryClient: QueryClient,
  run: TrackedRun,
  delta: string,
): void {
  // Addressed by id, never by position: the cache holds every message in the
  // chat, and a sibling branch can sit after the row being streamed.
  queryClient.setQueryData<Message[]>(messagesQueryKey(run.chatId), (current) =>
    withAssistantRow(current, run)?.map((message) =>
      message.id === run.assistantMessageId
        ? { ...message, content: message.content + delta }
        : message,
    ),
  );
}

function markAssistantRunError(
  queryClient: QueryClient,
  run: TrackedRun,
  event: Pick<RunEvent, "type" | "data">,
  t: (key: MessageKey) => string,
): void {
  const failure = providerRunFailure(event, t);
  queryClient.setQueryData<Message[]>(messagesQueryKey(run.chatId), (current) =>
    withAssistantRow(current, run)?.map((message) =>
      message.id === run.assistantMessageId
        ? {
            ...message,
            ...(run.modelId === undefined ? {} : { modelId: run.modelId }),
            error: {
              code: failure.code,
              message: failure.message,
            },
          }
        : message,
    ),
  );
  // Composer banner is for submit/transport failures, not model-run outcomes.
  const current = runs.get(run.chatId);
  if (current !== undefined && current.runId === run.runId) {
    const next = { ...current };
    delete next.error;
    runs.set(run.chatId, next);
    notify();
  }
}

function consumeRunDetail(
  event: RunEvent,
  chatId: string,
  runId: string,
  t: (key: MessageKey) => string,
): void {
  if (event.type === "message.reasoning" || event.type === "message.started")
    return trackReasoning(event, chatId, runId);
  const toolRun = runs.get(chatId);
  if (toolRun !== undefined && toolRun.runId === runId) {
    const toolCalls = reduceToolCalls(toolRun.toolCalls, event);
    if (toolCalls !== toolRun.toolCalls) publish(chatId, runId, { toolCalls });
  }
  if (event.type === "retrieval.completed") {
    const eventCitations = (event.data as { citations?: unknown }).citations;
    if (Array.isArray(eventCitations)) {
      publish(chatId, runId, {
        citations: eventCitations.flatMap((item) => {
          const citation = item as Partial<ChatCitation>;
          return typeof citation.chunkId === "string" &&
            typeof citation.documentId === "string" &&
            typeof citation.title === "string"
            ? [citation as ChatCitation]
            : [];
        }),
      });
    }
  }
  const activity = activityFromEvent(event, t);
  if (activity === undefined) return;
  const current = runs.get(chatId);
  if (current === undefined || current.runId !== runId) return;
  publish(chatId, runId, {
    activities: [
      ...current.activities.filter((item) => item.id !== activity.id),
      activity,
    ],
  });
}

// Reasoning arrives one delta at a time, exactly like the answer, so the panel
// is built by concatenation rather than replacement -- until the executor
// re-announces the message, which is how it disowns an abandoned attempt (a
// retry, a fallback to another model, a re-executed run). That thinking goes
// with it, clock included: it belongs to output the server threw away.
function trackReasoning(event: RunEvent, chatId: string, runId: string): void {
  const current = runs.get(chatId);
  if (current === undefined || current.runId !== runId) return;
  if (event.type === "message.started") {
    if (current.reasoning === undefined) return;
    const restarted = { ...current };
    delete restarted.reasoning;
    delete restarted.reasoningStartedAt;
    runs.set(chatId, restarted);
    notify();
    return;
  }
  const startedAt = current.reasoningStartedAt ?? event.createdAt;
  publish(chatId, runId, {
    reasoning: {
      seconds: reasoningSeconds(startedAt, event.createdAt),
      text:
        (current.reasoning?.text ?? "") +
        ((event.data as { text?: string }).text ?? ""),
    },
    reasoningStartedAt: startedAt,
  });
}

function abortableDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    function onAbort() {
      window.clearTimeout(timeout);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function waitForRunTerminal(
  runId: string,
  signal: AbortSignal,
): Promise<"cancelled" | "completed" | "failed" | undefined> {
  while (!signal.aborted) {
    try {
      const run = await getRun(runId);
      if (
        run.status === "cancelled" ||
        run.status === "completed" ||
        run.status === "failed"
      ) {
        return run.status;
      }
    } catch {
      // The event stream remains primary; transient status reads can recover.
    }
    try {
      await abortableDelay(500, signal);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function providerRunFailure(
  event: Pick<RunEvent, "type" | "data">,
  t: (key: MessageKey) => string,
): { code: string; message: string } {
  if (event.type === "run.cancelled") {
    return { code: "run_cancelled", message: t("responseStopped") };
  }
  const record =
    typeof event.data === "object" && event.data !== null
      ? (event.data as Record<string, unknown>)
      : {};
  const errorCode =
    typeof record.errorCode === "string" && record.errorCode.trim().length > 0
      ? record.errorCode.trim()
      : "provider_run_failed";
  const errorType =
    typeof record.errorType === "string" ? record.errorType : "";
  const explicit =
    typeof record.message === "string" && record.message.trim().length > 0
      ? record.message.trim()
      : undefined;
  if (explicit !== undefined) return { code: errorCode, message: explicit };
  if (errorCode === "provider_credential_unavailable") {
    return { code: errorCode, message: t("providerCredentialUnavailable") };
  }
  if (errorCode === "provider_stream_timeout") {
    return { code: errorCode, message: t("providerStreamTimeout") };
  }
  if (errorCode === "provider_stream_aborted" || errorCode === "run_cancelled") {
    return { code: errorCode, message: t("responseStopped") };
  }
  if (errorType.endsWith("http_401"))
    return { code: errorCode, message: t("providerRejectedKey") };
  if (errorType.endsWith("http_403"))
    return { code: errorCode, message: t("providerDenied") };
  if (errorType.endsWith("http_404"))
    return { code: errorCode, message: t("providerNotFound") };
  if (errorType.endsWith("http_429"))
    return { code: errorCode, message: t("providerRateLimited") };
  if (/http_5\d\d$/u.test(errorType))
    return { code: errorCode, message: t("providerUnavailable") };
  return { code: errorCode, message: t("providerFailed") };
}

function activityFromEvent(
  event: RunEvent,
  t: (key: MessageKey) => string,
): ChatRunActivity | undefined {
  const definitions: Partial<
    Record<RunEvent["type"], { label: string; state: ChatRunActivity["state"] }>
  > = {
    "run.started": {
      label: t("chatActivityGeneratingResponse"),
      state: "active",
    },
    "retrieval.completed": {
      label: t("chatActivitySourcesRetrieved"),
      state: "complete",
    },
    // tool.* is deliberately absent: a per-call card carries the tool's name,
    // arguments, result shape and duration, which one grey "Running tool" line
    // never could, and two renderings of the same event read as two calls.
    "run.continuing": {
      label: t("chatActivityContinuingAfterTool"),
      state: "active",
    },
    "run.completed": {
      label: t("chatActivityResponseComplete"),
      state: "complete",
    },
    "run.cancelled": {
      label: t("chatActivityResponseStopped"),
      state: "error",
    },
    "run.failed": {
      label: t("chatActivityResponseFailed"),
      state: "error",
    },
  };
  const definition = definitions[event.type];
  return definition === undefined
    ? undefined
    : {
        id: `${event.runId}:${event.type}`,
        label: definition.label,
        state: definition.state,
        type: event.type,
      };
}
