import { runsStreamEvents } from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

import type { RunEvent } from "./types";

const streamIdleTimeoutMs = 15_000;

export async function* streamRunEvents(
  runId: string,
  signal?: AbortSignal,
  afterSequence = 0,
): AsyncIterable<RunEvent> {
  configureBrowserApiClients();
  const idleController = new AbortController();
  // Re-armed on every reset, so the window measures the gap between events. A
  // timer armed once would instead cap the whole answer, dropping a model that
  // streams for longer than the window even while tokens keep arriving.
  let idleHandle: number | undefined;
  const resetIdle = () => {
    window.clearTimeout(idleHandle);
    idleHandle = window.setTimeout(
      () => idleController.abort("run stream idle timeout"),
      streamIdleTimeoutMs,
    );
  };
  resetIdle();
  const forwardAbort = () => idleController.abort(signal?.reason);
  signal?.addEventListener("abort", forwardAbort, { once: true });
  let streamError: unknown;

  try {
    const result = await runsStreamEvents({
      path: { runId },
      query: { after: afterSequence },
      headers: {
        accept: "text/event-stream",
        "last-event-id": String(afterSequence),
      },
      signal: idleController.signal,
      sseMaxRetryAttempts: 1,
      onSseEvent: resetIdle,
      onSseError: (error) => {
        streamError = error;
      },
    });
    for await (const value of result.stream) {
      if (isRunEvent(value)) yield value;
      // Any traffic -- events and keep-alives alike -- means the stream is
      // alive, so the window measures silence rather than total duration.
      resetIdle();
    }
    if (!signal?.aborted && streamError !== undefined) throw streamError;
  } finally {
    window.clearTimeout(idleHandle);
    signal?.removeEventListener("abort", forwardAbort);
    idleController.abort();
  }
}

function isRunEvent(value: unknown): value is RunEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    "type" in value &&
    typeof value.type === "string" &&
    "runId" in value &&
    typeof value.runId === "string" &&
    value.runId.length > 0 &&
    "sequence" in value &&
    Number.isSafeInteger(value.sequence) &&
    (value.sequence as number) >= 0 &&
    (!("schemaVersion" in value) || value.schemaVersion === 1)
  );
}
