import { RomeoApiError } from "@romeo/api-client";
import { describe, expect, it } from "vitest";

import { contextInspectionUserError } from "./workspace-context-inspection";

describe("context inspection user errors", () => {
  it("explains a context-window overflow without exposing server text", () => {
    const error = new RomeoApiError("provider_secret=never-show", 400, {
      error: {
        code: "run_context_window_exceeded",
        details: { contextWindow: 1024, estimatedTokens: 8_000 },
        message: "provider_secret=never-show",
        request_id: "req.context-1",
      },
    });

    const message = contextInspectionUserError(
      error,
      "Inspection failed.",
      "This turn exceeds the selected model's context window.",
    );

    expect(message).toBe(
      "This turn exceeds the selected model's context window. [req.context-1]",
    );
    expect(message).not.toContain("provider_secret");
  });

  it("uses the generic safe fallback for unrelated failures", () => {
    expect(
      contextInspectionUserError(
        new Error("password=never-show"),
        "Inspection failed.",
        "Context is too large.",
      ),
    ).toBe("Inspection failed.");
  });
});
