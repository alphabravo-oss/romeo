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
  simulateAbuseControlsMutationOptions,
  updateAbuseControlsMutationOptions,
} from "./mutation-options";
import type {
  AbuseControlPolicyReport,
  AbuseControlSimulationResult,
} from "./types";

const mutationMocks = vi.hoisted(() => ({
  simulateAbuseControls: vi.fn(),
  updateAbuseControls: vi.fn(),
}));

vi.mock("./mutations", () => mutationMocks);

function policy(
  overrides: Partial<AbuseControlPolicyReport> = {},
): AbuseControlPolicyReport {
  return {
    entitlements: {
      allowedBillingStatuses: ["active", "trialing"],
      denyWhenBillingPlanMissing: true,
      enforceBillingStatus: true,
    },
    enforcement: {
      activeKillSwitchCount: 0,
      billingPlanConfigured: true,
      costWorkBlocked: false,
      defaultBlockReasons: [],
    },
    generatedAt: "2026-08-14T00:00:00.000Z",
    killSwitches: {
      connectorIds: [],
      providerIds: [],
      toolIds: [],
      workerClasses: [],
    },
    orgId: "org-1",
    source: "org",
    suspension: { suspended: false },
    ...overrides,
  };
}

describe("abuse-control mutation policies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeMutationNetworkRevalidation();
    advanceMutationSessionBoundary();
  });

  it("optimistically updates and reconciles the normalized policy exactly", async () => {
    const client = createRomeoQueryClient();
    const queryKey = appQueryKeys.abuseControls();
    client.setQueryData(queryKey, policy());
    const normalized = policy({
      killSwitches: {
        connectorIds: [],
        providerIds: ["provider-a", "provider-b"],
        toolIds: [],
        workerClasses: [],
      },
      updatedAt: "2026-08-14T01:00:00.000Z",
      updatedBy: "admin-1",
    });
    mutationMocks.updateAbuseControls.mockResolvedValueOnce(normalized);
    const observer = new MutationObserver(
      client,
      updateAbuseControlsMutationOptions(),
    );

    await observer.mutate({
      killSwitches: { providerIds: ["provider-b", "provider-a"] },
    });

    expect(client.getQueryData(queryKey)).toEqual(normalized);
    expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
  });

  it("rolls a suspension change back after conflict or authorization failure", async () => {
    const client = createRomeoQueryClient();
    const queryKey = appQueryKeys.abuseControls();
    const existing = policy();
    const observer = new MutationObserver(
      client,
      updateAbuseControlsMutationOptions(),
    );

    for (const error of ["version_conflict", "forbidden"]) {
      client.setQueryData(queryKey, existing);
      mutationMocks.updateAbuseControls.mockRejectedValueOnce(new Error(error));
      await expect(
        observer.mutate({
          suspension: { reasonCode: "security_review", suspended: true },
        }),
      ).rejects.toThrow(error);
      expect(client.getQueryData(queryKey)).toEqual(existing);
      expect(client.getQueryState(queryKey)?.isInvalidated).toBe(false);
    }
  });

  it("executes no policy update while offline", async () => {
    const client = createRomeoQueryClient();
    markMutationNetworkOffline();
    const observer = new MutationObserver(
      client,
      updateAbuseControlsMutationOptions(),
    );

    await expect(
      observer.mutate({ suspension: { suspended: true } }),
    ).rejects.toThrow(
      "Changes are unavailable until the secure connection is ready.",
    );
    expect(mutationMocks.updateAbuseControls).not.toHaveBeenCalled();
  });

  it("rejects a late policy response after logout", async () => {
    const client = createRomeoQueryClient();
    const queryKey = appQueryKeys.abuseControls();
    client.setQueryData(queryKey, policy());
    let resolveUpdate: ((value: AbuseControlPolicyReport) => void) | undefined;
    mutationMocks.updateAbuseControls.mockImplementationOnce(
      () =>
        new Promise<AbuseControlPolicyReport>((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    const observer = new MutationObserver(
      client,
      updateAbuseControlsMutationOptions(),
    );
    const pending = observer.mutate({ suspension: { suspended: true } });
    await vi.waitFor(() => expect(resolveUpdate).toBeDefined());

    await clearRouteDataForLogout(client);
    resolveUpdate?.(policy({ suspension: { suspended: true } }));

    await expect(pending).rejects.toThrow(
      "The authentication session changed.",
    );
    expect(client.getQueryData(queryKey)).toBeUndefined();
  });

  it("keeps simulation results ephemeral and out of query state", async () => {
    const client = createRomeoQueryClient();
    const result: AbuseControlSimulationResult = {
      action: "tool.execute",
      allowed: false,
      evaluatedAt: "2026-08-14T01:00:00.000Z",
      policySource: "org",
      reasonCodes: ["tool_kill_switch"],
    };
    mutationMocks.simulateAbuseControls.mockResolvedValueOnce(result);
    const observer = new MutationObserver(
      client,
      simulateAbuseControlsMutationOptions(),
    );

    await expect(
      observer.mutate({ action: "tool.execute", toolId: "tool-1" }),
    ).resolves.toEqual(result);
    expect(client.getQueryCache().getAll()).toHaveLength(0);

    observer.reset();
    await vi.waitFor(() =>
      expect(client.getMutationCache().getAll()).toHaveLength(0),
    );
  });
});
