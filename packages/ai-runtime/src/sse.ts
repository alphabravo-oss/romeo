import { publicRunEvent, type RunEvent } from "./events";

export interface SseStreamObserver {
  onBufferedBytes?(bytes: number): void;
  onClose?(): void;
  onHeartbeatFailure?(): void;
  onOpen?(): void;
  onSlowConsumerDrop?(): void;
  onTerminalCloseLatency?(milliseconds: number): void;
}

export function encodeSseEvent(event: RunEvent): string {
  const safeEvent = publicRunEvent(event);
  return `event: ${safeEvent.type}\nid: ${safeEvent.sequence}\ndata: ${JSON.stringify({ ...safeEvent, schemaVersion: 1 })}\n\n`;
}

export function createSseStream(
  events: AsyncIterable<RunEvent>,
  options: {
    heartbeatMs?: number;
    maxBackpressureMs?: number;
    maxBufferedBytes?: number;
    maxEventBytes?: number;
    observer?: SseStreamObserver;
    retryMs?: number;
  } = {},
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iterator = events[Symbol.asyncIterator]();
  const maxBufferedBytes = Math.max(1, options.maxBufferedBytes ?? 256_000);
  const maxEventBytes = Math.max(1, options.maxEventBytes ?? 1_000_000);
  let cancelled = false;
  let closeObserved = false;
  let resumeCapacity: (() => void) | undefined;
  let terminalEnqueuedAt: number | undefined;

  const observeClose = () => {
    if (closeObserved) return;
    closeObserved = true;
    options.observer?.onClose?.();
  };

  return new ReadableStream(
    {
      async start(controller) {
        options.observer?.onOpen?.();
        try {
          if (options.retryMs !== undefined) {
            await enqueueBounded(
              controller,
              encoder.encode(`retry: ${Math.max(0, options.retryMs)}\n\n`),
            );
          }
          let pending = iterator.next();
          while (!cancelled) {
            const result =
              options.heartbeatMs === undefined
                ? await pending
                : await nextOrHeartbeat(pending, options.heartbeatMs);
            if (result === heartbeat) {
              try {
                await enqueueBounded(
                  controller,
                  encoder.encode(": heartbeat\n\n"),
                );
              } catch (error) {
                options.observer?.onHeartbeatFailure?.();
                throw error;
              }
              continue;
            }
            if (result.done) break;
            const encoded = encoder.encode(encodeSseEvent(result.value));
            if (encoded.byteLength > maxEventBytes) {
              throw new SseDeliveryError("run_event_too_large");
            }
            await enqueueBounded(controller, encoded);
            if (isTerminalRunEvent(result.value))
              terminalEnqueuedAt = Date.now();
            pending = iterator.next();
          }
          if (!cancelled) {
            controller.close();
            if (terminalEnqueuedAt !== undefined)
              options.observer?.onTerminalCloseLatency?.(
                Math.max(0, Date.now() - terminalEnqueuedAt),
              );
          }
        } catch (error) {
          if (
            error instanceof SseDeliveryError &&
            error.code === "slow_run_event_consumer"
          )
            options.observer?.onSlowConsumerDrop?.();
          if (!cancelled) controller.error(error);
        } finally {
          observeClose();
        }
      },
      pull() {
        resumeCapacity?.();
      },
      async cancel() {
        cancelled = true;
        resumeCapacity?.();
        await iterator.return?.();
        observeClose();
      },
    },
    {
      highWaterMark: maxBufferedBytes,
      size: (chunk) => chunk.byteLength,
    },
  );

  async function enqueueBounded(
    controller: ReadableStreamDefaultController<Uint8Array>,
    value: Uint8Array,
  ): Promise<void> {
    if ((controller.desiredSize ?? 0) <= 0) {
      await waitForCapacity(options.maxBackpressureMs ?? 30_000);
    }
    if (!cancelled) controller.enqueue(value);
    const desiredSize = controller.desiredSize;
    if (desiredSize !== null)
      options.observer?.onBufferedBytes?.(
        Math.max(0, maxBufferedBytes - desiredSize),
      );
  }

  async function waitForCapacity(timeoutMs: number): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        new Promise<void>((resolve) => {
          resumeCapacity = resolve;
        }),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new SseDeliveryError("slow_run_event_consumer")),
            Math.max(1, timeoutMs),
          );
        }),
      ]);
    } finally {
      resumeCapacity = undefined;
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }
}

function isTerminalRunEvent(event: RunEvent): boolean {
  return (
    event.type === "run.cancelled" ||
    event.type === "run.completed" ||
    event.type === "run.failed" ||
    event.type === "run.waiting_tool_approval" ||
    event.type === "run.waiting_tool_dispatch"
  );
}

export class SseDeliveryError extends Error {
  constructor(
    readonly code: "run_event_too_large" | "slow_run_event_consumer",
  ) {
    super(code);
    this.name = "SseDeliveryError";
  }
}

const heartbeat = Symbol("sse-heartbeat");

async function nextOrHeartbeat(
  pending: Promise<IteratorResult<RunEvent>>,
  heartbeatMs: number,
): Promise<IteratorResult<RunEvent> | typeof heartbeat> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<typeof heartbeat>((resolve) => {
        timeout = setTimeout(
          () => resolve(heartbeat),
          Math.max(1, heartbeatMs),
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
