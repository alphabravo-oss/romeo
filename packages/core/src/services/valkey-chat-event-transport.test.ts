import type { PubSubMsg } from "@valkey/valkey-glide";
import { describe, expect, it, vi } from "vitest";

import { ValkeyChatEventTransport } from "./valkey-chat-event-transport";

describe("ValkeyChatEventTransport", () => {
  it("persists before publishing and replays after a cursor", async () => {
    const first = changedEvent("event_1", "created");
    const second = changedEvent("event_2", "archived");
    const commands: string[][] = [];
    let onMessage: ((message: PubSubMsg) => void) | undefined;
    const close = vi.fn();
    const transport = new ValkeyChatEventTransport({
      keyPrefix: "romeo:test",
      timeoutMs: 100,
      url: "redis://localhost:6379",
      commandClient: {
        command: async (args) => {
          commands.push(args);
          return args[0] === "LRANGE"
            ? [JSON.stringify(first), JSON.stringify(second)]
            : 1;
        },
      },
      subscriberFactory: async (pattern, callback) => {
        expect(pattern).toBe("romeo:test:pub:*");
        onMessage = callback;
        return { close };
      },
    });
    const handler = vi.fn();
    const unsubscribe = await transport.subscribe("org:workspace", handler, {
      afterEventId: first.id,
    });

    expect(handler).toHaveBeenCalledWith(second);
    await transport.publish("org:workspace", second);
    expect(commands.at(-1)).toEqual([
      "EVAL",
      expect.any(String),
      "2",
      "romeo:test:history:org:workspace",
      "romeo:test:pub:org:workspace",
      JSON.stringify(second),
      "1000",
      "86400",
    ]);

    const third = changedEvent("event_3", "deleted");
    onMessage?.({
      channel: "romeo:test:pub:org:workspace",
      message: JSON.stringify(third),
    });
    onMessage?.({
      channel: "romeo:test:pub:org:workspace",
      message: JSON.stringify(third),
    });
    expect(handler.mock.calls.map(([event]) => event.id)).toEqual([
      "event_2",
      "event_3",
    ]);

    unsubscribe();
    transport.close();
    await Promise.resolve();
    expect(close).toHaveBeenCalledOnce();
  });

  it("ignores malformed and unrelated pubsub messages", async () => {
    let onMessage: ((message: PubSubMsg) => void) | undefined;
    const transport = new ValkeyChatEventTransport({
      keyPrefix: "romeo:test",
      timeoutMs: 100,
      url: "redis://localhost:6379",
      commandClient: { command: async () => [] },
      subscriberFactory: async (_pattern, callback) => {
        onMessage = callback;
        return { close() {} };
      },
    });
    const handler = vi.fn();
    await transport.subscribe("org:workspace", handler);

    onMessage?.({ channel: "other:channel", message: "{}" });
    onMessage?.({
      channel: "romeo:test:pub:org:workspace",
      message: "not-json",
    });
    expect(handler).not.toHaveBeenCalled();
    transport.close();
  });
});

function changedEvent(id: string, action: "archived" | "created" | "deleted") {
  return {
    id,
    type: "changed" as const,
    action,
    chatId: "chat_1",
    workspaceId: "workspace_1",
    createdAt: "2026-07-30T12:00:00.000Z",
  };
}
