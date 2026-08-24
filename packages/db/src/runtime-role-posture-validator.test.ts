import { describe, expect, it } from "vitest";

import {
  type RuntimeRolePosture,
  RuntimeRolePostureValidator,
} from "./runtime-role-posture-validator";

const safePosture: RuntimeRolePosture = {
  bypassesRls: false,
  coordinator: true,
  inheritsPrivileges: false,
  superuser: false,
  tenantRuntime: true,
};

describe("RuntimeRolePostureValidator", () => {
  it("single-flights bursts and revalidates after its bounded success TTL", async () => {
    let calls = 0;
    let now = 1_000;
    const validator = new RuntimeRolePostureValidator(
      async () => {
        calls += 1;
        await Promise.resolve();
        return safePosture;
      },
      { now: () => now, successTtlMs: 1_000 },
    );

    await Promise.all(
      Array.from({ length: 50 }, () => validator.assertEligible()),
    );
    expect(calls).toBe(1);
    await validator.assertEligible();
    expect(calls).toBe(1);
    now += 1_001;
    await validator.assertEligible();
    expect(calls).toBe(2);
  });

  it("does not cache failures and rejects every unsafe or incomplete posture", async () => {
    let posture: RuntimeRolePosture | undefined = {
      ...safePosture,
      coordinator: false,
    };
    let calls = 0;
    const validator = new RuntimeRolePostureValidator(async () => {
      calls += 1;
      return posture;
    });
    await expect(validator.assertEligible()).rejects.toThrow(
      "tenant_database_context_role_required",
    );
    posture = safePosture;
    await expect(validator.assertEligible()).resolves.toBeUndefined();
    expect(calls).toBe(2);

    for (const unsafe of [
      { ...safePosture, bypassesRls: true },
      { ...safePosture, inheritsPrivileges: true },
      { ...safePosture, superuser: true },
      undefined,
    ]) {
      const rejected = new RuntimeRolePostureValidator(async () => unsafe);
      await expect(rejected.assertEligible()).rejects.toThrow(
        "tenant_database_context_privileged_role_forbidden",
      );
    }
  });
});
