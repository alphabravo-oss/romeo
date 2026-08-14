import type { PubSubMsg } from "@valkey/valkey-glide";
import { describe, expect, it, vi } from "vitest";

import { ValkeyRunEventTransport } from "./valkey-run-event-transport";

describe("ValkeyRunEventTransport", () => {
  it("publishes metadata-only notices and delivers the matching channel", async () => {
    const commands: string[][] = [];
    let onMessage: ((message: PubSubMsg) => void) | undefined;
    const close = vi.fn();
    const transport = new ValkeyRunEventTransport({
      keyPrefix: "romeo:test:runs",
      timeoutMs: 100,
      url: "redis://localhost:6379",
      commandClient: {
        command: async (args) => {
          commands.push(args);
          return 1;
        },
      },
      subscriberFactory: async (pattern, callback) => {
        expect(pattern).toBe("romeo:test:runs:*");
        onMessage = callback;
        return { close };
      },
    });
    const handler = vi.fn();
    const unsubscribe = await transport.subscribe("run_1", handler);

    await transport.publish({ runId: "run_1", sequence: 7 });
    expect(commands).toEqual([
      [
        "PUBLISH",
        "romeo:test:runs:run_1",
        JSON.stringify({ runId: "run_1", sequence: 7 }),
      ],
    ]);
    onMessage?.({
      channel: "romeo:test:runs:run_1",
      message: JSON.stringify({ runId: "run_1", sequence: 7 }),
    });
    expect(handler).toHaveBeenCalledWith({ runId: "run_1", sequence: 7 });

    unsubscribe();
    transport.close();
    await Promise.resolve();
    expect(close).toHaveBeenCalledOnce();
  });

  it("ignores malformed, mismatched, and unrelated notifications", async () => {
    let onMessage: ((message: PubSubMsg) => void) | undefined;
    const transport = new ValkeyRunEventTransport({
      keyPrefix: "romeo:test:runs",
      timeoutMs: 100,
      url: "redis://localhost:6379",
      commandClient: { command: async () => 1 },
      subscriberFactory: async (_pattern, callback) => {
        onMessage = callback;
        return { close() {} };
      },
    });
    const handler = vi.fn();
    await transport.subscribe("run_1", handler);

    onMessage?.({ channel: "other:run_1", message: "{}" });
    onMessage?.({ channel: "romeo:test:runs:run_1", message: "not-json" });
    onMessage?.({
      channel: "romeo:test:runs:run_1",
      message: JSON.stringify({ runId: "run_2", sequence: 1 }),
    });
    onMessage?.({
      channel: "romeo:test:runs:run_1",
      message: JSON.stringify({ runId: "run_1", sequence: 0 }),
    });
    expect(handler).not.toHaveBeenCalled();
    transport.close();
  });
});
