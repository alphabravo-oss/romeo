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
  const idleTimer = window.setTimeout(
    () => idleController.abort("run stream idle timeout"),
    streamIdleTimeoutMs,
  );
  const forwardAbort = () => idleController.abort(signal?.reason);
  signal?.addEventListener("abort", forwardAbort, { once: true });
  let streamError: unknown;

  try {
    const result = await runsStreamEvents({
      path: { runId },
      query: { after: afterSequence },
      headers: { accept: "text/event-stream" },
      signal: idleController.signal,
      sseMaxRetryAttempts: 1,
      onSseError: (error) => {
        streamError = error;
      },
    });
    for await (const value of result.stream) {
      if (isRunEvent(value)) yield value;
    }
    if (!signal?.aborted && streamError !== undefined) throw streamError;
  } finally {
    window.clearTimeout(idleTimer);
    signal?.removeEventListener("abort", forwardAbort);
    idleController.abort();
  }
}

function isRunEvent(value: unknown): value is RunEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "runId" in value &&
    "sequence" in value
  );
}
