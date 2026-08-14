import type { TrackedRun } from "./run-registry-types";

export const RUN_STREAM_MAX_RECONNECT_ATTEMPTS = 5;

type PublishRun = (
  chatId: string,
  runId: string,
  patch: Partial<TrackedRun>,
) => void;

let networkTransportSuspended = false;

export function isRunNetworkTransportSuspended(): boolean {
  return networkTransportSuspended;
}

export function suspendActiveRunTransports(
  registry: Map<string, TrackedRun>,
  publish: PublishRun,
): void {
  networkTransportSuspended = true;
  for (const [chatId, run] of registry) {
    if (!run.isStreaming) continue;
    publish(chatId, run.runId, {
      networkActivityWhileSuspended: false,
      networkSuspended: true,
      streamState: "reconnecting",
      wait: {
        attempt: run.wait?.attempt ?? 1,
        elapsedSeconds: run.wait?.elapsedSeconds ?? 0,
        hasContent: run.wait?.hasContent ?? false,
        maxAttempts: run.wait?.maxAttempts ?? 2,
        phase: "reconnecting",
        reconnectAttempts: Math.max(run.wait?.reconnectAttempts ?? 0, 1),
        maxReconnectAttempts: RUN_STREAM_MAX_RECONNECT_ATTEMPTS,
        ...(run.wait?.streamTimeoutMs === undefined
          ? {}
          : { streamTimeoutMs: run.wait.streamTimeoutMs }),
      },
    });
  }
}

export function releaseActiveRunTransports(
  registry: Map<string, TrackedRun>,
  publish: PublishRun,
): void {
  networkTransportSuspended = false;
  for (const [chatId, run] of registry) {
    if (!run.isStreaming || !run.networkSuspended) continue;
    const canPresentLive = run.networkActivityWhileSuspended;
    publish(chatId, run.runId, {
      networkActivityWhileSuspended: false,
      networkSuspended: false,
      ...(canPresentLive
        ? {
            streamState: "live",
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
          }
        : {}),
    });
  }
}

/** Hold presentation behind the security boundary while still consuming SSE. */
export function presentRunTransportEvent(
  registry: Map<string, TrackedRun>,
  publish: PublishRun,
  chatId: string,
  runId: string,
  reconnectAttempts: number,
): boolean {
  const currentRun = registry.get(chatId);
  if (currentRun?.networkSuspended === true) {
    publish(chatId, runId, { networkActivityWhileSuspended: true });
    return true;
  }
  publish(chatId, runId, { streamState: "live" });
  if (reconnectAttempts <= 0 && currentRun?.wait?.phase !== "reconnecting")
    return false;
  publish(chatId, runId, {
    wait: {
      attempt: currentRun?.wait?.attempt ?? 1,
      elapsedSeconds: currentRun?.wait?.elapsedSeconds ?? 0,
      hasContent: currentRun?.wait?.hasContent ?? false,
      maxAttempts: currentRun?.wait?.maxAttempts ?? 2,
      phase: currentRun?.wait?.hasContent === true ? "streaming" : "waiting",
      reconnectAttempts: 0,
      maxReconnectAttempts: RUN_STREAM_MAX_RECONNECT_ATTEMPTS,
      ...(currentRun?.wait?.streamTimeoutMs === undefined
        ? {}
        : { streamTimeoutMs: currentRun.wait.streamTimeoutMs }),
    },
  });
  return false;
}
