// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useEventCallback } from "./use-event-callback";

describe("useEventCallback", () => {
  it("preserves identity and dispatches to the latest committed callback", () => {
    const first = vi.fn(() => "first");
    const second = vi.fn(() => "second");
    const view = renderHook(({ callback }) => useEventCallback(callback), {
      initialProps: { callback: first },
    });
    const stable = view.result.current;
    expect(stable()).toBe("first");

    act(() => view.rerender({ callback: second }));
    expect(view.result.current).toBe(stable);
    expect(stable()).toBe("second");
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
