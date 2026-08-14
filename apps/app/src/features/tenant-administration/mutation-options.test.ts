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
  createTenantOrganizationMutationOptions,
  reactivateTenantOrganizationMutationOptions,
  suspendTenantOrganizationMutationOptions,
  updateTenantOrganizationMutationOptions,
} from "./mutation-options";
import type {
  TenantOrganizationSummary,
  TenantProvisioningResult,
} from "./types";

const mutationMocks = vi.hoisted(() => ({
  createTenantOrganization: vi.fn(),
  reactivateTenantOrganization: vi.fn(),
  suspendTenantOrganization: vi.fn(),
  updateTenantOrganization: vi.fn(),
}));

vi.mock("./mutations", () => mutationMocks);

function organization(
  overrides: Partial<TenantOrganizationSummary> = {},
): TenantOrganizationSummary {
  return {
    organization: { id: "org-1", name: "Acme", slug: "acme" },
    counts: {
      activeApiKeys: 0,
      disabledUsers: 0,
      serviceAccounts: 0,
      users: 1,
      workspaces: 1,
    },
    suspension: { suspended: false },
    ...overrides,
  };
}

function provisioningResult(): TenantProvisioningResult {
  return {
    ...organization(),
    defaultWorkspace: {
      id: "workspace-1",
      name: "Default",
      orgId: "org-1",
      slug: "default",
    },
    initialAdmin: {
      email: "admin@example.test",
      id: "user-1",
      localPasswordConfigured: true,
      name: "Admin",
      role: "org_admin",
    },
  };
}

describe("tenant organization mutation policies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeMutationNetworkRevalidation();
    advanceMutationSessionBoundary();
  });

  it("reconciles only the public organization summary after provisioning", async () => {
    const client = createRomeoQueryClient();
    const queryKey = appQueryKeys.adminOrganizations();
    client.setQueryData(queryKey, []);
    mutationMocks.createTenantOrganization.mockResolvedValueOnce(
      provisioningResult(),
    );
    const observer = new MutationObserver(
      client,
      createTenantOrganizationMutationOptions(),
    );

    await observer.mutate({
      initialAdmin: {
        email: "admin@example.test",
        name: "Admin",
        password: "one-time-password",
      },
      name: "Acme",
    });

    const cached = client.getQueryData(queryKey);
    expect(cached).toEqual([organization()]);
    expect(JSON.stringify(cached)).not.toContain("one-time-password");
    expect(JSON.stringify(cached)).not.toContain("admin@example.test");
    expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);

    observer.reset();
    await vi.waitFor(() =>
      expect(client.getMutationCache().getAll()).toHaveLength(0),
    );
  });

  it("optimistically updates and exactly reconciles one organization", async () => {
    const client = createRomeoQueryClient();
    const queryKey = appQueryKeys.adminOrganizations();
    const other = organization({
      organization: { id: "org-2", name: "Other", slug: "other" },
    });
    client.setQueryData(queryKey, [organization(), other]);
    const updated = organization({
      organization: { id: "org-1", name: "Acme Corp", slug: "acme-corp" },
    });
    mutationMocks.updateTenantOrganization.mockResolvedValueOnce(updated);
    const observer = new MutationObserver(
      client,
      updateTenantOrganizationMutationOptions(),
    );

    await observer.mutate({
      orgId: "org-1",
      body: { name: "Acme Corp", slug: "acme-corp" },
    });

    expect(client.getQueryData(queryKey)).toEqual([updated, other]);
    expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
  });

  it("rolls suspension back after a version conflict", async () => {
    const client = createRomeoQueryClient();
    const queryKey = appQueryKeys.adminOrganizations();
    const existing = organization();
    client.setQueryData(queryKey, [existing]);
    mutationMocks.suspendTenantOrganization.mockRejectedValueOnce(
      new Error("version_conflict"),
    );
    const observer = new MutationObserver(
      client,
      suspendTenantOrganizationMutationOptions(),
    );

    await expect(
      observer.mutate({ orgId: "org-1", reasonCode: "security_review" }),
    ).rejects.toThrow("version_conflict");

    expect(client.getQueryData(queryKey)).toEqual([existing]);
    expect(client.getQueryState(queryKey)?.isInvalidated).toBe(false);
  });

  it("rolls reactivation back after an authorization failure", async () => {
    const client = createRomeoQueryClient();
    const queryKey = appQueryKeys.adminOrganizations();
    const suspended = organization({
      suspension: { suspended: true, reasonCode: "security_review" },
    });
    client.setQueryData(queryKey, [suspended]);
    mutationMocks.reactivateTenantOrganization.mockRejectedValueOnce(
      new Error("forbidden"),
    );
    const observer = new MutationObserver(
      client,
      reactivateTenantOrganizationMutationOptions(),
    );

    await expect(observer.mutate("org-1")).rejects.toThrow("forbidden");

    expect(client.getQueryData(queryKey)).toEqual([suspended]);
    expect(client.getQueryState(queryKey)?.isInvalidated).toBe(false);
  });

  it("executes no organization write while offline", async () => {
    const client = createRomeoQueryClient();
    markMutationNetworkOffline();
    const observer = new MutationObserver(
      client,
      suspendTenantOrganizationMutationOptions(),
    );

    await expect(
      observer.mutate({ orgId: "org-1", reasonCode: "security_review" }),
    ).rejects.toThrow(
      "Changes are unavailable until the secure connection is ready.",
    );
    expect(mutationMocks.suspendTenantOrganization).not.toHaveBeenCalled();
  });

  it("rejects a late organization response after logout", async () => {
    const client = createRomeoQueryClient();
    const queryKey = appQueryKeys.adminOrganizations();
    client.setQueryData(queryKey, [organization()]);
    let resolveUpdate: ((value: TenantOrganizationSummary) => void) | undefined;
    mutationMocks.updateTenantOrganization.mockImplementationOnce(
      () =>
        new Promise<TenantOrganizationSummary>((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    const observer = new MutationObserver(
      client,
      updateTenantOrganizationMutationOptions(),
    );
    const pending = observer.mutate({
      orgId: "org-1",
      body: { name: "Late update" },
    });
    await vi.waitFor(() => expect(resolveUpdate).toBeDefined());

    await clearRouteDataForLogout(client);
    resolveUpdate?.(
      organization({
        organization: { id: "org-1", name: "Late update", slug: "acme" },
      }),
    );

    await expect(pending).rejects.toThrow(
      "The authentication session changed.",
    );
    expect(client.getQueryData(queryKey)).toBeUndefined();
  });
});
