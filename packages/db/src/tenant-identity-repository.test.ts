import { describe, expect, it } from "vitest";

import {
  toGroupMembershipRecord,
  toGroupRecord,
  toSsoOidcSettingsRecord,
  toUserRecord,
} from "./identity-repository";
import { toWorkspaceRecord } from "./tenant-repository";

describe("tenant identity repository mappers", () => {
  it("maps tenant identity rows to API-safe records", () => {
    expect(
      toUserRecord({
        id: "user_1",
        orgId: "org_1",
        email: "user@example.com",
        name: "User One",
        role: "user",
        disabledAt: null,
        createdAt: new Date("2026-06-27T00:00:00.000Z"),
        updatedAt: new Date("2026-06-27T00:00:00.000Z"),
      }),
    ).toEqual({
      id: "user_1",
      orgId: "org_1",
      email: "user@example.com",
      name: "User One",
      role: "user",
    });

    expect(
      toWorkspaceRecord({
        id: "workspace_1",
        orgId: "org_1",
        name: "Workspace One",
        slug: "workspace-one",
        archivedAt: new Date("2026-06-28T00:00:00.000Z"),
        createdAt: new Date("2026-06-27T00:00:00.000Z"),
        updatedAt: new Date("2026-06-27T00:00:00.000Z"),
      }),
    ).toMatchObject({
      archivedAt: "2026-06-28T00:00:00.000Z",
    });
  });

  it("maps group and SSO rows without leaking Date objects", () => {
    expect(
      toGroupRecord({
        id: "group_1",
        orgId: "org_1",
        name: "Admins",
        slug: "admins",
        createdAt: new Date("2026-06-27T00:00:00.000Z"),
      }),
    ).toMatchObject({ createdAt: "2026-06-27T00:00:00.000Z" });

    expect(
      toGroupMembershipRecord({
        orgId: "org_1",
        groupId: "group_1",
        userId: "user_1",
        createdAt: new Date("2026-06-27T00:00:00.000Z"),
      }),
    ).toEqual({
      orgId: "org_1",
      groupId: "group_1",
      userId: "user_1",
      createdAt: "2026-06-27T00:00:00.000Z",
    });

    expect(
      toSsoOidcSettingsRecord({
        orgId: "org_1",
        enabled: true,
        issuerUrl: "https://issuer.example.com",
        clientId: "client_1",
        groupClaim: "groups",
        adminGroups: ["admins", 1],
        groupMap: { admins: "group_1", ignored: 1 },
        workspaceGroupMap: { engineering: "workspace_1" },
        workspaceGroupPrefix: "workspace:",
        createdBy: "user_1",
        updatedBy: "user_2",
        createdAt: new Date("2026-06-27T00:00:00.000Z"),
        updatedAt: new Date("2026-06-28T00:00:00.000Z"),
      }),
    ).toMatchObject({
      adminGroups: ["admins"],
      groupMap: { admins: "group_1" },
      createdAt: "2026-06-27T00:00:00.000Z",
      updatedAt: "2026-06-28T00:00:00.000Z",
    });
  });
});
