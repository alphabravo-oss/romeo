import { describe, expect, it } from "vitest";

import { humanizeWarningCode } from "./posture-warning-text";

describe("posture warning text", () => {
  it("preserves known acronyms at the start of a code", () => {
    expect(humanizeWarningCode("ga_checklist_path_not_configured")).toBe(
      "GA checklist path not configured",
    );
  });

  it("preserves known acronyms in the middle of a code", () => {
    expect(humanizeWarningCode("missing_sso_binding")).toBe(
      "Missing SSO binding",
    );
  });

  it("sentence-cases ordinary words", () => {
    expect(humanizeWarningCode("queue_depth_high")).toBe("Queue depth high");
  });

  it("returns an empty string unchanged rather than producing a stray capital", () => {
    expect(humanizeWarningCode("")).toBe("");
  });
});
