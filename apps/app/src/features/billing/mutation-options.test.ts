import { MutationObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as appQueryKeys from "../../lib/app-query-keys";
import { completeMutationNetworkRevalidation } from "../../lib/connectivity";
import { advanceMutationSessionBoundary } from "../../lib/mutation-session-boundary";
import { createRomeoQueryClient } from "../../lib/query-client";
import { clearRouteDataForLogout } from "../../lib/route-intent";
import type { BillingPlan } from "./types";
import {
  applyBillingPlanMutationOptions,
  reconcileBillingEntitlementsMutationOptions,
} from "./mutation-options";

const mutationMocks = vi.hoisted(() => ({
  applyBillingPlan: vi.fn(),
  enforceBillingLifecycle: vi.fn(),
  reconcileBillingEntitlements: vi.fn(),
  syncExternalBillingEvent: vi.fn(),
}));

vi.mock("./mutations", () => mutationMocks);

const plan = (name: string): BillingPlan => ({
  code: "enterprise",
  createdAt: "2026-08-14T00:00:00.000Z",
  id: "plan-1",
  metadata: {},
  name,
  orgId: "org-1",
  quotaTemplates: [],
  source: "manual",
  status: "active",
  updatedAt: "2026-08-14T00:00:00.000Z",
});

describe("billing mutation policies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeMutationNetworkRevalidation();
    advanceMutationSessionBoundary();
  });

  it("reconciles the plan and exactly invalidates all billing projections", async () => {
    const client = createRomeoQueryClient();
    const planKey = appQueryKeys.billingPlan();
    const quotaKey = appQueryKeys.quotas();
    const entitlementKey = appQueryKeys.billingEntitlements();
    const lifecycleKey = appQueryKeys.billingLifecycle();
    client.setQueryData(planKey, plan("Before"));
    client.setQueryData(quotaKey, []);
    client.setQueryData(entitlementKey, { status: "healthy" });
    client.setQueryData(lifecycleKey, { status: "healthy" });
    mutationMocks.applyBillingPlan.mockResolvedValueOnce({
      plan: plan("After"),
      quotas: [],
    });
    const observer = new MutationObserver(
      client,
      applyBillingPlanMutationOptions(),
    );

    await observer.mutate({
      code: "enterprise",
      name: "After",
      quotaTemplates: [],
    });

    expect(client.getQueryData<BillingPlan>(planKey)?.name).toBe("After");
    for (const key of [planKey, quotaKey, entitlementKey, lifecycleKey]) {
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });

  it("leaves the cached plan unchanged after a conflict", async () => {
    const client = createRomeoQueryClient();
    const key = appQueryKeys.billingPlan();
    client.setQueryData(key, plan("Before"));
    mutationMocks.applyBillingPlan.mockRejectedValueOnce(new Error("conflict"));
    const observer = new MutationObserver(
      client,
      applyBillingPlanMutationOptions(),
    );

    await expect(
      observer.mutate({
        code: "enterprise",
        name: "After",
        quotaTemplates: [],
      }),
    ).rejects.toThrow("conflict");
    expect(client.getQueryData(key)).toEqual(plan("Before"));
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  });

  it("does not reconcile a plan response after logout", async () => {
    const client = createRomeoQueryClient();
    let resolveApply!: (value: { plan: BillingPlan; quotas: [] }) => void;
    mutationMocks.applyBillingPlan.mockReturnValueOnce(
      new Promise<{ plan: BillingPlan; quotas: [] }>((resolve) => {
        resolveApply = resolve;
      }),
    );
    const observer = new MutationObserver(
      client,
      applyBillingPlanMutationOptions(),
    );
    const mutation = observer.mutate({
      code: "enterprise",
      name: "After",
      quotaTemplates: [],
    });
    await vi.waitFor(() =>
      expect(mutationMocks.applyBillingPlan).toHaveBeenCalled(),
    );

    await clearRouteDataForLogout(client);
    const key = appQueryKeys.billingPlan();
    client.setQueryData(key, plan("Next session"));
    resolveApply({ plan: plan("After"), quotas: [] });
    await mutation;

    expect(client.getQueryData(key)).toEqual(plan("Next session"));
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  });

  it("reconciles entitlement enforcement with the server after-state", async () => {
    const client = createRomeoQueryClient();
    const key = appQueryKeys.billingEntitlements();
    const after = { status: "healthy", warnings: [] };
    client.setQueryData(key, { status: "attention_required" });
    mutationMocks.reconcileBillingEntitlements.mockResolvedValueOnce({
      actions: {
        createdQuotaIds: [],
        unchangedQuotaIds: [],
        updatedQuotaIds: [],
      },
      after,
      before: { status: "attention_required" },
    });
    const observer = new MutationObserver(
      client,
      reconcileBillingEntitlementsMutationOptions(),
    );

    await observer.mutate();

    expect(client.getQueryData(key)).toEqual(after);
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  });
});
