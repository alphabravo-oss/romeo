import { describe, expect, it } from "vitest";

import { throwIfSignalAborted } from "./abort-signal";

describe("throwIfSignalAborted", () => {
  it("does nothing for absent and live signals", () => {
    expect(() => throwIfSignalAborted(undefined)).not.toThrow();
    expect(() =>
      throwIfSignalAborted({ aborted: false, reason: undefined }),
    ).not.toThrow();
  });

  it("preserves real abort errors and normalizes an undefined reason", () => {
    const reason = new DOMException("cancelled", "AbortError");
    expect(() => throwIfSignalAborted({ aborted: true, reason })).toThrow(
      reason,
    );
    expect(() =>
      throwIfSignalAborted({ aborted: true, reason: undefined }),
    ).toThrowError(expect.objectContaining({ name: "AbortError" }));
  });
});
