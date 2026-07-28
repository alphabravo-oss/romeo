import { describe, expect, it } from "vitest";

import {
  type BillingPlanSnapshot,
  buildApplyPayload,
  buildPlanDefaults,
} from "./billing-plan-payload";

const plan: BillingPlanSnapshot = {
  code: "enterprise",
  name: "Enterprise",
  status: "active",
  source: "external",
  quotaTemplates: [
    { metric: "run.started", limit: 100, resetInterval: "daily" },
    { metric: "tool.call", limit: 1_000, resetInterval: "monthly" },
    { metric: "storage.byte", limit: 10_000, resetInterval: "none" },
  ],
  metadata: {
    billingLifecycleCancelAt: "2026-08-31T00:00:00.000Z",
    billingLifecycleCurrentPeriodEndsAt: "2026-08-31T00:00:00.000Z",
  },
  externalCustomerId: "cus_123",
  externalSubscriptionId: "sub_123",
};

describe("buildPlanDefaults", () => {
  it("uses empty values for a new plan and never invents pro defaults", () => {
    expect(buildPlanDefaults(null)).toEqual({
      code: "",
      name: "",
      status: "active",
      quotaTemplates: [],
    });
  });

  it("round-trips the editable fields from the server plan", () => {
    expect(buildPlanDefaults(plan)).toEqual({
      code: plan.code,
      name: plan.name,
      status: plan.status,
      quotaTemplates: plan.quotaTemplates,
    });
  });
});

describe("buildApplyPayload", () => {
  it("preserves external linkage, lifecycle metadata, and source", () => {
    const payload = buildApplyPayload(plan, { status: "past_due" });

    expect(payload.status).toBe("past_due");
    expect(payload.externalCustomerId).toBe("cus_123");
    expect(payload.externalSubscriptionId).toBe("sub_123");
    expect(payload.metadata).toEqual(plan.metadata);
    expect(payload.source).toBe("external");
  });

  it("preserves every submitted quota tier", () => {
    const payload = buildApplyPayload(plan, {
      quotaTemplates: plan.quotaTemplates,
    });

    expect(payload.quotaTemplates).toHaveLength(3);
    expect(payload.quotaTemplates).toEqual(plan.quotaTemplates);
  });
});
