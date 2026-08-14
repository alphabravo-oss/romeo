import { describe, expect, it } from "vitest";

import { MemoryLdapLoginAttemptStore } from "./ldap-login-attempt-store";

describe("LDAP login attempt coordination", () => {
  it("shares lockout state across service instances and clears it after success", async () => {
    const shared = new Map<string, { count: number; expiresAt: number }>();
    const options = { lockoutMs: 60_000, maxFailedAttempts: 3 };
    const first = new MemoryLdapLoginAttemptStore(options, shared);
    const second = new MemoryLdapLoginAttemptStore(options, shared);

    await expect(first.recordFailure("org:provider:user")).resolves.toBe(false);
    await expect(second.recordFailure("org:provider:user")).resolves.toBe(
      false,
    );
    await expect(first.recordFailure("org:provider:user")).resolves.toBe(true);
    await expect(second.isLocked("org:provider:user")).resolves.toBe(true);

    await second.clear("org:provider:user");
    await expect(first.isLocked("org:provider:user")).resolves.toBe(false);
  });
});
