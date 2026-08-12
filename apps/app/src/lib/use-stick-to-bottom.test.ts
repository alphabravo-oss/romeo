import { describe, expect, it } from "vitest";

import { shouldStickToBottom } from "./use-stick-to-bottom";

describe("shouldStickToBottom", () => {
  it("sticks when the viewport is already at the bottom", () => {
    expect(
      shouldStickToBottom({
        scrollTop: 900,
        clientHeight: 100,
        scrollHeight: 1000,
      }),
    ).toBe(true);
  });

  it("sticks when within the slack threshold of the bottom", () => {
    expect(
      shouldStickToBottom({
        scrollTop: 880,
        clientHeight: 100,
        scrollHeight: 1000,
      }),
    ).toBe(true);
  });

  it("does NOT stick when the user has scrolled up to read history", () => {
    expect(
      shouldStickToBottom({
        scrollTop: 200,
        clientHeight: 100,
        scrollHeight: 1000,
      }),
    ).toBe(false);
  });

  it("sticks when content is shorter than the viewport", () => {
    expect(
      shouldStickToBottom({
        scrollTop: 0,
        clientHeight: 500,
        scrollHeight: 300,
      }),
    ).toBe(true);
  });

  // The same predicate now decides two things: whether the stream follows the
  // reader, and whether the jump-to-latest button is offered. The cases below
  // pin the exact pixel where the button appears, because a threshold that
  // drifted would either hide the button from someone who has stopped
  // following or float one over a reader who never left the bottom.
  it("still sticks exactly at the slack threshold", () => {
    expect(
      shouldStickToBottom({
        scrollTop: 836,
        clientHeight: 100,
        scrollHeight: 1000,
      }),
    ).toBe(true);
  });

  it("stops sticking one pixel past the slack threshold", () => {
    expect(
      shouldStickToBottom({
        scrollTop: 835,
        clientHeight: 100,
        scrollHeight: 1000,
      }),
    ).toBe(false);
  });

  // Browsers report fractional scroll metrics under page zoom and on HiDPI
  // displays, so "at the bottom" is routinely 899.5 rather than 900.
  it("sticks on fractional metrics that never reach the bottom exactly", () => {
    expect(
      shouldStickToBottom({
        scrollTop: 899.5,
        clientHeight: 100.25,
        scrollHeight: 1000,
      }),
    ).toBe(true);
  });
});
