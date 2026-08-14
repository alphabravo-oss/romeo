import type {
  CreatedDeviceAuthorization,
  DeviceAuthorization,
} from "@romeo/api-client/generated/sdk";
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
  createDeviceAuthorizationMutationOptions,
  revokeDeviceAuthorizationMutationOptions,
} from "./mutation-options";

const mutationMocks = vi.hoisted(() => ({
  createDeviceAuthorization: vi.fn(),
  revokeDeviceAuthorization: vi.fn(),
}));

vi.mock("./mutations", () => mutationMocks);

const authorization = (id = "device-1"): DeviceAuthorization => ({
  accessApiKeyId: "api-key-1",
  createdAt: "2026-08-14T00:00:00.000Z",
  expiresAt: "2026-11-12T00:00:00.000Z",
  id,
  name: "CLI",
  orgId: "org-1",
  scopes: ["me:read"],
  updatedAt: "2026-08-14T00:00:00.000Z",
  userId: "user-1",
});

const createdAuthorization = (id = "device-1"): CreatedDeviceAuthorization => ({
  accessToken: `access-secret-${id}`,
  authorization: authorization(id),
  refreshToken: `refresh-secret-${id}`,
});

describe("device authorization mutation policies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeMutationNetworkRevalidation();
    advanceMutationSessionBoundary();
  });

  it("reconciles only public metadata and removes ephemeral secret state", async () => {
    const client = createRomeoQueryClient();
    const queryKey = appQueryKeys.deviceAuthorizations();
    const created = createdAuthorization();
    client.setQueryData(queryKey, []);
    mutationMocks.createDeviceAuthorization.mockResolvedValueOnce(created);
    const observer = new MutationObserver(
      client,
      createDeviceAuthorizationMutationOptions(),
    );

    const result = await observer.mutate({
      name: "CLI",
      scopes: ["me:read"],
      ttlDays: 90,
    });

    expect(result).toEqual(created);
    expect(client.getQueryData(queryKey)).toEqual([created.authorization]);
    expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
    expect(JSON.stringify(client.getQueryCache().getAll())).not.toContain(
      created.accessToken,
    );
    expect(JSON.stringify(client.getQueryCache().getAll())).not.toContain(
      created.refreshToken,
    );

    observer.reset();
    await vi.waitFor(() =>
      expect(client.getMutationCache().getAll()).toHaveLength(0),
    );
  });

  it("rolls an optimistic revoke back on conflict", async () => {
    const client = createRomeoQueryClient();
    const queryKey = appQueryKeys.deviceAuthorizations();
    const current = authorization();
    client.setQueryData(queryKey, [current]);
    mutationMocks.revokeDeviceAuthorization.mockRejectedValueOnce(
      new Error("version_conflict"),
    );
    const observer = new MutationObserver(
      client,
      revokeDeviceAuthorizationMutationOptions(),
    );

    await expect(observer.mutate(current.id)).rejects.toThrow(
      "version_conflict",
    );
    expect(client.getQueryData(queryKey)).toEqual([current]);
    expect(client.getQueryState(queryKey)?.isInvalidated).toBe(false);
  });

  it("leaves public metadata unchanged after authorization failure", async () => {
    const client = createRomeoQueryClient();
    const queryKey = appQueryKeys.deviceAuthorizations();
    const current = authorization();
    client.setQueryData(queryKey, [current]);
    mutationMocks.createDeviceAuthorization.mockRejectedValueOnce(
      new Error("forbidden"),
    );
    const observer = new MutationObserver(
      client,
      createDeviceAuthorizationMutationOptions(),
    );

    await expect(
      observer.mutate({ name: "CLI", scopes: ["me:read"] }),
    ).rejects.toThrow("forbidden");
    expect(client.getQueryData(queryKey)).toEqual([current]);
    expect(client.getQueryState(queryKey)?.isInvalidated).toBe(false);
  });

  it("executes no credential write while offline", async () => {
    const client = createRomeoQueryClient();
    markMutationNetworkOffline();
    const observer = new MutationObserver(
      client,
      createDeviceAuthorizationMutationOptions(),
    );

    await expect(
      observer.mutate({ name: "CLI", scopes: ["me:read"] }),
    ).rejects.toThrow(
      "Changes are unavailable until the secure connection is ready.",
    );
    expect(mutationMocks.createDeviceAuthorization).not.toHaveBeenCalled();
  });

  it("cannot commit a late credential response after logout", async () => {
    const client = createRomeoQueryClient();
    const queryKey = appQueryKeys.deviceAuthorizations();
    client.setQueryData(queryKey, []);
    let resolveCreate:
      | ((value: CreatedDeviceAuthorization) => void)
      | undefined;
    mutationMocks.createDeviceAuthorization.mockImplementationOnce(
      () =>
        new Promise<CreatedDeviceAuthorization>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const observer = new MutationObserver(
      client,
      createDeviceAuthorizationMutationOptions(),
    );
    const pending = observer.mutate({ name: "CLI", scopes: ["me:read"] });
    await vi.waitFor(() => expect(resolveCreate).toBeDefined());

    await clearRouteDataForLogout(client);
    resolveCreate?.(createdAuthorization("late"));
    await expect(pending).rejects.toThrow(
      "The authentication session changed.",
    );

    expect(client.getQueryData(queryKey)).toBeUndefined();
    expect(JSON.stringify(client.getQueryCache().getAll())).not.toContain(
      "secret-late",
    );
    expect(JSON.stringify(client.getMutationCache().getAll())).not.toContain(
      "secret-late",
    );
  });
});
