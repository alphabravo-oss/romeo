import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { streamRunEvents } from "./stream";

const sdk = vi.hoisted(() => ({
  source: undefined as unknown,
  options: undefined as
    | {
        headers: Record<string, string>;
        onSseEvent?: () => void;
        signal: AbortSignal;
      }
    | undefined,
}));

vi.mock("@romeo/api-client/generated/sdk", () => ({
  runsStreamEvents: vi.fn((options: NonNullable<typeof sdk.options>) => {
    sdk.options = options;
    seen.signal = options.signal;
    return Promise.resolve({ stream: sdk.source });
  }),
}));

vi.mock("@romeo/api-client/runtime/browser", () => ({
  configureBrowserApiClients: vi.fn(),
}));

const seen: { signal?: AbortSignal } = {};

function event(sequence: number) {
  return {
    id: `evt_${sequence}`,
    runId: "run_1",
    sequence,
    schemaVersion: 1,
    type: "message.delta",
  };
}

// The window is meant to measure SILENCE between events, not the total length
// of the answer. A timer armed once instead caps the whole response, killing a
// model that streams for longer than the window while tokens keep arriving --
// which is exactly the bug this stream shipped with.
describe("streamRunEvents idle timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete seen.signal;
    sdk.options = undefined;
  });

  it("survives an answer longer than the window when events keep arriving", async () => {
    // Three 10s gaps: each is under the 15s window, but 30s total is well past
    // it. A once-armed timer aborts partway through; a re-armed one does not.
    sdk.source = (async function* () {
      for (let sequence = 1; sequence <= 3; sequence += 1) {
        await vi.advanceTimersByTimeAsync(10_000);
        if (seen.signal?.aborted === true) return;
        yield event(sequence);
      }
    })();

    const received: number[] = [];
    for await (const value of streamRunEvents("run_1")) {
      received.push(value.sequence);
    }

    expect(received).toEqual([1, 2, 3]);
  });

  it("still aborts once the stream actually goes quiet", async () => {
    sdk.source = (async function* () {
      yield event(1);
      // Silence past the window: nothing re-arms the timer, so it fires.
      await vi.advanceTimersByTimeAsync(16_000);
      if (seen.signal?.aborted === true) return;
      yield event(2);
    })();

    const received: number[] = [];
    for await (const value of streamRunEvents("run_1")) {
      received.push(value.sequence);
    }

    expect(received).toEqual([1]);
  });

  it("treats SSE heartbeat comments as traffic and sends the resume cursor", async () => {
    sdk.source = (async function* () {
      await vi.advanceTimersByTimeAsync(10_000);
      sdk.options?.onSseEvent?.();
      await vi.advanceTimersByTimeAsync(10_000);
      if (seen.signal?.aborted === true) return;
      yield event(8);
    })();

    const received: number[] = [];
    for await (const value of streamRunEvents("run_1", undefined, 7)) {
      received.push(value.sequence);
    }

    expect(received).toEqual([8]);
    expect(sdk.options?.headers).toMatchObject({
      accept: "text/event-stream",
      "last-event-id": "7",
    });
  });
});
