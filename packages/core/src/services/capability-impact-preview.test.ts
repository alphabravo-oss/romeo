import { describe, expect, it } from "vitest";

import { getCapabilityDefinition } from "./capability-definition-registry";
import { resolveGenericCapability } from "./capability-generic-resolution";
import {
  assertImpactPreviewPrivacy,
  summarizeCapabilityImpact,
} from "./capability-impact-preview";
import type { EffectiveCapability } from "./capability-resolution-model";

describe("capability impact preview", () => {
  it("returns counts and reason tallies without user content", () => {
    const allowed = sample("enabled", []);
    const denied = sample("not_allowed", [
      { code: "group_policy", layer: "group" },
    ]);
    const entitled = sample("not_entitled", [
      { code: "not_entitled", layer: "entitlement" },
    ]);
    const preview = summarizeCapabilityImpact([
      {
        role: "admin",
        workspaceClass: "regulated",
        effective: allowed,
      },
      {
        role: "member",
        workspaceClass: "regulated",
        effective: denied,
      },
      {
        role: "member",
        workspaceClass: "general",
        effective: entitled,
      },
    ]);

    expect(preview).toEqual({
      sampleCount: 3,
      counts: {
        enabled: 1,
        disabled: 0,
        required: 0,
        normalized: 0,
        not_configured: 0,
        not_entitled: 1,
        not_allowed: 1,
        unsupported: 0,
        unhealthy: 0,
      },
      reasons: [
        { code: "group_policy", layer: "group", count: 1 },
        { code: "not_entitled", layer: "entitlement", count: 1 },
      ],
    });
    expect(() => assertImpactPreviewPrivacy(preview)).not.toThrow();
    expect(JSON.stringify(preview)).not.toContain("user_");
  });

  it("summarizes shipped resolver output for a proposed deny", () => {
    const definition = getCapabilityDefinition("web_retrieval")!;
    const current = resolveGenericCapability({
      assignments: [],
      definition,
      now: "2026-08-14T10:00:00.000Z",
      platformDisabled: false,
    }).effective;
    const proposed = resolveGenericCapability({
      assignments: [
        {
          id: "capability_assignment_preview",
          orgId: "org_default",
          scopeType: "organization",
          scopeId: "org_default",
          capabilityId: "web_retrieval",
          state: "disabled",
          configuration: {},
          version: 1,
          actorId: "user_admin",
          reason: "preview",
          effectiveAt: "2026-08-14T10:00:00.000Z",
          createdAt: "2026-08-14T10:00:00.000Z",
        },
      ],
      definition,
      now: "2026-08-14T10:00:00.000Z",
      platformDisabled: false,
    }).effective;
    const preview = summarizeCapabilityImpact([
      { role: "member", workspaceClass: "default", effective: current },
      { role: "member", workspaceClass: "default", effective: proposed },
    ]);
    expect(preview.counts.enabled).toBe(1);
    expect(preview.counts.not_allowed).toBe(1);
    expect(preview.reasons).toContainEqual({
      code: "organization_policy",
      layer: "organization",
      count: 1,
    });
  });
});

function sample(
  status: EffectiveCapability["status"],
  reasons: EffectiveCapability["reasons"],
): EffectiveCapability {
  return {
    capabilityId: "web_retrieval",
    status,
    dimensions: {
      installed: "unknown",
      entitled: "not_required",
      available: "unknown",
      allowed: status === "not_allowed" ? "no" : "yes",
      capable: "unknown",
      selected: "defaulted",
    },
    effective: { maxSearchResults: 10, maxUrlsPerRequest: 5 },
    requestedChanges: [],
    reasons,
    assignmentVersions: [],
    registryVersion: "cap-registry-v2",
    resolvedAt: "2026-08-14T10:00:00.000Z",
  };
}
