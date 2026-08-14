import { publicRunEvent, type RunEvent } from "@romeo/ai-runtime";

import type { RomeoRepository } from "../domain/repository";
import type { RunEventSequencer } from "./run-event-sequencer";
import type { RunEventReplayObserver } from "./run-sse-observability";

const defaultReplayPageSize = 256;
const defaultFallbackPollMs = 1_000;

export const terminalRunEvents = new Set<RunEvent["type"]>([
  "run.cancelled",
  "run.completed",
  "run.failed",
]);
export const suspendedRunEvents = new Set<RunEvent["type"]>([
  "run.waiting_tool_approval",
  "run.waiting_tool_dispatch",
]);

export class ActiveRunControllers {
  private readonly controllers = new Map<string, AbortController>();

  create(runId: string): AbortController {
    const controller = new AbortController();
    this.controllers.set(runId, controller);
    return controller;
  }

  abort(runId: string): void {
    this.controllers.get(runId)?.abort();
  }

  has(runId: string): boolean {
    return this.controllers.has(runId);
  }

  delete(runId: string): void {
    this.controllers.delete(runId);
  }
}

export async function* replayRunEvents(
  repository: RomeoRepository,
  sequencer: RunEventSequencer,
  runId: string,
  afterSequence = 0,
  options: {
    authorize?: () => Promise<void>;
    authorizationRecheckMs?: number;
    closeWhenCaughtUp?: boolean;
    fallbackPollMs?: number;
    observer?: RunEventReplayObserver;
    pageSize?: number;
    signal?: AbortSignal;
  } = {},
): AsyncIterable<RunEvent> {
  let cursor = afterSequence;
  const wakeup = new RunEventWakeup();
  let unsubscribe: (() => void) | undefined;
  let notifiedSequence: number | undefined;
  const authorizationRecheckMs = Math.max(
    10,
    options.authorizationRecheckMs ?? 30_000,
  );
  let nextAuthorizationAt = 0;

  try {
    try {
      unsubscribe = await sequencer.subscribe(runId, (notice) => {
        if (notice.sequence > cursor) {
          notifiedSequence = Math.max(notifiedSequence ?? 0, notice.sequence);
          wakeup.notify();
        }
      });
    } catch {
      options.observer?.onNotifierUnavailable();
      // Durable cursor polling below is the degraded path when the notification
      // transport is unavailable. It is bounded and never reloads full history.
    }

    const pageSize = Math.max(1, options.pageSize ?? defaultReplayPageSize);
    while (!options.signal?.aborted) {
      if (
        options.authorize !== undefined &&
        Date.now() >= nextAuthorizationAt
      ) {
        await options.authorize();
        nextAuthorizationAt = Date.now() + authorizationRecheckMs;
      }
      let pending: RunEvent[];
      try {
        pending = await repository.listRunEventsAfter(
          runId,
          cursor,
          pageSize,
          options.signal,
        );
      } catch (error) {
        if (options.signal?.aborted) return;
        throw error;
      }
      options.observer?.onCursorQuery(pending.length);
      options.observer?.onReplayedRows(pending.length);

      if (notifiedSequence !== undefined && pending.length > 0) {
        const notifiedEvent = pending.find(
          (event) => event.sequence >= notifiedSequence!,
        );
        const createdAt = Date.parse(
          (notifiedEvent ?? pending[pending.length - 1]!).createdAt,
        );
        if (Number.isFinite(createdAt))
          options.observer?.onNotifierLag(Math.max(0, Date.now() - createdAt));
        if (pending[pending.length - 1]!.sequence >= notifiedSequence)
          notifiedSequence = undefined;
      }

      for (const event of pending) {
        cursor = Math.max(cursor, event.sequence);
        yield publicRunEvent(event);
      }

      if (
        pending.some(
          (event) =>
            terminalRunEvents.has(event.type) ||
            suspendedRunEvents.has(event.type),
        )
      ) {
        return;
      }

      if (pending.length === 0 && options.closeWhenCaughtUp === true) return;

      if (pending.length >= pageSize) continue;
      const authorizationWaitMs =
        options.authorize === undefined
          ? Number.POSITIVE_INFINITY
          : Math.max(10, nextAuthorizationAt - Date.now());
      await wakeup.wait(
        Math.min(
          Math.max(10, options.fallbackPollMs ?? defaultFallbackPollMs),
          authorizationWaitMs,
        ),
        options.signal,
      );
    }
  } finally {
    unsubscribe?.();
  }
}

class RunEventWakeup {
  private pending = false;
  private resolve: (() => void) | undefined;

  notify(): void {
    this.pending = true;
    this.resolve?.();
  }

  async wait(timeoutMs: number, signal?: AbortSignal): Promise<void> {
    if (this.pending) {
      this.pending = false;
      return;
    }
    const waiter = new RunEventWaiter();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", finish);
      this.resolve = undefined;
      this.pending = false;
      waiter.finish();
    };
    const timeout = setTimeout(finish, timeoutMs);
    this.resolve = finish;
    signal?.addEventListener("abort", finish, { once: true });
    if (signal?.aborted) finish();
    await waiter.done;
  }
}

class RunEventWaiter {
  readonly done: Promise<void>;
  private finishPromise: () => void = () => undefined;

  constructor() {
    this.done = new Promise<void>((resolve) => {
      this.finishPromise = resolve;
    });
  }

  finish(): void {
    this.finishPromise();
  }
}
