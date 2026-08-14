import { describe, expect, it } from "vitest";

import { toCapabilityAssignment } from "./capability-assignment-repository";

describe("capability assignment repository mappers", () => {
  it("maps version history and optional lifecycle timestamps", () => {
    expect(
      toCapabilityAssignment({
        id: "capability_assignment_2",
        orgId: "org_1",
        scopeType: "workspace",
        scopeId: "workspace_1",
        capabilityId: "image_generation",
        state: "disabled",
        configuration: { maxImagesPerRequest: 2 },
        version: 2,
        supersedesId: "capability_assignment_1",
        actorId: "user_1",
        reason: "Limit image generation.",
        effectiveAt: new Date("2026-08-14T10:00:00.000Z"),
        expiresAt: new Date("2026-09-14T10:00:00.000Z"),
        revokedAt: null,
        createdAt: new Date("2026-08-14T10:00:00.000Z"),
      }),
    ).toEqual({
      id: "capability_assignment_2",
      orgId: "org_1",
      scopeType: "workspace",
      scopeId: "workspace_1",
      capabilityId: "image_generation",
      state: "disabled",
      configuration: { maxImagesPerRequest: 2 },
      version: 2,
      supersedesId: "capability_assignment_1",
      actorId: "user_1",
      reason: "Limit image generation.",
      effectiveAt: "2026-08-14T10:00:00.000Z",
      expiresAt: "2026-09-14T10:00:00.000Z",
      createdAt: "2026-08-14T10:00:00.000Z",
    });
  });
});
