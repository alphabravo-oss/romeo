import { describe, expect, it } from "vitest";

import {
  assignmentPolicyVersion,
  capabilityResolutionCacheKey,
  readCapabilityResolutionCache,
} from "./capability-resolution-cache";
import type { EffectiveCapability } from "./capability-resolution-model";

const key = {
  orgId: "org_default",
  workspaceId: "workspace_default",
  subjectId: "user_admin",
  grantVersion: "g1",
  policyVersion: "organization:2,workspace:3",
  capabilityId: "web_retrieval" as const,
  healthVersion: "h1",
  registryVersion: "cap-registry-v2",
};

describe("capability resolution cache", () => {
  it("hits only when every versioned dimension matches", () => {
    const value = effective();
    const entry = {
      key,
      value,
      storedAt: "2026-08-14T10:00:00.000Z",
      expiresAt: "2027-08-14T10:05:00.000Z",
    };
    expect(
      readCapabilityResolutionCache({
        entry,
        key,
        now: "2026-08-14T10:01:00.000Z",
        risk: "low",
      }),
    ).toEqual({ outcome: "hit", value });
    expect(
      readCapabilityResolutionCache({
        entry,
        key: { ...key, policyVersion: "organization:3" },
        now: "2026-08-14T10:01:00.000Z",
        risk: "low",
      }),
    ).toEqual({ outcome: "miss" });
  });

  it("fails closed on stale high-risk resolution and misses on low-risk stale", () => {
    const entry = {
      key,
      value: effective(),
      storedAt: "2026-08-14T10:00:00.000Z",
      expiresAt: "2026-08-14T10:01:00.000Z", // deliberately-expired: stale high-risk cache
    };
    expect(
      readCapabilityResolutionCache({
        entry,
        key,
        now: "2026-08-14T10:02:00.000Z",
        risk: "critical",
      }),
    ).toEqual({
      outcome: "stale_fail",
      code: "capability_resolution_stale",
    });
    expect(
      readCapabilityResolutionCache({
        entry,
        key,
        now: "2026-08-14T10:02:00.000Z",
        risk: "low",
      }),
    ).toEqual({ outcome: "miss" });
  });

  it("encodes assignment versions into the cache key", () => {
    expect(
      assignmentPolicyVersion([
        { layer: "organization", version: 2 },
        { layer: "workspace", version: 3 },
      ]),
    ).toBe("organization:2,workspace:3");
    expect(capabilityResolutionCacheKey(key)).toContain("web_retrieval");
    expect(capabilityResolutionCacheKey(key)).not.toContain("secret");
  });
});

function effective(): EffectiveCapability {
  return {
    capabilityId: "web_retrieval",
    status: "enabled",
    dimensions: {
      installed: "unknown",
      entitled: "not_required",
      available: "unknown",
      allowed: "yes",
      capable: "unknown",
      selected: "defaulted",
    },
    effective: { maxSearchResults: 10, maxUrlsPerRequest: 5 },
    requestedChanges: [],
    reasons: [],
    assignmentVersions: [
      { layer: "organization", version: 2 },
      { layer: "workspace", version: 3 },
    ],
    registryVersion: "cap-registry-v2",
    resolvedAt: "2026-08-14T10:00:00.000Z",
  };
}
