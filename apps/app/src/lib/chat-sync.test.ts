import { describe, expect, it } from "vitest";

import { chatSyncFallbackInterval } from "./chat-sync";

describe("chat event fallback policy", () => {
  it("polls only while the online stream is degraded", () => {
    expect(chatSyncFallbackInterval("degraded", true)).toBe(15_000);
    expect(chatSyncFallbackInterval("degraded", false)).toBeUndefined();
    expect(chatSyncFallbackInterval("connecting", true)).toBe(15_000);
    expect(chatSyncFallbackInterval("connected", true)).toBe(60_000);
  });
});
