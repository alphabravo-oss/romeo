import { RomeoApiError } from "@romeo/api-client";
import { describe, expect, it } from "vitest";

import { safeUserErrorMessage } from "./safe-user-error";

describe("safeUserErrorMessage", () => {
  it("never exposes raw server or provider messages", () => {
    const error = new RomeoApiError("api_key=super-secret at 10.0.0.8", 502, {
      error: {
        code: "provider_failed",
        details: {},
        message: "api_key=super-secret at 10.0.0.8",
        request_id: "req.safe-123",
      },
    });

    const message = safeUserErrorMessage(error, "Could not save connection.");
    expect(message).toBe("Could not save connection. [req.safe-123]");
    expect(message).not.toContain("super-secret");
    expect(message).not.toContain("10.0.0.8");
  });

  it("omits invalid correlation values and generic Error messages", () => {
    const invalidReference = new RomeoApiError("secret", 500, {
      error: {
        code: "unexpected",
        details: {},
        message: "secret",
        request_id: "unsafe request id<script>",
      },
    });
    expect(safeUserErrorMessage(invalidReference, "Action failed.")).toBe(
      "Action failed.",
    );
    expect(
      safeUserErrorMessage(new Error("password=hunter2"), "Action failed."),
    ).toBe("Action failed.");
  });
});
