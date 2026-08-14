import { getRun } from "../features/runs";
import type { TrackedRun } from "./run-registry-types";

type PublishRun = (
  chatId: string,
  runId: string,
  patch: Partial<TrackedRun>,
) => void;

export function startRunWaitTicker(
  run: TrackedRun,
  registry: Map<string, TrackedRun>,
  publish: PublishRun,
): void {
  stopRunWaitTicker(run);
  run.timing.waitTicker = setInterval(() => {
    const current = registry.get(run.chatId);
    if (
      current === undefined ||
      current.runId !== run.runId ||
      !current.isStreaming
    ) {
      stopRunWaitTicker(current ?? run);
      return;
    }
    if (current.wait?.hasContent === true) return;
    const elapsedSeconds = Math.max(
      0,
      Math.floor((Date.now() - current.timing.waitAttemptStartedAt) / 1_000),
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
  run.timing.waitTicker.unref?.();
}

export function stopRunWaitTicker(run: TrackedRun | undefined): void {
  if (run?.timing.waitTicker === undefined) return;
  clearInterval(run.timing.waitTicker);
  delete run.timing.waitTicker;
}

export function beginRunWaitAttempt(
  run: TrackedRun,
  registry: Map<string, TrackedRun>,
  publish: PublishRun,
  phase: "waiting" | "retrying",
  attempt: number,
): void {
  run.timing.waitAttemptStartedAt = Date.now();
  // Read the live entry, not the closure: the server-advertised maxAttempts and
  // streamTimeoutMs were published after `run` was captured, so reading them
  // off `run` reverted both to the trackRun defaults on every retry.
  const currentWait = registry.get(run.chatId)?.wait ?? run.wait;
  publish(run.chatId, run.runId, {
    wait: {
      attempt,
      elapsedSeconds: 0,
      hasContent: false,
      maxAttempts: currentWait?.maxAttempts ?? 2,
      phase,
      ...(currentWait?.streamTimeoutMs === undefined
        ? {}
        : { streamTimeoutMs: currentWait.streamTimeoutMs }),
    },
  });
  startRunWaitTicker(run, registry, publish);
}

export function abortableDelay(
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

export async function waitForRunTerminal(
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
