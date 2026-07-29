import { afterEach, describe, expect, it, vi } from "vitest";

import { scheduleDebounced } from "./debounce";

afterEach(() => vi.useRealTimers());

describe("debounced commits", () => {
  it("commits only the final scheduled value", () => {
    vi.useFakeTimers();
    const commit = vi.fn();
    const cancelFirst = scheduleDebounced("fir", 250, commit);
    cancelFirst();
    scheduleDebounced("final", 250, commit);
    vi.advanceTimersByTime(249);
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(commit).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledWith("final");
  });

  it("cancels work during cleanup and clamps negative delays", () => {
    vi.useFakeTimers();
    const commit = vi.fn();
    const cancel = scheduleDebounced("removed", 250, commit);
    cancel();
    vi.runAllTimers();
    expect(commit).not.toHaveBeenCalled();

    scheduleDebounced("", -1, commit);
    vi.runAllTimers();
    expect(commit).toHaveBeenCalledWith("");
  });
});
