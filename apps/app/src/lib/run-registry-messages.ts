import type { QueryClient } from "@tanstack/react-query";

import type { Message } from "../features/types";
import type { TrackedRun } from "./run-registry-types";
import * as appQueryKeys from "./app-query-keys";

/** Client-only topology rows that have not yet reconciled into a page. */
export const messagesQueryKey = appQueryKeys.optimisticMessages;
export const streamingMessageQueryKey = appQueryKeys.streamingMessage;

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

/**
 * Re-asserts the streaming row on every write. The server has no assistant
 * message until the run reaches a terminal state, so any transcript refresh
 * that lands mid-answer comes back without it.
 *
 * This cache is only an optimistic overlay, never historical server state, so
 * a background run may safely create its topology row after cache eviction.
 */
export function withAssistantRow(
  current: Message[] | undefined,
  run: TrackedRun,
): Message[] {
  const overlay = current ?? [];
  if (overlay.some((message) => message.id === run.assistantMessageId)) {
    return overlay;
  }
  const parentId = run.parentMessageId ?? overlay.at(-1)?.id;
  return [...overlay, topologyAssistantRow(run, parentId)];
}

export function reconcileAssistantTranscript(
  current: Message[] | undefined,
  incoming: Message[],
  run: TrackedRun,
): Message[] {
  const currentRow = current?.find(
    (message) => message.id === run.assistantMessageId,
  );
  const withoutOptimisticRow = incoming.filter(
    (message) => message.id !== run.assistantMessageId,
  );
  return withAssistantRow(
    currentRow === undefined
      ? withoutOptimisticRow
      : [...withoutOptimisticRow, currentRow],
    run,
  );
}

function topologyAssistantRow(
  run: TrackedRun,
  parentId: string | undefined,
): Message {
  return {
    ...run.assistantBuffer.message,
    // Growing output lives in its message-scoped cache entry. Keeping content
    // empty here makes this row a stable node in the transcript tree.
    content: "",
    ...(parentId === undefined ? {} : { parentId }),
  };
}

export function initializeAssistantMessage(
  queryClient: QueryClient,
  run: TrackedRun,
): void {
  queryClient.setQueryData<Message[]>(messagesQueryKey(run.chatId), (current) =>
    withAssistantRow(current, run).map((message) => {
      if (message.id !== run.assistantMessageId) return message;
      run.assistantBuffer.message = {
        ...run.assistantBuffer.message,
        ...(message.parentId === undefined
          ? {}
          : { parentId: message.parentId }),
      };
      return topologyAssistantRow(run, message.parentId);
    }),
  );
  queryClient.setQueryData<Message>(
    streamingMessageQueryKey(run.chatId, run.assistantMessageId),
    run.assistantBuffer.message,
  );
}

export function stampAssistantModel(
  queryClient: QueryClient,
  run: TrackedRun,
  modelId: string,
): void {
  run.assistantBuffer.message = { ...run.assistantBuffer.message, modelId };
  queryClient.setQueryData<Message>(
    streamingMessageQueryKey(run.chatId, run.assistantMessageId),
    run.assistantBuffer.message,
  );
  queryClient.setQueryData<Message[]>(messagesQueryKey(run.chatId), (current) =>
    withAssistantRow(current, run).map((message) =>
      message.id === run.assistantMessageId ? { ...message, modelId } : message,
    ),
  );
}

export function queueAssistantDelta(
  queryClient: QueryClient,
  run: TrackedRun,
  delta: string,
): void {
  if (delta.length === 0) return;
  run.assistantBuffer.pendingDelta += delta;
  if (run.assistantBuffer.flushTimer !== undefined) return;
  // A short cadence works in browsers, tests, and background tabs (where
  // requestAnimationFrame may be throttled indefinitely). It changes thousands
  // of token-sized events into at most one active-row update per frame.
  run.assistantBuffer.flushTimer = setTimeout(() => {
    delete run.assistantBuffer.flushTimer;
    flushAssistantDelta(queryClient, run);
  }, 16);
  run.assistantBuffer.flushTimer.unref?.();
}

export function flushAssistantDelta(
  queryClient: QueryClient,
  run: TrackedRun,
): void {
  stopDeltaFlush(run);
  const delta = run.assistantBuffer.pendingDelta;
  if (delta.length === 0) return;
  run.assistantBuffer.pendingDelta = "";
  run.assistantBuffer.message = {
    ...run.assistantBuffer.message,
    content: run.assistantBuffer.message.content + delta,
  };
  // Only the active row changes at frame cadence. The full transcript array is
  // deliberately untouched so branch topology, variants, artifacts, and every
  // stable message row retain their identities throughout the stream.
  queryClient.setQueryData<Message>(
    streamingMessageQueryKey(run.chatId, run.assistantMessageId),
    run.assistantBuffer.message,
  );
}

/** Commit the live row once at a run boundary, before the stream becomes idle. */
export function commitAssistantMessage(
  queryClient: QueryClient,
  run: TrackedRun,
): void {
  if (run.assistantBuffer.committed === run.assistantBuffer.message) return;
  queryClient.setQueryData<Message[]>(
    messagesQueryKey(run.chatId),
    (current) => {
      let found = false;
      const committed = (current ?? []).map((message) => {
        if (message.id !== run.assistantMessageId) return message;
        found = true;
        return {
          ...message,
          content: run.assistantBuffer.message.content,
          ...(run.assistantBuffer.message.modelId === undefined
            ? {}
            : { modelId: run.assistantBuffer.message.modelId }),
          ...(run.assistantBuffer.message.error === undefined
            ? {}
            : { error: run.assistantBuffer.message.error }),
        };
      });
      return found ? committed : [...committed, run.assistantBuffer.message];
    },
  );
  run.assistantBuffer.committed = run.assistantBuffer.message;
}

export function setAssistantRunError(
  queryClient: QueryClient,
  run: TrackedRun,
  error: NonNullable<Message["error"]>,
): void {
  run.assistantBuffer.message = {
    ...run.assistantBuffer.message,
    ...(run.modelId === undefined ? {} : { modelId: run.modelId }),
    error,
  };
  queryClient.setQueryData<Message>(
    streamingMessageQueryKey(run.chatId, run.assistantMessageId),
    run.assistantBuffer.message,
  );
}

export function stopDeltaFlush(run: TrackedRun | undefined): void {
  if (run?.assistantBuffer.flushTimer === undefined) return;
  clearTimeout(run.assistantBuffer.flushTimer);
  delete run.assistantBuffer.flushTimer;
}
