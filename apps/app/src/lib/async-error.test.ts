import { describe, expect, it } from "vitest";

import {
  asyncErrorFingerprint,
  createAsyncErrorDedupeState,
  shouldReportAsyncError,
} from "./async-error";

describe("unhandled asynchronous error reporting", () => {
  it("uses metadata without retaining sensitive messages", () => {
    const error = Object.assign(new Error("token=super-secret"), {
      code: "provider_failed",
      status: 502,
    });
    const fingerprint = asyncErrorFingerprint(error);
    expect(fingerprint).toBe("Error:502:provider_failed");
    expect(fingerprint).not.toContain("super-secret");
  });

  it("deduplicates a failure within the reporting window", () => {
    const state = createAsyncErrorDedupeState();
    expect(shouldReportAsyncError(state, { status: 500 }, 1_000)).toBe(true);
    expect(shouldReportAsyncError(state, { status: 500 }, 2_000)).toBe(false);
    expect(shouldReportAsyncError(state, { status: 500 }, 7_000)).toBe(true);
  });

  it("ignores intentional aborts", () => {
    const state = createAsyncErrorDedupeState();
    expect(
      shouldReportAsyncError(
        state,
        Object.assign(new Error("aborted"), { name: "AbortError" }),
      ),
    ).toBe(false);
  });
});
