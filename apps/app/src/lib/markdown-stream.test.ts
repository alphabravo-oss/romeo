import { afterEach, describe, expect, it, vi } from "vitest";

import { drainFrames, nextDrainLength } from "./markdown-stream";

describe("nextDrainLength", () => {
  it("paints the full arrived text immediately (ChatGPT-like)", () => {
    expect(nextDrainLength(0, 1)).toBe(1);
    expect(nextDrainLength(0, 17)).toBe(17);
    expect(nextDrainLength(0, 20_000)).toBe(20_000);
    expect(nextDrainLength(50, 200)).toBe(200);
  });

  it("never renders text that has not arrived", () => {
    expect(nextDrainLength(0, 2)).toBe(2);
    expect(nextDrainLength(5, 6)).toBe(6);
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

  it("settles the full backlog on the first frame", () => {
    const clock = frameClock();
    let arrived = 0;
    let rendered = 0;
    const stop = drainFrames(
      () => arrived,
      (step) => {
        rendered = step(rendered);
      },
    );

    arrived = 180;
    clock.tick();
    expect(rendered).toBe(180);

    arrived = 240;
    clock.tick();
    expect(rendered).toBe(240);
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
