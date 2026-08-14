import { describe, expect, it } from "vitest";

import type { CapabilityAssignment } from "../domain/capabilities";
import { getCapabilityDefinition } from "./capability-definition-registry";
import { resolveGenericCapability } from "./capability-generic-resolution";
import {
  capabilityLayerPrecedence,
  dedupeReasons,
  type CapabilityReasonCode,
} from "./capability-resolution-model";

describe("generic capability layer matrix", () => {
  it("orders every persisted layer deterministically and keeps an upper/group deny absolute", () => {
    const now = "2026-08-14T10:00:00.000Z";
    const assignments = [
      assignment("user", "user_1", 7, "enabled", 4, "10:07"),
      assignment("group", "group_z", 6, "disabled", 4, "10:06"),
      assignment("agent", "agent_1", 4, "enabled", 3, "10:04"),
      assignment("workspace", "workspace_1", 2, "enabled", 3, "10:02"),
      assignment("group", "group_a", 5, "enabled", 2, "10:05"),
      assignment("organization", "org_default", 1, "enabled", 4, "10:01"),
    ];
    const resolve = (items: CapabilityAssignment[]) =>
      resolveGenericCapability({
        assignments: items,
        agentVersionDefault: {
          state: "enabled",
          configuration: { maxImagesPerRequest: 2 },
          assignmentVersion: 3,
          expiresAt: "2026-08-14T10:03:00.000Z", // deliberately-expired: deterministic matrix
        },
        definition: getCapabilityDefinition("image_generation")!,
        now,
        platformDisabled: false,
        requested: { selected: true, maxImagesPerRequest: 4 },
      }).effective;
    const effective = resolve(assignments);
    const reversed = resolve([...assignments].reverse());

    expect(effective).toMatchObject({
      status: "not_allowed",
      dimensions: { allowed: "no" },
      effective: { maxImagesPerRequest: 2 },
      expiresAt: "2026-08-14T10:01:00.000Z", // deliberately-expired: deterministic matrix
      reasons: expect.arrayContaining([
        { code: "group_policy", layer: "group" },
        { code: "requested_value_outside_limit", layer: "action" },
      ]),
    });
    expect(effective.assignmentVersions).toEqual([
      { layer: "organization", version: 1 },
      { layer: "workspace", version: 2 },
      { layer: "agent_version", version: 3 },
      { layer: "agent", version: 4 },
      { layer: "group", version: 5 },
      { layer: "group", version: 6 },
      { layer: "user", version: 7 },
    ]);
    expect(reversed).toEqual(effective);
  });

  it("distinguishes platform_disabled, not_allowed, not_entitled, and not_configured", () => {
    const definition = getCapabilityDefinition("web_retrieval")!;
    const now = "2026-08-14T10:00:00.000Z";
    expect(
      resolveGenericCapability({
        assignments: [],
        definition,
        now,
        platformDisabled: true,
      }).effective.status,
    ).toBe("disabled");
    expect(
      resolveGenericCapability({
        assignments: [
          {
            id: "assignment_org_deny",
            orgId: "org_default",
            scopeType: "organization",
            scopeId: "org_default",
            capabilityId: "web_retrieval",
            state: "disabled",
            configuration: {},
            version: 1,
            actorId: "user_admin",
            reason: "Deny",
            effectiveAt: "2026-08-14T09:00:00.000Z",
            createdAt: "2026-08-14T09:00:00.000Z",
          },
        ],
        definition,
        now,
        platformDisabled: false,
      }).effective.status,
    ).toBe("not_allowed");
    expect(
      resolveGenericCapability({
        assignments: [],
        definition,
        now,
        platformDisabled: false,
        entitled: false,
      }).effective,
    ).toMatchObject({
      status: "not_entitled",
      dimensions: { entitled: "no" },
      reasons: [{ code: "not_entitled", layer: "entitlement" }],
    });
    expect(
      resolveGenericCapability({
        assignments: [],
        definition,
        now,
        platformDisabled: false,
        installed: "no",
      }).effective,
    ).toMatchObject({
      status: "not_configured",
      dimensions: { installed: "no" },
      reasons: [{ code: "not_configured", layer: "deployment" }],
    });
  });

  it("keeps a required parent above a child disable", () => {
    const effective = resolveGenericCapability({
      assignments: [
        assignment("organization", "org_default", 1, "required", 4, "10:01"),
        assignment("workspace", "workspace_1", 2, "disabled", 1, "10:02"),
      ],
      definition: getCapabilityDefinition("image_generation")!,
      now: "2026-08-14T10:00:00.000Z",
      platformDisabled: false,
    }).effective;
    expect(effective.status).toBe("required");
    expect(effective.dimensions.allowed).toBe("yes");
  });

  it("keeps the deployment/platform ceiling above every assignment enable", () => {
    const effective = resolveGenericCapability({
      assignments: [assignment("user", "user_1", 1, "enabled", 4, "10:01")],
      definition: getCapabilityDefinition("image_generation")!,
      now: "2026-08-14T10:00:00.000Z",
      platformDisabled: true,
    }).effective;
    expect(effective.status).toBe("disabled");
    expect(effective.reasons).toContainEqual({
      code: "platform_disabled",
      layer: "platform",
    });
  });

  it("orders sanitized evidence through every effective control-plane layer", () => {
    const codeByLayer: Record<
      (typeof capabilityLayerPrecedence)[number],
      CapabilityReasonCode
    > = {
      deployment: "not_configured",
      platform: "platform_disabled",
      entitlement: "not_entitled",
      organization: "organization_policy",
      workspace: "workspace_policy",
      agent_version: "agent_version_policy",
      agent: "agent_policy",
      group: "group_policy",
      user: "user_policy",
      action: "requested_value_outside_limit",
      resource: "missing_grant",
      provider_model: "model_unsupported",
      quota: "quota_exceeded",
    };
    const reasons = [...capabilityLayerPrecedence]
      .reverse()
      .map((layer) => ({ layer, code: codeByLayer[layer] }));

    expect(dedupeReasons(reasons).map(({ layer }) => layer)).toEqual(
      capabilityLayerPrecedence,
    );
  });
});

function assignment(
  scopeType: CapabilityAssignment["scopeType"],
  scopeId: string,
  version: number,
  state: CapabilityAssignment["state"],
  maximum: number,
  expiryMinute: string,
): CapabilityAssignment {
  return {
    id: `assignment_${scopeType}_${scopeId}`,
    orgId: "org_default",
    scopeType,
    scopeId,
    capabilityId: "image_generation",
    state,
    configuration: { maxImagesPerRequest: maximum },
    version,
    actorId: "user_admin",
    reason: "Layer matrix",
    effectiveAt: "2026-08-14T09:00:00.000Z",
    expiresAt: `2026-08-14T${expiryMinute}:00.000Z`,
    createdAt: "2026-08-14T09:00:00.000Z",
  };
}
