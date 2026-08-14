import { describe, expect, it, vi } from "vitest";

import type { RunEvent } from "./events";
import { createSseStream } from "./sse";

describe("run SSE observability", () => {
  it("observes queue high-water and terminal close without event data", async () => {
    vi.useFakeTimers();
    const observations = {
      buffered: [] as number[],
      close: 0,
      open: 0,
      terminalLatency: [] as number[],
    };
    const reader = createSseStream(singleTerminalEvent(), {
      observer: {
        onBufferedBytes: (bytes) => observations.buffered.push(bytes),
        onClose: () => (observations.close += 1),
        onOpen: () => (observations.open += 1),
        onTerminalCloseLatency: (ms) => observations.terminalLatency.push(ms),
      },
    }).getReader();

    await reader.read();
    await reader.read();

    expect(observations).toMatchObject({ close: 1, open: 1 });
    expect(observations.buffered.length).toBeGreaterThan(0);
    expect(observations.terminalLatency).toEqual([0]);
    vi.useRealTimers();
  });

  it("observes bounded slow-consumer drops", async () => {
    vi.useFakeTimers();
    let drops = 0;
    const reader = createSseStream(threeEvents(), {
      maxBackpressureMs: 50,
      maxBufferedBytes: 1,
      observer: { onSlowConsumerDrop: () => (drops += 1) },
    }).getReader();

    await reader.read();
    await vi.advanceTimersByTimeAsync(50);
    await expect(reader.read()).rejects.toMatchObject({
      code: "slow_run_event_consumer",
    });
    expect(drops).toBe(1);
    vi.useRealTimers();
  });
});

async function* singleTerminalEvent(): AsyncIterable<RunEvent> {
  yield event(1);
}

async function* threeEvents(): AsyncIterable<RunEvent> {
  yield event(1);
  yield event(2);
  yield event(3);
}

function event(sequence: number): RunEvent {
  return {
    id: `evt_run_1_${sequence}`,
    runId: "run_1",
    sequence,
    type: "run.completed",
    data: {},
    createdAt: "2026-08-14T00:00:00.000Z",
  };
}
