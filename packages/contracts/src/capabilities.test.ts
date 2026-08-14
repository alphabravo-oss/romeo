import { describe, expect, it } from "vitest";

import {
  CapabilityLayerSchema,
  CapabilityScopeTypeSchema,
  ResolveCapabilitiesSchema,
} from "./capabilities";

describe("versioned capability assignment contracts", () => {
  it("accepts the generic assignment scopes and immutable agent-version layer", () => {
    for (const scope of ["organization", "workspace", "agent", "group", "user"])
      expect(CapabilityScopeTypeSchema.parse(scope)).toBe(scope);
    expect(CapabilityLayerSchema.parse("agent_version")).toBe("agent_version");
  });

  it("allows agent context but rejects caller-selected user/group identities", () => {
    expect(
      ResolveCapabilitiesSchema.parse({
        capabilityIds: ["image_generation"],
        context: {
          workspaceId: "workspace_default",
          agentId: "agent_default",
          agentVersionId: "agent_version_default_v1",
        },
      }),
    ).toBeDefined();
    expect(
      ResolveCapabilitiesSchema.safeParse({
        capabilityIds: ["image_generation"],
        context: {
          workspaceId: "workspace_default",
          userId: "user_target",
        },
      }).success,
    ).toBe(false);
  });
});
