import { afterEach, describe, expect, it, vi } from "vitest";

import { subscribeToNetworkStatus } from "./connectivity";

afterEach(() => vi.unstubAllGlobals());

describe("browser connectivity subscription", () => {
  it("removes both browser event listeners on cleanup", () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    vi.stubGlobal("window", { addEventListener, removeEventListener });
    const onChange = vi.fn();

    const unsubscribe = subscribeToNetworkStatus(onChange);
    unsubscribe();

    expect(addEventListener.mock.calls).toEqual([
      ["online", onChange],
      ["offline", onChange],
    ]);
    expect(removeEventListener.mock.calls).toEqual([
      ["online", onChange],
      ["offline", onChange],
    ]);
  });
});
