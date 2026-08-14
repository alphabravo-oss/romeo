import { describe, expect, it } from "vitest";

import { getCapabilityDefinition } from "./capability-definition-registry";
import {
  applyPolicyBundleApproval,
  evaluatePolicyBundlePublication,
  publicationClassForCapability,
  publishApprovedPolicyBundle,
  type PolicyBundle,
} from "./policy-bundle";

describe("policy bundle dual approval", () => {
  it("publishes low-risk changes and requires a distinct approver for high-risk weakening", () => {
    const image = getCapabilityDefinition("image_generation")!;
    expect(
      publicationClassForCapability(image, "unset", "enabled"),
    ).toBeUndefined();
    expect(
      evaluatePolicyBundlePublication({
        changes: [
          {
            capabilityId: "image_generation",
            currentState: "unset",
            nextState: "enabled",
          },
        ],
      }),
    ).toEqual({ outcome: "publish" });

    const compute = publicationClassForCapability(
      { id: "secure_compute", risk: "critical" },
      "disabled",
      "enabled",
    );
    expect(compute).toBe("compute");
    expect(
      evaluatePolicyBundlePublication({
        changes: [
          {
            capabilityId: "secure_compute",
            currentState: "disabled",
            nextState: "enabled",
            publicationClass: compute,
          },
        ],
      }),
    ).toEqual({ outcome: "approval_required", classes: ["compute"] });

    const pending = bundle();
    expect(
      applyPolicyBundleApproval({
        bundle: pending,
        actorId: pending.proposerId,
        now: "2026-08-14T11:00:00.000Z",
      }),
    ).toEqual({
      outcome: "rejected",
      code: "policy_bundle_self_approval_forbidden",
    });
    const approved = applyPolicyBundleApproval({
      bundle: pending,
      actorId: "user_security",
      now: "2026-08-14T11:00:00.000Z",
    });
    expect(approved).toMatchObject({
      state: "approved",
      approverId: "user_security",
    });
    expect(
      publishApprovedPolicyBundle({
        bundle: approved as PolicyBundle,
        now: "2026-08-14T11:01:00.000Z",
      }),
    ).toMatchObject({ state: "published" });
    expect(
      publishApprovedPolicyBundle({
        bundle: pending,
        now: "2026-08-14T11:01:00.000Z",
      }),
    ).toEqual({ outcome: "rejected", code: "policy_bundle_not_approved" });
  });
});

function bundle(): PolicyBundle {
  return {
    id: "policy_bundle_1",
    orgId: "org_default",
    state: "pending_approval",
    proposerId: "user_admin",
    reason: "Enable isolated compute",
    changes: [
      {
        capabilityId: "secure_compute",
        currentState: "disabled",
        nextState: "enabled",
        publicationClass: "compute",
      },
    ],
    createdAt: "2026-08-14T10:00:00.000Z",
    updatedAt: "2026-08-14T10:00:00.000Z",
  };
}
