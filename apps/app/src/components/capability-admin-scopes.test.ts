import { describe, expect, it } from "vitest";

import { buildCapabilityScopeOptions } from "./capability-admin-scopes";

describe("capability admin scope options", () => {
  it("builds every assignment layer with an exact evaluation workspace", () => {
    const options = buildCapabilityScopeOptions({
      subjectOrgId: "org-1",
      organizationName: "Organization",
      workspaces: [
        { id: "workspace-a", name: "Workspace A" },
        { id: "workspace-b", name: "Workspace B" },
      ],
      agents: [{ id: "agent-a", name: "Agent A", workspaceId: "workspace-a" }],
      groups: [{ id: "group-a", name: "Group A" }],
      users: [
        {
          id: "user-a",
          name: "User A",
          email: "user-a@example.test",
        },
        {
          id: "user-disabled",
          name: "Disabled",
          email: "disabled@example.test",
          disabledAt: "2026-08-14T10:00:00.000Z",
        },
      ],
      identityWorkspaceId: "workspace-b",
    });

    expect(options.map(({ scope }) => scope.scopeType)).toEqual([
      "organization",
      "workspace",
      "workspace",
      "agent",
      "group",
      "user",
    ]);
    expect(options.find(({ key }) => key === "agent:agent-a")?.scope).toEqual({
      scopeType: "agent",
      scopeId: "agent-a",
      workspaceId: "workspace-a",
    });
    expect(options.find(({ key }) => key === "group:group-a")?.scope).toEqual({
      scopeType: "group",
      scopeId: "group-a",
      workspaceId: "workspace-b",
    });
    expect(options.find(({ key }) => key === "user:user-a")?.scope).toEqual({
      scopeType: "user",
      scopeId: "user-a",
      workspaceId: "workspace-b",
    });
    expect(options.some(({ key }) => key === "user:user-disabled")).toBe(false);
  });

  it("does not invent organization or identity scope without a workspace", () => {
    expect(
      buildCapabilityScopeOptions({
        subjectOrgId: "org-1",
        workspaces: [],
        agents: [],
      }),
    ).toEqual([]);
  });
});
