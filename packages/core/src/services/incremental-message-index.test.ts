import { describe, expect, it } from "vitest";

import {
  applyMessageIndexDelta,
  emptyMessageIndex,
} from "./incremental-message-index";

describe("incremental message index", () => {
  it("updates only affected parent/child maps", () => {
    const withRoot = applyMessageIndexDelta(emptyMessageIndex(), {
      type: "insert",
      id: "m1",
      parentId: null,
    });
    const withChild = applyMessageIndexDelta(withRoot, {
      type: "insert",
      id: "m2",
      parentId: "m1",
    });
    expect(withChild.nodes.m1?.childIds).toEqual(["m2"]);
    const reparented = applyMessageIndexDelta(withChild, {
      type: "reparent",
      id: "m2",
      parentId: null,
    });
    expect(reparented.nodes.m1?.childIds).toEqual([]);
    expect(reparented.rootIds).toEqual(["m1", "m2"]);
    const removed = applyMessageIndexDelta(reparented, {
      type: "remove",
      id: "m2",
    });
    expect(removed.nodes.m2).toBeUndefined();
    expect(removed.rootIds).toEqual(["m1"]);
  });
});
