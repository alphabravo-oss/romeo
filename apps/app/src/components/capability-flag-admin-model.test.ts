import { describe, expect, it } from "vitest";

import {
  capabilityFlagNameKey,
  formatCapabilityFlagAllowlist,
  parseCapabilityFlagAllowlist,
} from "./capability-flag-admin-model";

describe("capability flag admin model", () => {
  it("parses and formats a bounded typed preview allowlist", () => {
    const result = parseCapabilityFlagAllowlist(
      "user:user_one\nservice_account:service:two",
    );
    expect(result).toEqual({
      ok: true,
      subjects: [
        { subjectId: "user_one", subjectType: "user" },
        { subjectId: "service:two", subjectType: "service_account" },
      ],
    });
    if (result.ok) {
      expect(formatCapabilityFlagAllowlist(result.subjects)).toBe(
        "user:user_one\nservice_account:service:two",
      );
    }
  });

  it("rejects malformed, duplicate, control-bearing, and oversized input", () => {
    expect(parseCapabilityFlagAllowlist("group:one")).toMatchObject({
      error: "invalid",
    });
    expect(parseCapabilityFlagAllowlist("user:one\nuser:one")).toMatchObject({
      error: "duplicate",
    });
    expect(parseCapabilityFlagAllowlist("user:bad\u0001id")).toMatchObject({
      error: "invalid",
    });
    expect(
      parseCapabilityFlagAllowlist(
        Array.from({ length: 101 }, (_, index) => `user:user_${index}`).join(
          "\n",
        ),
      ),
    ).toMatchObject({ error: "too_many" });
  });

  it("maps every flag to localized copy", () => {
    expect(capabilityFlagNameKey("image_jobs_v2")).toBe(
      "capabilityFlagImageJobs",
    );
    expect(capabilityFlagNameKey("trust_plane_v1")).toBe(
      "capabilityFlagTrustPlane",
    );
  });
});
