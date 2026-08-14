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
import type { DelegatedOAuthConnectionSummary } from "./types";
import {
  revokeDelegatedOAuthConnectionMutationOptions,
  startDelegatedOAuthMutationOptions,
} from "./mutation-options";

const mutationMocks = vi.hoisted(() => ({
  revokeDelegatedOAuthConnection: vi.fn(),
  startDelegatedOAuth: vi.fn(),
}));

vi.mock("./mutations", () => mutationMocks);

const connection = (
  status: DelegatedOAuthConnectionSummary["status"],
): DelegatedOAuthConnectionSummary => ({
  connectorType: "github",
  createdAt: "2026-08-14T00:00:00.000Z",
  id: "connection-1",
  providerAccountHash: "account-hash",
  providerAccountLoginConfigured: false,
  providerId: "github",
  scopes: ["repo"],
  status,
  updatedAt: "2026-08-14T00:00:00.000Z",
  userId: "user-1",
  workspaceId: "workspace-1",
});

describe("delegated OAuth mutation policies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeMutationNetworkRevalidation();
    advanceMutationSessionBoundary();
  });

  it("expires sensitive authorization results immediately after reset", async () => {
    const client = createRomeoQueryClient();
    const auditKey = appQueryKeys.auditLogs({ limit: 25 });
    client.setQueryData(auditKey, []);
    mutationMocks.startDelegatedOAuth.mockResolvedValueOnce({
      authorizationUrl: "https://auth.example/authorize?state=SECRET_STATE",
      connectorType: "github",
      expiresAt: "2026-08-14T00:05:00.000Z",
      provider: {},
      scopes: ["repo"],
      workspaceId: "workspace-1",
    });
    const observer = new MutationObserver(
      client,
      startDelegatedOAuthMutationOptions(),
    );

    await observer.mutate({
      connectorType: "github",
      providerId: "github",
      workspaceId: "workspace-1",
    });

    expect(client.getQueryState(auditKey)?.isInvalidated).toBe(true);
    expect(JSON.stringify(client.getQueryCache().getAll())).not.toContain(
      "SECRET_STATE",
    );
    observer.reset();
    await vi.waitFor(() =>
      expect(client.getMutationCache().getAll()).toHaveLength(0),
    );
  });

  it("rejects an authorization URL returned after the session changes", async () => {
    const client = createRomeoQueryClient();
    let resolveStart!: (value: {
      authorizationUrl: string;
      connectorType: "github";
      workspaceId: string;
    }) => void;
    mutationMocks.startDelegatedOAuth.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveStart = resolve;
      }),
    );
    const observer = new MutationObserver(
      client,
      startDelegatedOAuthMutationOptions(),
    );
    const pending = observer.mutate({
      connectorType: "github",
      providerId: "github",
      workspaceId: "workspace-1",
    });
    await vi.waitFor(() =>
      expect(mutationMocks.startDelegatedOAuth).toHaveBeenCalled(),
    );

    await clearRouteDataForLogout(client);
    resolveStart({
      authorizationUrl: "https://auth.example/authorize?state=LATE_STATE",
      connectorType: "github",
      workspaceId: "workspace-1",
    });

    await expect(pending).rejects.toThrow("authentication session changed");
  });

  it("reconciles revocation across scoped views and dependent posture", async () => {
    const client = createRomeoQueryClient();
    const affected = [
      appQueryKeys.delegatedOAuthConnections("workspace-1"),
      appQueryKeys.delegatedOAuthConnections(null),
      appQueryKeys.delegatedOAuthPosture(),
      appQueryKeys.dataConnectorCatalog(),
      appQueryKeys.dataConnectors("workspace-1"),
      appQueryKeys.dataConnectors("workspace-2"),
      appQueryKeys.auditLogs({ limit: 25 }),
    ];
    for (const key of affected)
      client.setQueryData(key, [connection("active")]);
    mutationMocks.revokeDelegatedOAuthConnection.mockResolvedValueOnce(
      connection("revoked"),
    );
    const observer = new MutationObserver(
      client,
      revokeDelegatedOAuthConnectionMutationOptions(),
    );

    await observer.mutate("connection-1");

    expect(
      client.getQueryData<DelegatedOAuthConnectionSummary[]>(affected[0]!)?.[0]
        ?.status,
    ).toBe("revoked");
    expect(
      client.getQueryData<DelegatedOAuthConnectionSummary[]>(affected[1]!)?.[0]
        ?.status,
    ).toBe("revoked");
    for (const key of affected) {
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });

  it("leaves connections unchanged after a provider conflict", async () => {
    const client = createRomeoQueryClient();
    const key = appQueryKeys.delegatedOAuthConnections("workspace-1");
    client.setQueryData(key, [connection("active")]);
    mutationMocks.revokeDelegatedOAuthConnection.mockRejectedValueOnce(
      new Error("provider_conflict"),
    );
    const observer = new MutationObserver(
      client,
      revokeDelegatedOAuthConnectionMutationOptions(),
    );

    await expect(observer.mutate("connection-1")).rejects.toThrow(
      "provider_conflict",
    );
    expect(client.getQueryData(key)).toEqual([connection("active")]);
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  });

  it("executes no authorization start while offline", async () => {
    const client = createRomeoQueryClient();
    const observer = new MutationObserver(
      client,
      startDelegatedOAuthMutationOptions(),
    );
    markMutationNetworkOffline();

    await expect(
      observer.mutate({
        connectorType: "github",
        providerId: "github",
        workspaceId: "workspace-1",
      }),
    ).rejects.toMatchObject({ code: "mutation_network_blocked" });
    expect(mutationMocks.startDelegatedOAuth).not.toHaveBeenCalled();
  });
});
