import { describe, expect, it } from "vitest";

import {
  compareIdempotencyFingerprint,
  preflightCompareSession,
  recordCompareLegOutcome,
} from "./compare-preflight";

const legs = [
  {
    legId: "leg_a",
    modelId: "model_a",
    providerId: "provider_a",
    authorized: true,
    estimatedMicroUsd: 100,
  },
  {
    legId: "leg_b",
    modelId: "model_b",
    providerId: "provider_b",
    authorized: true,
    estimatedMicroUsd: 150,
  },
];

describe("compare preflight", () => {
  it("authorizes every child before any leg starts and preserves partial success", () => {
    expect(
      preflightCompareSession({
        platformDisabled: false,
        maxLegs: 4,
        maxAggregateMicroUsd: 1_000,
        legs,
      }),
    ).toEqual({
      outcome: "accepted",
      estimatedMicroUsd: 250,
      legIds: ["leg_a", "leg_b"],
    });
    expect(
      preflightCompareSession({
        platformDisabled: false,
        maxLegs: 4,
        maxAggregateMicroUsd: 1_000,
        legs: [{ ...legs[1]!, authorized: false }],
      }),
    ).toEqual({
      outcome: "denied",
      code: "compare_preflight_failed",
      failedLegIds: ["leg_b"],
    });
    expect(
      recordCompareLegOutcome({
        completedLegIds: ["leg_a"],
        failedLegId: "leg_b",
      }),
    ).toEqual({
      completedLegIds: ["leg_a"],
      failedLegIds: ["leg_b"],
      partial: true,
    });
    expect(
      compareIdempotencyFingerprint({
        orgId: "org_default",
        workspaceId: "workspace_default",
        modelIds: ["model_b", "model_a"],
        promptHash: "abc",
      }),
    ).toBe("org_default:workspace_default:model_a,model_b:abc");
  });
});
