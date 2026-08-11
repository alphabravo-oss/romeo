import type { QueryClient } from "@tanstack/react-query";

import {
  cancelRun,
  getRun,
  streamRunEvents,
  type RunEvent,
} from "../features/runs";
import type { Message } from "../features/types";
import type { MessageKey } from "./i18n";

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

export interface ActiveRun {
  activities: ChatRunActivity[];
  assistantMessageId: string;
  chatId: string;
  citations: ChatCitation[];
  error?: string;
  isStreaming: boolean;
  runId: string;
}

interface TrackedRun extends ActiveRun {
  controller: AbortController;
  parentMessageId?: string;
  t: (key: MessageKey) => string;
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
  const controller = new AbortController();
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
  };
  runs.set(input.chatId, run);
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
  publish(chatId, run.runId, { isStreaming: false });
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
  patch: Partial<ActiveRun>,
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
            reconnectAttempts = 0;
            if (event.type === "message.delta") {
              appendAssistantDelta(
                queryClient,
                run,
                (event.data as { text?: string }).text ?? "",
              );
            }
            consumeRunActivity(event, chatId, runId, t);
            if (event.type === "run.failed") {
              publish(chatId, runId, {
                error: providerRunFailureMessage(event.data, t),
              });
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
          if (reconnectAttempts > 5) throw caught;
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
      if (status === "failed")
        publish(chatId, runId, { error: t("providerFailed") });
      if (status !== undefined) controller.abort("terminal run observed");
    });
    await Promise.race([consumeEvents(), observeTerminalRecord]);
  } catch (caught) {
    publish(chatId, runId, {
      error: caught instanceof Error ? caught.message : t("providerFailed"),
    });
  } finally {
    controller.abort();
    publish(chatId, runId, { isStreaming: false });
    await input.onSettled?.(chatId, runId);
  }
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
      ...(parentId === undefined ? {} : { parentId }),
    },
  ];
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

function consumeRunActivity(
  event: RunEvent,
  chatId: string,
  runId: string,
  t: (key: MessageKey) => string,
): void {
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

function providerRunFailureMessage(
  data: unknown,
  t: (key: MessageKey) => string,
): string {
  const record =
    typeof data === "object" && data !== null
      ? (data as Record<string, unknown>)
      : {};
  const errorCode =
    typeof record.errorCode === "string" ? record.errorCode : "";
  const errorType =
    typeof record.errorType === "string" ? record.errorType : "";
  if (errorCode === "provider_credential_unavailable") {
    return t("providerCredentialUnavailable");
  }
  if (errorType.endsWith("http_401")) return t("providerRejectedKey");
  if (errorType.endsWith("http_403")) return t("providerDenied");
  if (errorType.endsWith("http_404")) return t("providerNotFound");
  if (errorType.endsWith("http_429")) return t("providerRateLimited");
  if (/http_5\d\d$/u.test(errorType)) return t("providerUnavailable");
  if (errorCode === "provider_stream_aborted") return t("responseStopped");
  return t("providerFailed");
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
    "tool.started": {
      label: t("chatActivityRunningTool"),
      state: "active",
    },
    "tool.approval_required": {
      label: t("chatActivityToolApprovalRequired"),
      state: "active",
    },
    "tool.completed": {
      label: t("chatActivityToolCompleted"),
      state: "complete",
    },
    "tool.failed": {
      label: t("chatActivityToolFailed"),
      state: "error",
    },
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
