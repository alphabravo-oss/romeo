import { describe, expect, it } from "vitest";

import { canDisableUser } from "./user-disable-guard";

const admin = (id: string, status = "active") => ({
  id,
  role: "global_admin",
  status,
});
const member = (id: string) => ({ id, role: "member", status: "active" });

describe("user disable guard", () => {
  it("refuses to disable the only active global admin", () => {
    expect(canDisableUser(admin("a"), 1)).toBe(false);
  });

  it("allows disabling an admin when another active admin remains", () => {
    expect(canDisableUser(admin("a"), 2)).toBe(true);
  });

  it("ignores already-disabled admins when counting", () => {
    expect(canDisableUser(admin("a"), 1)).toBe(false);
  });

  it("always allows disabling a non-admin", () => {
    expect(canDisableUser(member("b"), 1)).toBe(true);
  });
});
