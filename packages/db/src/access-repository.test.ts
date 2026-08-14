import { describe, expect, it } from "vitest";

import {
  toResourceGrantRecord,
  type ResourceTypeRecord,
} from "./access-repository";

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
      createdAt: "2026-06-27T00:00:00.000Z",
      id: "grant_1",
      resourceType: "organization",
      resourceId: "org_1",
      principalType: "group",
      principalId: "group_admins",
      permission: "read",
    });
  });

  it.each([
    "agent",
    "chat",
    "data_connector",
    "file",
    "folder",
    "knowledge_base",
    "model",
    "organization",
    "prompt_template",
    "provider",
    "run",
    "tool",
    "voice_profile",
    "workspace",
  ] satisfies ResourceTypeRecord[])(
    "round-trips the %s resource type",
    (resourceType) => {
      expect(
        toResourceGrantRecord({
          id: `grant_${resourceType}`,
          orgId: "org_1",
          resourceType,
          resourceId: "resource_1",
          principalType: "user",
          principalId: "user_1",
          permission: "read",
          createdAt: new Date("2026-06-27T00:00:00.000Z"),
        }).resourceType,
      ).toBe(resourceType);
    },
  );
});
