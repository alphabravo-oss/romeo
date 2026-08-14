import { describe, expect, it } from "vitest";

import { capabilityAssignmentScope } from "./queries";

describe("capability query scopes", () => {
  it("does not leak overview-only workspace context into assignment routes", () => {
    expect(
      capabilityAssignmentScope({
        scopeType: "organization",
        scopeId: "org-1",
        workspaceId: "workspace-context",
      }),
    ).toEqual({ scopeType: "organization", scopeId: "org-1" });
  });

  it.each(["organization", "workspace", "agent", "group", "user"] as const)(
    "keeps %s assignment identity while stripping evaluation context",
    (scopeType) => {
      expect(
        capabilityAssignmentScope({
          scopeType,
          scopeId: `${scopeType}-1`,
          workspaceId: "workspace-context",
        }),
      ).toEqual({ scopeType, scopeId: `${scopeType}-1` });
    },
  );
});
