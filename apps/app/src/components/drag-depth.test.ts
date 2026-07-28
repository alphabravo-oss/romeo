import { describe, expect, it } from "vitest";

import { isDragOverlayVisible, nextDragDepth } from "./drag-depth";

function applyEvents(
  events: Parameters<typeof nextDragDepth>[1][],
  initialDepth = 0,
): number {
  return events.reduce(nextDragDepth, initialDepth);
}

describe("drag depth", () => {
  it("stays visible after leaving only one of two entered descendants", () => {
    const depth = applyEvents(["enter", "enter", "leave"]);

    expect(depth).toBe(1);
    expect(isDragOverlayVisible(depth)).toBe(true);
  });

  it("hides after every entered descendant has been left", () => {
    const depth = applyEvents(["enter", "enter", "leave", "leave"]);

    expect(depth).toBe(0);
    expect(isDragOverlayVisible(depth)).toBe(false);
  });

  it("resets after dragend regardless of the current depth", () => {
    const depth = applyEvents(["enter", "enter", "enter", "reset"]);

    expect(depth).toBe(0);
    expect(isDragOverlayVisible(depth)).toBe(false);
  });

  it("never lets unmatched leave events make the depth negative", () => {
    const depth = applyEvents(["leave", "leave", "enter", "leave", "leave"]);

    expect(depth).toBe(0);
    expect(isDragOverlayVisible(depth)).toBe(false);
  });
});
