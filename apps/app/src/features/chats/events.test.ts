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

    const unsubscribe = subscribeToChatEvents("workspace_1", onChange, {
      createEventSource,
      onStatus,
    });
    expect(onStatus).toHaveBeenCalledWith("connecting");

    listeners.get("open")?.(new Event("open"));
    listeners.get("chats:changed")?.(new Event("chats:changed"));
    listeners.get("error")?.(new Event("error"));
    expect(onStatus.mock.calls).toEqual([
      ["connecting"],
      ["connected"],
      ["degraded"],
    ]);
    expect(onChange).toHaveBeenCalledOnce();

    unsubscribe();
    expect(removed.sort()).toEqual(["chats:changed", "error", "open"]);
    expect(close).toHaveBeenCalledOnce();
  });
});
