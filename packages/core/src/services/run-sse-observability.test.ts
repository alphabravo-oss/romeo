import { describe, expect, it } from "vitest";

import { RunSseObservability } from "./run-sse-observability";

describe("RunSseObservability", () => {
  it("reports bounded metadata-only stream and replay health", () => {
    let now = 1_000;
    const telemetry = new RunSseObservability(() => now, 10_000);
    const stream = telemetry.streamObserver(true);
    const replay = telemetry.replayObserver(true);

    stream.onOpen?.();
    stream.onBufferedBytes?.(2_048);
    stream.onSlowConsumerDrop?.();
    stream.onHeartbeatFailure?.();
    stream.onTerminalCloseLatency?.(25);
    replay.onCursorQuery(4);
    replay.onReplayedRows(4);
    replay.onNotifierLag(12);
    replay.onNotifierUnavailable();

    expect(telemetry.snapshot()).toEqual({
      activeStreams: 1,
      bufferedBytesHighWater: 2_048,
      connectionCount: 1,
      cursorQueryCount: 1,
      cursorQueryRowCount: 4,
      heartbeatFailureCount: 1,
      lookbackSeconds: 10,
      notifierLagAverageMs: 12,
      notifierLagP95Ms: 12,
      notifierUnavailableCount: 1,
      observationScope: "process",
      reconnectCount: 1,
      replayedRowCount: 4,
      slowConsumerDropCount: 1,
      terminalCloseLatencyAverageMs: 25,
      terminalCloseLatencyP95Ms: 25,
    });

    stream.onClose?.();
    stream.onClose?.();
    expect(telemetry.snapshot().activeStreams).toBe(0);

    now = 12_000;
    expect(telemetry.snapshot()).toMatchObject({
      activeStreams: 0,
      connectionCount: 0,
      cursorQueryCount: 0,
      replayedRowCount: 0,
    });
  });

  it("does not count initial cursor rows as reconnect replay", () => {
    const telemetry = new RunSseObservability(() => 1_000);
    const replay = telemetry.replayObserver(false);
    replay.onCursorQuery(3);
    replay.onReplayedRows(3);

    expect(telemetry.snapshot()).toMatchObject({
      cursorQueryRowCount: 3,
      replayedRowCount: 0,
    });
  });
});
