import { afterEach, describe, expect, it, vi } from "vitest";

import { drainFrames, nextDrainLength } from "./markdown-stream";

/** Frames the drain needs to reach `target`, or -1 if it never does. */
function framesToSettle(from: number, target: number): number {
  let rendered = from;
  for (let frame = 1; frame <= 10_000; frame += 1) {
    rendered = nextDrainLength(rendered, target);
    if (rendered === target) return frame;
  }
  return -1;
}

describe("nextDrainLength", () => {
  it("always converges on the full text", () => {
    for (const target of [1, 4, 17, 200, 5_000, 120_000]) {
      expect(framesToSettle(0, target)).toBeGreaterThan(0);
    }
  });

  it("never renders text that has not arrived", () => {
    expect(nextDrainLength(0, 2)).toBe(2);
    expect(nextDrainLength(5, 6)).toBe(6);
  });

  it("advances by at least three characters so the tail never crawls", () => {
    expect(nextDrainLength(0, 100) - 0).toBeGreaterThanOrEqual(3);
    expect(nextDrainLength(97, 100)).toBe(100);
  });

  // A reconnect replays from sequence 0, so the drain can start thousands of
  // characters behind. A fixed rate would take minutes to catch up.
  it("catches up on a large backlog in a handful of frames", () => {
    expect(framesToSettle(0, 20_000)).toBeLessThan(120);
  });

  it("jumps straight down when the content is replaced by something shorter", () => {
    expect(nextDrainLength(400, 12)).toBe(12);
    expect(nextDrainLength(400, 0)).toBe(0);
  });

  it("is a no-op once caught up", () => {
    expect(nextDrainLength(64, 64)).toBe(64);
  });
});

/** Stands in for the browser's frame clock, so a "frame" is something to call. */
function frameClock() {
  let next = 0;
  let pending = new Map<number, () => void>();
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
    next += 1;
    pending.set(next, callback);
    return next;
  });
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
    pending.delete(handle);
  });
  return {
    pending: () => pending.size,
    tick() {
      const due = [...pending.values()];
      pending = new Map();
      for (const callback of due) callback();
    },
  };
}

describe("drainFrames", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps draining while deltas arrive faster than frames do", () => {
    const clock = frameClock();
    let arrived = 0;
    let rendered = 0;
    const stop = drainFrames(
      () => arrived,
      (step) => {
        rendered = step(rendered);
      },
    );

    // Three 20-character chunks per frame: the burst a fast provider produces,
    // and the shape that used to cancel the pending frame before it ever ran.
    for (let frame = 0; frame < 100; frame += 1) {
      arrived += 60;
      clock.tick();
      expect(rendered).toBeLessThanOrEqual(arrived);
    }
    expect(rendered).toBeGreaterThan(0);

    // The provider stops; the tail is a tail, not a loss.
    for (let frame = 0; frame < 60; frame += 1) clock.tick();
    expect(rendered).toBe(arrived);
    stop();
  });

  it("adopts replaced content that is shorter than what is drawn", () => {
    const clock = frameClock();
    let arrived = 900;
    let rendered = 400;
    const stop = drainFrames(
      () => arrived,
      (step) => {
        rendered = step(rendered);
      },
    );
    arrived = 12;
    clock.tick();
    expect(rendered).toBe(12);
    stop();
  });

  it("stops for good once the answer settles", () => {
    const clock = frameClock();
    let rendered = 0;
    const stop = drainFrames(
      () => 5_000,
      (step) => {
        rendered = step(rendered);
      },
    );
    clock.tick();
    const drawn = rendered;
    stop();
    clock.tick();
    expect(rendered).toBe(drawn);
    expect(clock.pending()).toBe(0);
  });
});
