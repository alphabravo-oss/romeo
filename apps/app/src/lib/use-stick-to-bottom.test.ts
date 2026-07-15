import { describe, expect, it } from "vitest";

import { shouldStickToBottom } from "./use-stick-to-bottom";

describe("shouldStickToBottom", () => {
  it("sticks when the viewport is already at the bottom", () => {
    expect(
      shouldStickToBottom({ scrollTop: 900, clientHeight: 100, scrollHeight: 1000 }),
    ).toBe(true);
  });

  it("sticks when within the slack threshold of the bottom", () => {
    expect(
      shouldStickToBottom({ scrollTop: 880, clientHeight: 100, scrollHeight: 1000 }),
    ).toBe(true);
  });

  it("does NOT stick when the user has scrolled up to read history", () => {
    expect(
      shouldStickToBottom({ scrollTop: 200, clientHeight: 100, scrollHeight: 1000 }),
    ).toBe(false);
  });

  it("sticks when content is shorter than the viewport", () => {
    expect(
      shouldStickToBottom({ scrollTop: 0, clientHeight: 500, scrollHeight: 300 }),
    ).toBe(true);
  });
});
