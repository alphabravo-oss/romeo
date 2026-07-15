import { describe, expect, it } from "vitest";

import { toResourceGrantRecord } from "./access-repository";

describe("access repository mappers", () => {
  it("maps grants and falls back safely for unknown resource types", () => {
    const grant = toResourceGrantRecord({
      id: "grant_1",
      orgId: "org_1",
      resourceType: "unknown",
      resourceId: "org_1",
      principalType: "group",
      principalId: "group_admins",
      permission: "read",
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
    });

    expect(grant).toEqual({
      id: "grant_1",
      resourceType: "organization",
      resourceId: "org_1",
      principalType: "group",
      principalId: "group_admins",
      permission: "read",
    });
  });
});
