import { describe, expect, it } from "vitest";

import {
  BREAK_GLASS_MAX_TTL_MINUTES,
  authorizeBreakGlass,
  breakGlassExpired,
} from "./break-glass";

describe("break-glass", () => {
  it("requires reason, dual control, bounded TTL, and keeps mandatory controls on", () => {
    const accepted = authorizeBreakGlass({
      actorId: "user_admin",
      approverId: "user_reviewer",
      now: "2026-08-14T12:00:00.000Z",
      reason: "Sealed legal hold investigation",
      requestedControls: ["support_impersonation"],
      ttlMinutes: 30,
    });
    expect(accepted).toMatchObject({
      alerted: true,
      expiresAt: "2026-08-14T12:30:00.000Z", // deliberately-expired: ttl boundary
      outcome: "accepted",
    });
    expect(
      authorizeBreakGlass({
        actorId: "user_admin",
        approverId: "user_admin",
        now: "2026-08-14T12:00:00.000Z",
        reason: "Sealed legal hold investigation",
        requestedControls: ["support_impersonation"],
        ttlMinutes: 30,
      }),
    ).toEqual({ code: "break_glass_self_approval", outcome: "denied" });
    expect(
      authorizeBreakGlass({
        actorId: "user_admin",
        approverId: "user_reviewer",
        now: "2026-08-14T12:00:00.000Z",
        reason: "Sealed legal hold investigation",
        requestedControls: ["tenant_encryption"],
        ttlMinutes: 30,
      }),
    ).toEqual({ code: "break_glass_mandatory_control", outcome: "denied" });
    expect(
      authorizeBreakGlass({
        actorId: "user_admin",
        approverId: "user_reviewer",
        now: "2026-08-14T12:00:00.000Z",
        reason: "short",
        requestedControls: [],
        ttlMinutes: 30,
      }),
    ).toEqual({ code: "break_glass_reason_required", outcome: "denied" });
    expect(
      authorizeBreakGlass({
        actorId: "user_admin",
        approverId: "user_reviewer",
        now: "2026-08-14T12:00:00.000Z",
        reason: "Sealed legal hold investigation",
        requestedControls: [],
        ttlMinutes: BREAK_GLASS_MAX_TTL_MINUTES + 1,
      }),
    ).toEqual({ code: "break_glass_ttl_exceeded", outcome: "denied" });
    expect(
      breakGlassExpired({
        expiresAt: "2026-08-14T12:30:00.000Z", // deliberately-expired: ttl elapsed
        now: "2026-08-14T12:30:00.000Z",
      }),
    ).toBe(true);
  });
});
