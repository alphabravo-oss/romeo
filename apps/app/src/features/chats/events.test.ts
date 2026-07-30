import { describe, expect, it, vi } from "vitest";

import { subscribeToChatEvents, type ChatEventSourceFactory } from "./events";

describe("chat event subscription", () => {
  it("reports lifecycle, forwards changes, and removes every listener", () => {
    const listeners = new Map<string, EventListener>();
    const removed: string[] = [];
    const close = vi.fn();
    const createEventSource: ChatEventSourceFactory = () => ({
      addEventListener: (type, listener) => listeners.set(type, listener),
      close,
      removeEventListener: (type) => removed.push(type),
    });
    const onChange = vi.fn();
    const onStatus = vi.fn();
    const changedEvent = {
      action: "updated",
      chatId: "chat_1",
      createdAt: "2026-07-30T00:00:00.000Z",
      id: "chat_event_1",
      type: "changed",
      workspaceId: "workspace_1",
    };

    const unsubscribe = subscribeToChatEvents("workspace_1", onChange, {
      createEventSource,
      onStatus,
    });
    expect(onStatus).toHaveBeenCalledWith("connecting");

    listeners.get("open")?.(new Event("open"));
    listeners.get("chats:connected")?.(new Event("chats:connected"));
    listeners.get("chats:changed")?.(
      new MessageEvent("chats:changed", {
        data: JSON.stringify(changedEvent),
      }),
    );
    listeners.get("error")?.(new Event("error"));
    expect(onStatus.mock.calls).toEqual([
      ["connecting"],
      ["connected"],
      ["degraded"],
    ]);
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onChange).toHaveBeenLastCalledWith(changedEvent);

    unsubscribe();
    expect(removed.sort()).toEqual([
      "chats:changed",
      "chats:connected",
      "error",
      "open",
    ]);
    expect(close).toHaveBeenCalledOnce();
  });
});
