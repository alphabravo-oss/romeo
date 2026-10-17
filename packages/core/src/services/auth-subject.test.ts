import { describe, expect, it } from "vitest";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { createUserAuthSubject, normalizeUserRole } from "./auth-subject";

describe("user auth subjects", () => {
  it("authorizes the development seed user id by its stored role only", async () => {
    const repository = new InMemoryRomeoRepository();
    const seeded = await repository.getCurrentUser("user_dev_admin");
    if (seeded === undefined) throw new Error("Missing seeded user.");
    expect(normalizeUserRole(seeded)).toBe("global_admin");

    const demoted = await repository.updateUser({ ...seeded, role: "user" });
    expect(normalizeUserRole(demoted)).toBe("user");
    expect(normalizeUserRole({})).toBe("user");
    const subject = await createUserAuthSubject(repository, demoted);
    expect(subject.isAdmin).toBe(false);
    expect(subject.adminRole).toBeUndefined();
    expect(subject.scopes).not.toContain("admin:write");
  });
});
