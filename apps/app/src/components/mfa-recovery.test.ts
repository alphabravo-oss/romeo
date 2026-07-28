import { describe, expect, it } from "vitest";

import { isLockoutRisk, recoveryCodesRemaining } from "./mfa-recovery";

describe("MFA recovery-code state", () => {
  it("is not at risk when MFA is disabled", () => {
    expect(isLockoutRisk({ mfaEnabled: false, factors: [] })).toBe(false);
  });

  it("is not at risk when ten usable recovery codes remain", () => {
    const state = {
      mfaEnabled: true,
      factors: [
        {
          type: "recovery_codes" as const,
          status: "active" as const,
          recoveryCodeRemainingCount: 10,
        },
      ],
    };

    expect(recoveryCodesRemaining(state)).toBe(10);
    expect(isLockoutRisk(state)).toBe(false);
  });

  it("detects the lockout risk when MFA has no recovery factor", () => {
    expect(
      isLockoutRisk({
        mfaEnabled: true,
        factors: [{ type: "totp", status: "active" }],
      }),
    ).toBe(true);
  });

  it("detects the lockout risk when no recovery codes remain", () => {
    expect(
      isLockoutRisk({
        mfaEnabled: true,
        factors: [
          {
            type: "recovery_codes",
            status: "active",
            recoveryCodeRemainingCount: 0,
          },
        ],
      }),
    ).toBe(true);
  });

  it("ignores a disabled recovery-code factor", () => {
    const state = {
      mfaEnabled: true,
      factors: [
        {
          type: "recovery_codes" as const,
          status: "disabled" as const,
          disabledAt: "2026-07-28T00:00:00.000Z",
          recoveryCodeRemainingCount: 10,
        },
      ],
    };

    expect(recoveryCodesRemaining(state)).toBe(0);
    expect(isLockoutRisk(state)).toBe(true);
  });
});
