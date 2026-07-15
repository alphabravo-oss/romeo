import { describe, expect, it } from "vitest";

import {
  toBillingPlanRecord,
  toQuotaBucketRecord,
  toRetentionPolicyRecord,
} from "./governance-billing-repository";

describe("governance and billing repository mappers", () => {
  it("maps retention policies with stable timestamps", () => {
    const policy = toRetentionPolicyRecord({
      orgId: "org_1",
      auditLogRetentionDays: 365,
      updatedBy: "user_1",
      updatedAt: new Date("2026-06-27T00:00:00.000Z"),
    });

    expect(policy).toEqual({
      orgId: "org_1",
      auditLogRetentionDays: 365,
      updatedBy: "user_1",
      updatedAt: "2026-06-27T00:00:00.000Z",
    });
  });

  it("maps quota buckets and normalizes unsupported metrics", () => {
    const bucket = toQuotaBucketRecord({
      id: "quota_1",
      orgId: "org_1",
      scopeType: "org",
      scopeId: "org_1",
      metric: "unknown",
      limit: 100,
      used: 50,
      resetInterval: "weekly",
      resetAt: null,
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
      updatedAt: new Date("2026-06-27T00:05:00.000Z"),
    });

    expect(bucket).toEqual({
      id: "quota_1",
      orgId: "org_1",
      scopeType: "org",
      scopeId: "org_1",
      metric: "run.started",
      limit: 100,
      used: 50,
      resetInterval: "none",
      createdAt: "2026-06-27T00:00:00.000Z",
      updatedAt: "2026-06-27T00:05:00.000Z",
    });
  });

  it("maps billing plans and filters invalid quota templates", () => {
    const plan = toBillingPlanRecord({
      id: "plan_1",
      orgId: "org_1",
      code: "enterprise",
      name: "Enterprise",
      status: "unknown",
      source: "unknown",
      quotaTemplates: [
        { metric: "tool.call", limit: 500, resetInterval: "daily" },
        { metric: "bad", limit: 10.8, resetInterval: "weekly" },
        { metric: "run.started", resetInterval: "monthly" },
      ],
      metadata: [],
      externalCustomerId: "cus_1",
      externalSubscriptionId: null,
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
      updatedAt: new Date("2026-06-27T00:05:00.000Z"),
    });

    expect(plan).toMatchObject({
      id: "plan_1",
      status: "past_due",
      source: "manual",
      quotaTemplates: [
        { metric: "tool.call", limit: 500, resetInterval: "daily" },
        { metric: "run.started", limit: 10, resetInterval: "none" },
      ],
      metadata: {},
      externalCustomerId: "cus_1",
    });
    expect(plan.externalSubscriptionId).toBeUndefined();
  });
});
