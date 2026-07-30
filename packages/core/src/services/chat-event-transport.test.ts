import { describe, expect, it, vi } from "vitest";

import { InMemoryChatEventTransport } from "./chat-event-transport";

describe("InMemoryChatEventTransport", () => {
  it("replays only events after the reconnect cursor", async () => {
    const transport = new InMemoryChatEventTransport();
    const first = changedEvent("event_1", "created");
    const second = changedEvent("event_2", "archived");
    await transport.publish("org:workspace", first);
    await transport.publish("org:workspace", second);
    const handler = vi.fn();

    const unsubscribe = await transport.subscribe("org:workspace", handler, {
      afterEventId: first.id,
    });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(second);
    unsubscribe();
  });

  it("keeps bounded history while delivering live events", async () => {
    const transport = new InMemoryChatEventTransport(1);
    await transport.publish(
      "org:workspace",
      changedEvent("event_1", "created"),
    );
    await transport.publish(
      "org:workspace",
      changedEvent("event_2", "updated"),
    );
    const handler = vi.fn();
    const unsubscribe = await transport.subscribe("org:workspace", handler, {
      afterEventId: "missing_event",
    });
    const live = changedEvent("event_3", "deleted");
    await transport.publish("org:workspace", live);

    expect(handler.mock.calls.map(([event]) => event.id)).toEqual([
      "event_2",
      "event_3",
    ]);
    unsubscribe();
  });
});

function changedEvent(
  id: string,
  action: "archived" | "created" | "deleted" | "updated",
) {
  return {
    id,
    type: "changed" as const,
    action,
    chatId: "chat_1",
    workspaceId: "workspace_1",
    createdAt: "2026-07-30T12:00:00.000Z",
  };
}
