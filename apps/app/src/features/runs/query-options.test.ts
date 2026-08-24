import { describe, expect, it } from "vitest";

import type { QueuedChatTurn } from "./types";
import { queuedTurnsQueryOptions } from "./query-options";

function turn(status: QueuedChatTurn["status"]): QueuedChatTurn {
  return {
    chatId: "chat_1",
    content: "Queued turn",
    createdAt: "2026-08-24T00:00:00.000Z",
    id: `turn_${status}`,
    idempotencyKey: `key_${status}`,
    status,
  };
}

describe("queued turn recovery polling", () => {
  it("polls only while server work can still advance", () => {
    const interval = queuedTurnsQueryOptions("chat_1").refetchInterval;
    if (typeof interval !== "function") throw new Error("Expected polling");
    const query = (data: QueuedChatTurn[]) =>
      ({ state: { data } }) as Parameters<typeof interval>[0];

    expect(interval(query([turn("queued")]))).toBe(250);
    expect(interval(query([turn("leased")]))).toBe(250);
    expect(interval(query([turn("failed")]))).toBe(false);
    expect(interval(query([]))).toBe(false);
  });
});
