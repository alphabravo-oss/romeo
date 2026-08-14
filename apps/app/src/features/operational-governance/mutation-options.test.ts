import { MutationObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  completeMutationNetworkRevalidation,
  markMutationNetworkOffline,
} from "../../lib/connectivity";
import { advanceMutationSessionBoundary } from "../../lib/mutation-session-boundary";
import { createRomeoQueryClient } from "../../lib/query-client";
import { clearRouteDataForLogout } from "../../lib/route-intent";
import {
  createQuotaBucketMutationOptions,
  deleteQuotaBucketMutationOptions,
  updateQuotaBucketMutationOptions,
} from "./mutation-options";
import type { QuotaBucket } from "./types";

const mutationMocks = vi.hoisted(() => ({
  createQuotaBucket: vi.fn(),
  deleteQuotaBucket: vi.fn(),
  updateQuotaBucket: vi.fn(),
}));

vi.mock("./mutations", () => mutationMocks);

function quota(overrides: Partial<QuotaBucket> = {}): QuotaBucket {
  return {
    createdAt: "2026-08-14T00:00:00.000Z",
    id: "quota-1",
    limit: 100,
    metric: "tool.call",
    orgId: "org-1",
    resetInterval: "monthly",
    scopeId: "org-1",
    scopeType: "org",
    updatedAt: "2026-08-14T00:00:00.000Z",
    used: 25,
    ...overrides,
  };
}

describe("quota mutation policies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeMutationNetworkRevalidation();
    advanceMutationSessionBoundary();
  });

  it("reconciles creation and invalidates only exact quota projections", async () => {
    const client = createRomeoQueryClient();
    const quotasKey = appQueryKeys.quotas();
    const alertsKey = appQueryKeys.usageAlerts();
    const auditKey = appQueryKeys.auditLogs({ limit: 25 });
    const unrelated = appQueryKeys.usageSummary();
    for (const queryKey of [quotasKey, alertsKey, auditKey, unrelated]) {
      client.setQueryData(queryKey, []);
    }
    mutationMocks.createQuotaBucket.mockResolvedValueOnce(quota());
    const observer = new MutationObserver(
      client,
      createQuotaBucketMutationOptions(),
    );

    await observer.mutate({
      limit: 100,
      metric: "tool.call",
      scopeType: "org",
    });

    expect(client.getQueryData(quotasKey)).toEqual([quota()]);
    for (const queryKey of [quotasKey, alertsKey, auditKey]) {
      expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
    }
    expect(client.getQueryState(unrelated)?.isInvalidated).toBe(false);
  });

  it("reconciles deletion without affecting another cached resource", async () => {
    const client = createRomeoQueryClient();
    const quotasKey = appQueryKeys.quotas();
    const unrelated = appQueryKeys.billingPlan();
    const removed = quota();
    client.setQueryData(quotasKey, [removed, quota({ id: "quota-2" })]);
    client.setQueryData(unrelated, { code: "enterprise" });
    mutationMocks.deleteQuotaBucket.mockResolvedValueOnce(removed);
    const observer = new MutationObserver(
      client,
      deleteQuotaBucketMutationOptions(),
    );

    await observer.mutate("quota-1");

    expect(
      client.getQueryData<QuotaBucket[]>(quotasKey)?.map(({ id }) => id),
    ).toEqual(["quota-2"]);
    expect(client.getQueryState(quotasKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(unrelated)?.isInvalidated).toBe(false);
  });

  it("rolls an update back after conflict or authorization failure", async () => {
    const client = createRomeoQueryClient();
    const queryKey = appQueryKeys.quotas();
    const existing = quota();
    const observer = new MutationObserver(
      client,
      updateQuotaBucketMutationOptions(),
    );

    for (const error of ["version_conflict", "forbidden"]) {
      client.setQueryData(queryKey, [existing]);
      mutationMocks.updateQuotaBucket.mockRejectedValueOnce(new Error(error));
      await expect(
        observer.mutate({
          quotaBucketId: "quota-1",
          input: { limit: 10, resetUsage: true },
        }),
      ).rejects.toThrow(error);
      expect(client.getQueryData(queryKey)).toEqual([existing]);
      expect(client.getQueryState(queryKey)?.isInvalidated).toBe(false);
    }
  });

  it("executes no quota write while offline", async () => {
    const client = createRomeoQueryClient();
    markMutationNetworkOffline();
    const observer = new MutationObserver(
      client,
      createQuotaBucketMutationOptions(),
    );

    await expect(
      observer.mutate({ limit: 100, metric: "tool.call", scopeType: "org" }),
    ).rejects.toThrow(
      "Changes are unavailable until the secure connection is ready.",
    );
    expect(mutationMocks.createQuotaBucket).not.toHaveBeenCalled();
  });

  it("rejects a late quota response after logout", async () => {
    const client = createRomeoQueryClient();
    const queryKey = appQueryKeys.quotas();
    client.setQueryData(queryKey, []);
    let resolveCreate: ((value: QuotaBucket) => void) | undefined;
    mutationMocks.createQuotaBucket.mockImplementationOnce(
      () =>
        new Promise<QuotaBucket>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const observer = new MutationObserver(
      client,
      createQuotaBucketMutationOptions(),
    );
    const pending = observer.mutate({
      limit: 100,
      metric: "tool.call",
      scopeType: "org",
    });
    await vi.waitFor(() => expect(resolveCreate).toBeDefined());

    await clearRouteDataForLogout(client);
    resolveCreate?.(quota());

    await expect(pending).rejects.toThrow(
      "The authentication session changed.",
    );
    expect(client.getQueryData(queryKey)).toBeUndefined();
  });
});
