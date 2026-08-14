import { describe, expect, it, vi } from "vitest";

import type { RunEvent } from "@romeo/ai-runtime";
import type { RomeoRepository } from "../domain/repository";
import type { RunEventSequencer } from "./run-event-sequencer";
import { replayRunEvents } from "./run-events";

describe("run-event replay observability", () => {
  it("reports cursor rows, reconnect replay, and notifier lag", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T00:00:00.050Z"));
    const event: RunEvent = {
      id: "evt_run_1_2",
      runId: "run_1",
      sequence: 2,
      type: "run.completed",
      data: {},
      createdAt: "2026-08-14T00:00:00.000Z",
    };
    const repository = {
      listRunEventsAfter: vi.fn().mockResolvedValue([event]),
    } as unknown as RomeoRepository;
    const sequencer = {
      subscribe: vi.fn(async (_runId, handler) => {
        handler({ runId: "run_1", sequence: 2 });
        return () => undefined;
      }),
    } as unknown as RunEventSequencer;
    const observer = {
      onCursorQuery: vi.fn(),
      onNotifierLag: vi.fn(),
      onNotifierUnavailable: vi.fn(),
      onReplayedRows: vi.fn(),
    };

    const received: RunEvent[] = [];
    for await (const item of replayRunEvents(
      repository,
      sequencer,
      "run_1",
      1,
      { observer },
    ))
      received.push(item);

    expect(received).toEqual([event]);
    expect(observer.onCursorQuery).toHaveBeenCalledWith(1);
    expect(observer.onReplayedRows).toHaveBeenCalledWith(1);
    expect(observer.onNotifierLag).toHaveBeenCalledWith(50);
    expect(observer.onNotifierUnavailable).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("reports notification fallback without exposing the error", async () => {
    const repository = {
      listRunEventsAfter: vi.fn().mockResolvedValue([]),
    } as unknown as RomeoRepository;
    const sequencer = {
      subscribe: vi.fn().mockRejectedValue(new Error("private transport")),
    } as unknown as RunEventSequencer;
    const observer = {
      onCursorQuery: vi.fn(),
      onNotifierLag: vi.fn(),
      onNotifierUnavailable: vi.fn(),
      onReplayedRows: vi.fn(),
    };

    for await (const _event of replayRunEvents(
      repository,
      sequencer,
      "run_1",
      0,
      { closeWhenCaughtUp: true, observer },
    )) {
      // No rows are expected.
    }

    expect(observer.onNotifierUnavailable).toHaveBeenCalledOnce();
    expect(observer.onCursorQuery).toHaveBeenCalledWith(0);
  });
});
