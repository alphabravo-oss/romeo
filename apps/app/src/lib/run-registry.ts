import type { QueryClient } from "@tanstack/react-query";
import { cancelRun, streamRunEvents } from "../features/runs";
import type { Message } from "../features/types";
import { rememberAppliedEvent } from "./run-registry-events";
import { consumeRunDetail } from "./run-registry-detail";
import {
  isRunNetworkTransportSuspended,
  presentRunTransportEvent,
  releaseActiveRunTransports,
  RUN_STREAM_MAX_RECONNECT_ATTEMPTS,
  suspendActiveRunTransports,
} from "./run-registry-connectivity";
import {
  abortableDelay,
  beginRunWaitAttempt,
  startRunWaitTicker,
  stopRunWaitTicker,
  waitForRunTerminal,
} from "./run-registry-wait";
import {
  commitAssistantMessage,
  flushAssistantDelta,
  initializeAssistantMessage,
  stopDeltaFlush,
  queueAssistantDelta,
  stampAssistantModel,
  streamingMessageQueryKey,
} from "./run-registry-messages";
import type {
  ActiveRun,
  TrackedRun,
  TrackRunInput,
} from "./run-registry-types";
import { safeUserErrorMessage } from "./safe-user-error";
import {
  markAssistantRunError as markAssistantRunErrorRecord,
  reconcileStreamingTranscript as reconcileStreamingTranscriptRecord,
} from "./run-registry-transcript";

export {
  messagesQueryKey,
  streamingMessageQueryKey,
  writeChatMessages,
} from "./run-registry-messages";
export { reasoningSeconds } from "./run-registry-events";
export { RUN_STREAM_MAX_RECONNECT_ATTEMPTS } from "./run-registry-connectivity";
export type {
  ActiveRun,
  ChatCitation,
  ChatReasoning,
  ChatRunActivity,
  ChatRunWait,
  RunStreamState,
  TrackRunInput,
} from "./run-registry-types";

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

/** Abort every live stream so tests cannot share the SSE mock queue. */
export function resetRunRegistryForTests(): void {
  for (const run of runs.values()) {
    stopWaitTicker(run);
    stopDeltaFlush(run);
    run.controller.abort("test_reset");
  }
  runs.clear();
}

export function getStreamingAssistantMessage(
  chatId: string,
  messageId: string,
): Message | undefined {
  const run = runs.get(chatId);
  return run?.assistantMessageId === messageId
    ? run.assistantBuffer.message
    : undefined;
}

/** Immediately stop presenting active SSE work as live while offline. */
export function markActiveRunsOffline(): void {
  suspendActiveRunTransports(runs, publish);
}

/** Release only runs whose transport proved active while security was checked. */
export function releaseActiveRunsAfterReconnect(): void {
  releaseActiveRunTransports(runs, publish);
}

/** Streams into a narrow cache entry, then commits stable topology once. */
export function trackRun(input: TrackRunInput): void {
  const existing = runs.get(input.chatId);
  if (existing?.runId === input.runId && existing.isStreaming) return;
  if (existing !== undefined) {
    // Do not strand the tail already accepted from SSE when a new run takes
    // ownership of the chat before the previous frame timer fires.
    flushAssistantDelta(existing.queryClient, existing);
    commitAssistantMessage(existing.queryClient, existing);
    existing.controller.abort("superseded");
  }
  stopWaitTicker(existing);
  const controller = new AbortController();
  const now = Date.now();
  const assistantMessageId = `msg_run_terminal_${input.runId}`;
  const networkSuspended = isRunNetworkTransportSuspended();
  const run: TrackedRun = {
    activities: [],
    // Mirrors the server ID; move it onto run.completed before changing format.
    assistantBuffer: {
      message: {
        id: assistantMessageId,
        chatId: input.chatId,
        role: "assistant",
        content: "",
        createdAt: new Date(now).toISOString(),
        ...(input.parentMessageId === undefined
          ? {}
          : { parentId: input.parentMessageId }),
      },
      pendingDelta: "",
    },
    assistantMessageId,
    chatId: input.chatId,
    citations: [],
    controller,
    isStreaming: true,
    networkActivityWhileSuspended: false,
    networkSuspended,
    ...(input.parentMessageId === undefined
      ? {}
      : { parentMessageId: input.parentMessageId }),
    runId: input.runId,
    streamState: networkSuspended ? "reconnecting" : "connecting",
    queryClient: input.queryClient,
    t: input.t,
    toolCalls: [],
    wait: {
      attempt: 1,
      elapsedSeconds: 0,
      hasContent: false,
      maxAttempts: 2,
      phase: networkSuspended ? "reconnecting" : "waiting",
      ...(networkSuspended
        ? {
            reconnectAttempts: 1,
            maxReconnectAttempts: RUN_STREAM_MAX_RECONNECT_ATTEMPTS,
          }
        : {}),
      streamTimeoutMs: 60_000,
    },
    timing: { waitAttemptStartedAt: now },
  };
  runs.set(input.chatId, run);
  startWaitTicker(run);
  // Re-attach replays from sequence 0, so reset the live row before consuming.
  initializeAssistantMessage(input.queryClient, run);
  notify();
  void consumeRun(input, controller, run);
}

export function cancelActiveRun(chatId: string): void {
  const run = runs.get(chatId);
  if (run === undefined || !run.isStreaming) return;
  flushAssistantDelta(run.queryClient, run);
  commitAssistantMessage(run.queryClient, run);
  run.controller.abort();
  void cancelRun(run.runId).catch((caught) =>
    publish(chatId, run.runId, {
      error: safeUserErrorMessage(caught, run.t("unableCancelRun")),
    }),
  );
  stopWaitTicker(run);
  publish(chatId, run.runId, {
    isStreaming: false,
    streamState: "cancelled",
  });
}

const startWaitTicker = (run: TrackedRun) =>
  startRunWaitTicker(run, runs, publish);
const stopWaitTicker = (run: TrackedRun | undefined) => stopRunWaitTicker(run);
const beginWaitAttempt = (
  run: TrackedRun,
  phase: "waiting" | "retrying",
  attempt: number,
) => beginRunWaitAttempt(run, runs, publish, phase, attempt);

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
  if (
    Object.entries(patch).every(([key, value]) =>
      Object.is(current[key as keyof TrackedRun], value),
    )
  )
    return;
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
  const appliedEventIds = new Set<string>();
  const appliedEventIdOrder: string[] = [];
  let reconnectAttempts = 0;

  try {
    const consumeEvents = async () => {
      while (!controller.signal.aborted) {
        let suspendedSeen = false;
        let terminalSeen = false;
        try {
          for await (const event of streamRunEvents(
            runId,
            controller.signal,
            afterSequence,
          )) {
            if (
              event.sequence <= afterSequence ||
              (typeof event.id === "string" && appliedEventIds.has(event.id))
            )
              continue;
            const networkSuspended = presentRunTransportEvent(
              runs,
              publish,
              chatId,
              runId,
              reconnectAttempts,
            );
            if (!networkSuspended) reconnectAttempts = 0;
            if (event.type === "run.started") {
              applyRunStarted(queryClient, run, event.data);
            }
            if (event.type === "message.started") {
              // An empty re-announcement means retry/fallback after attempt one.
              // Read the live entry: `run.wait` is the trackRun-time snapshot
              // and its elapsedSeconds never advances, so this never fired.
              const startedWait = runs.get(chatId)?.wait;
              if (
                startedWait !== undefined &&
                !startedWait.hasContent &&
                startedWait.elapsedSeconds > 0
              ) {
                beginWaitAttempt(run, "retrying", startedWait.attempt + 1);
              }
            }
            if (event.type === "message.delta") {
              queueAssistantDelta(
                queryClient,
                run,
                (event.data as { text?: string }).text ?? "",
              );
              const currentWait = runs.get(chatId)?.wait;
              if (currentWait?.hasContent !== true) {
                stopWaitTicker(run);
                const networkSuspended =
                  runs.get(chatId)?.networkSuspended === true;
                publish(chatId, runId, {
                  wait: {
                    attempt: currentWait?.attempt ?? 1,
                    elapsedSeconds: currentWait?.elapsedSeconds ?? 0,
                    hasContent: true,
                    maxAttempts: currentWait?.maxAttempts ?? 2,
                    phase: networkSuspended ? "reconnecting" : "streaming",
                    ...(networkSuspended
                      ? {
                          reconnectAttempts: Math.max(
                            currentWait?.reconnectAttempts ?? 0,
                            1,
                          ),
                          maxReconnectAttempts:
                            RUN_STREAM_MAX_RECONNECT_ATTEMPTS,
                        }
                      : {}),
                    ...(currentWait?.streamTimeoutMs === undefined
                      ? {}
                      : { streamTimeoutMs: currentWait.streamTimeoutMs }),
                  },
                });
              }
            }
            consumeRunDetail(event, chatId, runId, t, runs, publish, notify);
            if (event.type === "run.failed" || event.type === "run.cancelled") {
              flushAssistantDelta(queryClient, run);
              // Inline on the assistant turn — not the composer footer.
              markAssistantRunErrorRecord(
                queryClient,
                run,
                event,
                t,
                runs,
                notify,
              );
            }
            if (
              event.type === "run.completed" ||
              event.type === "run.failed" ||
              event.type === "run.cancelled"
            ) {
              flushAssistantDelta(queryClient, run);
              terminalSeen = true;
              publish(chatId, runId, {
                streamState:
                  event.type === "run.completed"
                    ? "completed"
                    : event.type === "run.cancelled"
                      ? "cancelled"
                      : "failed",
              });
            }
            if (
              event.type === "run.waiting_tool_approval" ||
              event.type === "run.waiting_tool_dispatch"
            ) {
              suspendedSeen = true;
              publish(chatId, runId, { streamState: "suspended" });
            }
            // Advance only after all reducers apply, so failures replay safely.
            afterSequence = event.sequence;
            if (typeof event.id === "string") {
              rememberAppliedEvent(
                event.id,
                appliedEventIds,
                appliedEventIdOrder,
              );
            }
          }
          if (terminalSeen || suspendedSeen || controller.signal.aborted)
            return;
          throw new Error(t("runStreamClosed"));
        } catch (caught) {
          if (controller.signal.aborted) return;
          reconnectAttempts += 1;
          // Carry the live wait forward, not the trackRun-time snapshot.
          // Reading `run.wait` here reset hasContent to false and
          // elapsedSeconds to 0 after a mid-stream reconnect, re-arming the
          // ticker and putting an already-streaming run back under the
          // "still waiting" spinner.
          const reconnectWait = runs.get(chatId)?.wait;
          publish(chatId, runId, {
            streamState: "reconnecting",
            wait: {
              attempt: reconnectWait?.attempt ?? 1,
              elapsedSeconds: reconnectWait?.elapsedSeconds ?? 0,
              hasContent: reconnectWait?.hasContent ?? false,
              maxAttempts: reconnectWait?.maxAttempts ?? 2,
              phase: "reconnecting",
              reconnectAttempts,
              maxReconnectAttempts: RUN_STREAM_MAX_RECONNECT_ATTEMPTS,
              ...(reconnectWait?.streamTimeoutMs === undefined
                ? {}
                : { streamTimeoutMs: reconnectWait.streamTimeoutMs }),
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
        publish(chatId, runId, { streamState: status });
        // Status poll wins when the event stream disconnects mid-timeout. Prefer
        // any error already written from a run.failed event; only fall back here.
        if (run.assistantBuffer.message.error === undefined) {
          markAssistantRunErrorRecord(
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
            runs,
            notify,
          );
        }
      }
      if (status !== undefined) controller.abort("terminal run observed");
    });
    await Promise.race([consumeEvents(), observeTerminalRecord]);
  } catch (caught) {
    publish(chatId, runId, { streamState: "failed" });
    markAssistantRunErrorRecord(
      queryClient,
      run,
      {
        type: "run.failed",
        data: {
          errorCode: "provider_run_failed",
          message: safeUserErrorMessage(caught, t("providerFailed")),
        },
      },
      t,
      runs,
      notify,
    );
  } finally {
    flushAssistantDelta(queryClient, run);
    commitAssistantMessage(queryClient, run);
    controller.abort();
    stopWaitTicker(run);
    publish(chatId, runId, { isStreaming: false });
    try {
      await input.onSettled?.(chatId, runId);
    } finally {
      queryClient.removeQueries({
        exact: true,
        queryKey: streamingMessageQueryKey(chatId, run.assistantMessageId),
      });
    }
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
    // modelId must reach the registry entry too, or getActiveRun(chatId).modelId
    // stays undefined for the whole run -- publish() copies the entry, so the
    // assignment above only ever touched the closure object.
    publish(run.chatId, run.runId, { modelId });
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
  run.timing.waitAttemptStartedAt = Date.now();
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

export function reconcileStreamingTranscript(
  chatId: string,
  current: Message[] | undefined,
  incoming: Message[],
): Message[] {
  return reconcileStreamingTranscriptRecord(
    chatId,
    current,
    incoming,
    runs.get(chatId),
  );
}

