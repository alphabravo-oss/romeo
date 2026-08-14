import type {
  ApiKeySummary,
  CreatedApiKey,
  ServiceAccount,
} from "@romeo/api-client/generated/sdk";
import { MutationObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as appQueryKeys from "../../lib/app-query-keys";
import { completeMutationNetworkRevalidation } from "../../lib/connectivity";
import { advanceMutationSessionBoundary } from "../../lib/mutation-session-boundary";
import { createRomeoQueryClient } from "../../lib/query-client";
import { clearRouteDataForLogout } from "../../lib/route-intent";
import {
  bulkDisableServiceAccountsMutationOptions,
  bulkRevokeApiKeysMutationOptions,
  createApiKeyMutationOptions,
  disableServiceAccountMutationOptions,
  revokeApiKeyMutationOptions,
} from "./mutation-options";

const mutationMocks = vi.hoisted(() => ({
  bulkDisableServiceAccounts: vi.fn(),
  bulkRevokeApiKeys: vi.fn(),
  createApiKey: vi.fn(),
  createServiceAccount: vi.fn(),
  createServiceAccountApiKey: vi.fn(),
  disableServiceAccount: vi.fn(),
  revokeApiKey: vi.fn(),
}));

vi.mock("./mutations", () => mutationMocks);

const apiKey = (id: string): ApiKeySummary => ({
  createdAt: "2026-01-01T00:00:00.000Z",
  id,
  name: id,
  orgId: "org-1",
  scopes: ["me:read"],
  userId: "user-1",
});

const serviceAccount = (id: string): ServiceAccount => ({
  createdAt: "2026-01-01T00:00:00.000Z",
  createdBy: "user-1",
  id,
  name: id,
  orgId: "org-1",
  scopes: ["me:read"],
});

describe("administration mutation policies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeMutationNetworkRevalidation();
    advanceMutationSessionBoundary();
  });

  it("rolls an API-key optimistic revoke back on a version conflict", async () => {
    const client = createRomeoQueryClient();
    const before = apiKey("key-1");
    client.setQueryData(appQueryKeys.apiKeys(), [before]);
    mutationMocks.revokeApiKey.mockRejectedValueOnce(
      new Error("version_conflict"),
    );
    const observer = new MutationObserver(
      client,
      revokeApiKeyMutationOptions(),
    );

    await expect(observer.mutate(before.id)).rejects.toThrow(
      "version_conflict",
    );
    expect(client.getQueryData(appQueryKeys.apiKeys())).toEqual([before]);
  });

  it("reconciles partial bulk results without retaining failed optimistic revokes", async () => {
    const client = createRomeoQueryClient();
    client.setQueryData(appQueryKeys.apiKeys(), [
      apiKey("key-success"),
      apiKey("key-failure"),
    ]);
    mutationMocks.bulkRevokeApiKeys.mockResolvedValueOnce({
      results: [
        { id: "key-success", status: "success" },
        { id: "key-failure", status: "failure", error: "forbidden" },
      ],
    });
    const observer = new MutationObserver(
      client,
      bulkRevokeApiKeysMutationOptions(),
    );

    await observer.mutate(["key-success", "key-failure"]);
    const cached = client.getQueryData<ApiKeySummary[]>(appQueryKeys.apiKeys());
    expect(
      cached?.find((item) => item.id === "key-success")?.revokedAt,
    ).toBeDefined();
    expect(cached?.find((item) => item.id === "key-failure")?.revokedAt).toBe(
      undefined,
    );
    expect(client.getQueryState(appQueryKeys.apiKeys())?.isInvalidated).toBe(
      true,
    );
  });

  it("never writes a one-time API token into query cache", async () => {
    const client = createRomeoQueryClient();
    client.setQueryData(appQueryKeys.apiKeys(), []);
    const created: CreatedApiKey = {
      apiKey: apiKey("key-created"),
      token: "romeo-secret-token",
    };
    mutationMocks.createApiKey.mockResolvedValueOnce(created);
    const observer = new MutationObserver(
      client,
      createApiKeyMutationOptions(),
    );

    await observer.mutate({ name: "key-created", scopes: ["me:read"] });
    expect(client.getQueryData(appQueryKeys.apiKeys())).toEqual([
      created.apiKey,
    ]);
    expect(JSON.stringify(client.getQueryCache().getAll())).not.toContain(
      created.token,
    );
  });

  it("does not cache a credential response that completes after logout", async () => {
    const client = createRomeoQueryClient();
    client.setQueryData(appQueryKeys.apiKeys(), []);
    let resolveCreate!: (value: CreatedApiKey) => void;
    mutationMocks.createApiKey.mockReturnValueOnce(
      new Promise<CreatedApiKey>((resolve) => {
        resolveCreate = resolve;
      }),
    );
    const observer = new MutationObserver(
      client,
      createApiKeyMutationOptions(),
    );
    const mutation = observer.mutate({ name: "late", scopes: ["me:read"] });
    await vi.waitFor(() =>
      expect(mutationMocks.createApiKey).toHaveBeenCalled(),
    );

    await clearRouteDataForLogout(client);
    resolveCreate({ apiKey: apiKey("late"), token: "late-secret-token" });
    await mutation;

    expect(client.getQueryData(appQueryKeys.apiKeys())).toBeUndefined();
    expect(JSON.stringify(client.getQueryCache().getAll())).not.toContain(
      "late-secret-token",
    );
  });

  it("rolls service-account disable back after authorization failure", async () => {
    const client = createRomeoQueryClient();
    const before = serviceAccount("service-1");
    client.setQueryData(appQueryKeys.serviceAccounts(), [before]);
    mutationMocks.disableServiceAccount.mockRejectedValueOnce(
      new Error("unauthorized"),
    );
    const observer = new MutationObserver(
      client,
      disableServiceAccountMutationOptions(),
    );

    await expect(observer.mutate(before.id)).rejects.toThrow("unauthorized");
    expect(client.getQueryData(appQueryKeys.serviceAccounts())).toEqual([
      before,
    ]);
  });

  it("restores failed members of a partial bulk service-account disable", async () => {
    const client = createRomeoQueryClient();
    client.setQueryData(appQueryKeys.serviceAccounts(), [
      serviceAccount("service-success"),
      serviceAccount("service-failure"),
    ]);
    mutationMocks.bulkDisableServiceAccounts.mockResolvedValueOnce({
      results: [
        { id: "service-success", status: "success" },
        { id: "service-failure", status: "failure" },
      ],
    });
    const observer = new MutationObserver(
      client,
      bulkDisableServiceAccountsMutationOptions(),
    );

    await observer.mutate(["service-success", "service-failure"]);
    const cached = client.getQueryData<ServiceAccount[]>(
      appQueryKeys.serviceAccounts(),
    );
    expect(
      cached?.find((item) => item.id === "service-success")?.disabledAt,
    ).toBeDefined();
    expect(
      cached?.find((item) => item.id === "service-failure")?.disabledAt,
    ).toBeUndefined();
  });
});
