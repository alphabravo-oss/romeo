import { describe, expect, it, vi } from "vitest";

import type { RunEvent } from "./events";
import { createSseStream, encodeSseEvent } from "./sse";

describe("run SSE encoding", () => {
  it("redacts unclassified reasoning before direct SSE encoding", () => {
    const rawSentinel = "raw-private-sse-trace-secret";
    const encoded = encodeSseEvent({
      id: "evt_private_reasoning",
      runId: "run_private_reasoning",
      sequence: 1,
      type: "message.reasoning",
      data: { text: rawSentinel, durationMs: 12, authorization: "secret" },
      createdAt: "2026-08-14T12:00:00.000Z",
    });

    expect(encoded).toContain('"classification":"hidden_reasoning_omitted"');
    expect(encoded).toContain('"durationMs":12');
    expect(encoded).not.toContain(rawSentinel);
    expect(encoded).not.toContain("authorization");
  });

  it("drops an ungoverned provider-safe summary before direct SSE encoding", () => {
    const rawSentinel = "ungoverned-summary-sse-secret";
    const encoded = encodeSseEvent({
      id: "evt_ungoverned_summary",
      runId: "run_ungoverned_summary",
      sequence: 1,
      type: "reasoning.summary.delta",
      data: { classification: "provider_safe_summary", text: rawSentinel },
      createdAt: "2026-08-14T12:00:00.000Z",
    });

    expect(encoded).toContain("event: message.reasoning");
    expect(encoded).toContain('"classification":"hidden_reasoning_omitted"');
    expect(encoded).not.toContain(rawSentinel);
  });

  it("emits a retry hint and keeps the connection alive while awaiting data", async () => {
    vi.useFakeTimers();
    let release: (() => void) | undefined;
    async function* events(): AsyncIterable<RunEvent> {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      yield completedEvent;
    }
    const reader = createSseStream(events(), {
      heartbeatMs: 1_000,
      retryMs: 2_000,
    }).getReader();
    const decoder = new TextDecoder();

    await expect(readText(reader, decoder)).resolves.toBe("retry: 2000\n\n");
    const heartbeat = readText(reader, decoder);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(heartbeat).resolves.toBe(": heartbeat\n\n");
    release?.();
    await expect(readText(reader, decoder)).resolves.toContain(
      "event: run.completed\n",
    );
    await expect(reader.read()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    vi.useRealTimers();
  });

  it("versions public events and terminates a stalled bounded queue", async () => {
    vi.useFakeTimers();
    async function* events(): AsyncIterable<RunEvent> {
      yield completedEvent;
      yield { ...completedEvent, id: "evt_run_1_2", sequence: 2 };
      yield { ...completedEvent, id: "evt_run_1_3", sequence: 3 };
    }
    const reader = createSseStream(events(), {
      maxBackpressureMs: 100,
      maxBufferedBytes: 1,
    }).getReader();

    const first = await readText(reader, new TextDecoder());
    expect(first).toContain('"schemaVersion":1');
    await vi.advanceTimersByTimeAsync(100);
    await expect(reader.read()).rejects.toMatchObject({
      code: "slow_run_event_consumer",
    });
    vi.useRealTimers();
  });

  it("rejects a single event beyond the configured byte ceiling", async () => {
    const reader = createSseStream(
      (async function* () {
        yield completedEvent;
      })(),
      { maxEventBytes: 10 },
    ).getReader();

    await expect(reader.read()).rejects.toMatchObject({
      code: "run_event_too_large",
    });
  });
});

async function readText(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
): Promise<string> {
  const result = await reader.read();
  return result.value === undefined ? "" : decoder.decode(result.value);
}

const completedEvent: RunEvent = {
  id: "evt_run_1_1",
  runId: "run_1",
  sequence: 1,
  type: "run.completed",
  data: {},
  createdAt: "2026-08-13T12:00:00.000Z",
};
