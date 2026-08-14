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
import type { User, UserPage } from "./types";
import {
  disableUserMutationOptions,
  setUserPasswordMutationOptions,
  updateUserRoleMutationOptions,
} from "./user-mutation-options";

const mutationMocks = vi.hoisted(() => ({
  disableUser: vi.fn(),
  setUserPassword: vi.fn(),
  updateUserRole: vi.fn(),
}));

vi.mock("./mutations", () => mutationMocks);

const user = (id: string, role: User["role"] = "user"): User => ({
  email: `${id}@example.com`,
  id,
  name: id,
  orgId: "org-1",
  role,
});

const page = (data: User[]): UserPage => ({
  data,
  meta: {
    activeGlobalAdminTotal: 1,
    adminTotal: 1,
    disabledTotal: 0,
    hasMore: false,
    limit: 50,
    offset: 0,
    total: 2,
    userTotal: 2,
  },
});

const firstPageKey = appQueryKeys.users({
  direction: "asc",
  page: 0,
  query: "",
  sort: "name",
});
const filteredPageKey = appQueryKeys.users({
  direction: "desc",
  page: 1,
  query: "admin",
  sort: "role",
});

describe("user administration mutation policies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeMutationNetworkRevalidation();
    advanceMutationSessionBoundary();
  });

  it("updates and exactly invalidates every cached page after disable", async () => {
    const client = createRomeoQueryClient();
    const admin = user("admin-1", "global_admin");
    client.setQueryData(firstPageKey, page([admin]));
    client.setQueryData(filteredPageKey, page([user("user-2")]));
    const disabled = {
      ...admin,
      disabledAt: "2026-08-14T00:00:00.000Z",
    };
    mutationMocks.disableUser.mockResolvedValueOnce(disabled);
    const observer = new MutationObserver(client, disableUserMutationOptions());

    await observer.mutate(admin.id);

    expect(client.getQueryData<UserPage>(firstPageKey)?.data[0]).toEqual(
      disabled,
    );
    for (const queryKey of [firstPageKey, filteredPageKey]) {
      const cached = client.getQueryData<UserPage>(queryKey);
      expect(cached?.meta.activeGlobalAdminTotal).toBe(0);
      expect(cached?.meta.disabledTotal).toBe(1);
      expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
    }
  });

  it("restores every page and aggregate after a role conflict", async () => {
    const client = createRomeoQueryClient();
    const admin = user("admin-1", "global_admin");
    const first = page([admin]);
    const filtered = page([user("user-2")]);
    client.setQueryData(firstPageKey, first);
    client.setQueryData(filteredPageKey, filtered);
    mutationMocks.updateUserRole.mockRejectedValueOnce(
      new Error("version_conflict"),
    );
    const observer = new MutationObserver(
      client,
      updateUserRoleMutationOptions(),
    );

    await expect(
      observer.mutate({ role: "user", userId: admin.id }),
    ).rejects.toThrow("version_conflict");
    expect(client.getQueryData(firstPageKey)).toEqual(first);
    expect(client.getQueryData(filteredPageKey)).toEqual(filtered);
  });

  it("rolls disable back after authorization failure", async () => {
    const client = createRomeoQueryClient();
    const current = user("user-1");
    client.setQueryData(firstPageKey, page([current]));
    mutationMocks.disableUser.mockRejectedValueOnce(new Error("forbidden"));
    const observer = new MutationObserver(client, disableUserMutationOptions());

    await expect(observer.mutate(current.id)).rejects.toThrow("forbidden");
    expect(client.getQueryData<UserPage>(firstPageKey)?.data).toEqual([
      current,
    ]);
    expect(client.getQueryState(firstPageKey)?.isInvalidated).toBe(false);
  });

  it("executes no durable user write while offline", async () => {
    const client = createRomeoQueryClient();
    markMutationNetworkOffline();
    const observer = new MutationObserver(
      client,
      updateUserRoleMutationOptions(),
    );

    await expect(
      observer.mutate({ role: "org_admin", userId: "user-1" }),
    ).rejects.toThrow(
      "Changes are unavailable until the secure connection is ready.",
    );
    expect(mutationMocks.updateUserRole).not.toHaveBeenCalled();
  });

  it("cannot reconcile a late role response after logout", async () => {
    const client = createRomeoQueryClient();
    const current = user("user-1");
    client.setQueryData(firstPageKey, page([current]));
    let resolveUpdate: ((value: User) => void) | undefined;
    mutationMocks.updateUserRole.mockImplementationOnce(
      () =>
        new Promise<User>((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    const observer = new MutationObserver(
      client,
      updateUserRoleMutationOptions(),
    );
    const pending = observer.mutate({
      role: "org_admin",
      userId: current.id,
    });
    await vi.waitFor(() => expect(resolveUpdate).toBeDefined());

    await clearRouteDataForLogout(client);
    resolveUpdate?.({ ...current, role: "org_admin" });
    await pending;

    expect(client.getQueryData(firstPageKey)).toBeUndefined();
  });

  it("drops plaintext password mutation state and rejects a late response", async () => {
    const client = createRomeoQueryClient();
    let resolvePassword: (() => void) | undefined;
    mutationMocks.setUserPassword.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolvePassword = resolve;
        }),
    );
    const observer = new MutationObserver(
      client,
      setUserPasswordMutationOptions(),
    );
    const pending = observer.mutate({
      newPassword: "UNIQUE_PLAINTEXT_PASSWORD",
      userId: "user-1",
    });
    await vi.waitFor(() => expect(resolvePassword).toBeDefined());

    await clearRouteDataForLogout(client);
    resolvePassword?.();
    await expect(pending).rejects.toThrow(
      "The authentication session changed.",
    );
    observer.reset();

    expect(JSON.stringify(client.getQueryCache().getAll())).not.toContain(
      "UNIQUE_PLAINTEXT_PASSWORD",
    );
    expect(JSON.stringify(client.getMutationCache().getAll())).not.toContain(
      "UNIQUE_PLAINTEXT_PASSWORD",
    );
  });
});
