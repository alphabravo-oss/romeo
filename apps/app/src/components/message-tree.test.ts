import { describe, expect, it } from "vitest";

import type { Message } from "../features/types";
import { chatPath, deepestLeaf, messageVariants } from "./message-tree";

// Minute-spaced timestamps keep the fixtures readable; the tie-break rules are
// exercised separately by the shared-millisecond case.
function message(
  id: string,
  role: Message["role"],
  minute: number,
  parentId?: string,
): Message {
  return {
    id,
    chatId: "chat_1",
    role,
    content: id,
    createdAt: `2026-01-01T00:${String(minute).padStart(2, "0")}:00.000Z`,
    ...(parentId === undefined ? {} : { parentId }),
  };
}

function ids(messages: Message[]): string[] {
  return messages.map((item) => item.id);
}

// One turn, then a regenerate: u2/a2 are siblings of u1/a1 under the root.
const branched: Message[] = [
  message("u1", "user", 1),
  message("a1", "assistant", 2, "u1"),
  message("u2", "user", 3),
  message("a2", "assistant", 4, "u2"),
];

describe("chatPath", () => {
  it("returns a transcript written before branching whole and in order", () => {
    const flat = [
      message("m3", "assistant", 3),
      message("m1", "user", 1),
      message("m2", "assistant", 2),
    ];
    expect(ids(chatPath(flat, undefined))).toEqual(["m1", "m2", "m3"]);
  });

  it("returns every message of a linear chain", () => {
    const linear = [
      message("u1", "user", 1),
      message("a1", "assistant", 2, "u1"),
      message("u2", "user", 3, "a1"),
      message("a2", "assistant", 4, "u2"),
    ];
    expect(ids(chatPath(linear, "a2"))).toEqual(["u1", "a1", "u2", "a2"]);
  });

  it("returns only the branch the pointer names", () => {
    expect(ids(chatPath(branched, "a1"))).toEqual(["u1", "a1"]);
    expect(ids(chatPath(branched, "a2"))).toEqual(["u2", "a2"]);
  });

  it("falls back to the newest branch when the pointer dangles", () => {
    expect(ids(chatPath(branched, "msg_never_persisted"))).toEqual([
      "u2",
      "a2",
    ]);
  });

  it("picks up an optimistic child appended below the pointer", () => {
    const withOptimisticTurn = [
      ...branched,
      message("u3", "user", 5, "a2"),
      message("a3", "assistant", 6, "u3"),
    ];
    // The pointer still names a2: the run that created u3 has not persisted.
    expect(ids(chatPath(withOptimisticTurn, "a2"))).toEqual([
      "u2",
      "a2",
      "u3",
      "a3",
    ]);
  });

  it("orders a user turn before an assistant sharing its timestamp", () => {
    const sameInstant = [
      message("a1", "assistant", 1, "u1"),
      message("u1", "user", 1),
    ];
    expect(ids(chatPath(sameInstant, "a1"))).toEqual(["u1", "a1"]);
  });

  it("terminates on a cyclic parent pointer", () => {
    const cyclic = [
      message("m1", "user", 1, "m2"),
      message("m2", "assistant", 2, "m1"),
    ];
    expect(chatPath(cyclic, "m2")).toHaveLength(2);
  });

  it("returns nothing for an empty transcript", () => {
    expect(chatPath([], undefined)).toEqual([]);
  });
});

describe("deepestLeaf", () => {
  it("follows the newest child to the bottom of the branch", () => {
    expect(deepestLeaf(branched, "u1")).toBe("a1");
  });

  it("returns the message itself when it has no children", () => {
    expect(deepestLeaf(branched, "a2")).toBe("a2");
  });

  it("terminates on a cyclic parent pointer", () => {
    const cyclic = [
      message("m1", "user", 1, "m2"),
      message("m2", "assistant", 2, "m1"),
    ];
    expect(["m1", "m2"]).toContain(deepestLeaf(cyclic, "m1"));
  });
});

describe("messageVariants", () => {
  it("reports the position of each root sibling", () => {
    const path = chatPath(branched, "a2");
    const variants = messageVariants(branched, path);
    expect(variants.u2).toEqual({
      index: 1,
      siblingIds: ["u1", "u2"],
      total: 2,
    });
    // The regenerated answer is the only child of its own user turn.
    expect(variants.a2).toBeUndefined();
  });

  it("keeps the replaced answer reachable after a regenerate", () => {
    // The point of the whole change: regenerating leaves u1/a1 in the tree, one
    // sibling step away from what is on screen.
    const variants = messageVariants(branched, chatPath(branched, "a2"));
    const previous = variants.u2?.siblingIds[0];
    expect(previous).toBe("u1");
    expect(ids(chatPath(branched, deepestLeaf(branched, previous!)))).toEqual([
      "u1",
      "a1",
    ]);
  });

  it("reports nothing for an unbranched chat", () => {
    const linear = [
      message("u1", "user", 1),
      message("a1", "assistant", 2, "u1"),
    ];
    expect(messageVariants(linear, chatPath(linear, "a1"))).toEqual({});
  });

  it("reports nothing for a transcript written before branching", () => {
    const flat = [message("m1", "user", 1), message("m2", "assistant", 2)];
    expect(messageVariants(flat, chatPath(flat, undefined))).toEqual({});
  });
});
