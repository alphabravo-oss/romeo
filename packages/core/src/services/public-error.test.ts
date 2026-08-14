import { describe, expect, it } from "vitest";

import { ApiError } from "../errors";
import { bulkErrorMessage } from "./bulk-action-result";

describe("public error classification", () => {
  it("never exposes unexpected provider or credential-bearing messages", () => {
    const secret = "postgres://user:password@private.example/db?token=secret";

    expect(bulkErrorMessage(new Error(secret))).toBe(
      "The item could not be updated.",
    );
    expect(
      bulkErrorMessage(new ApiError("provider_generation_failed", secret, 502)),
    ).toBe("The item could not be updated.");
  });

  it("preserves explicitly classified user-actionable messages", () => {
    expect(
      bulkErrorMessage(
        new ApiError("not_found", "API key was not found.", 404),
      ),
    ).toBe("API key was not found.");
  });
});
