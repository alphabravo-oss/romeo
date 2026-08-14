import type { GeneratedQueryClient } from "@romeo/api-client/runtime/generated-query-client";
import type { Query, QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  completeMutationNetworkRevalidation,
  mutationNetworkState,
} from "./connectivity";
import {
  isReconnectSecurityQuery,
  revalidateAfterReconnect,
} from "./reconnect-policy";

const bootstrap = {
  subject: { workspaceIds: ["workspace-1"] },
  workspaces: [],
};

beforeEach(() => completeMutationNetworkRevalidation());

describe("reconnect security revalidation", () => {
  it("does not duplicate the explicitly fetched capability snapshot", () => {
    expect(
      isReconnectSecurityQuery({
        meta: { queryDiagnostic: { resource: "workspaceCapabilities" } },
        queryKey: ["workspaceCapabilities", "workspace-1"],
      } as unknown as Query),
    ).toBe(false);
    expect(
      isReconnectSecurityQuery({
        meta: { queryDiagnostic: { resource: "workspaceGrants" } },
        queryKey: ["workspaceGrants", "workspace-1"],
      } as unknown as Query),
    ).toBe(true);
  });

  it("keeps mutations blocked until session, capability, and active policy reads finish", async () => {
    let resolveBootstrap!: (value: typeof bootstrap) => void;
    const pendingBootstrap = new Promise<typeof bootstrap>((resolve) => {
      resolveBootstrap = resolve;
    });
    const fetchQuery = vi
      .fn()
      .mockReturnValueOnce(pendingBootstrap)
      .mockResolvedValueOnce({ imageGeneration: { enabled: true } });
    const refetchQueries = vi.fn(() => Promise.resolve());
    const queryClient = {
      fetchQuery,
      refetchQueries,
    } as unknown as QueryClient;
    const apiClient = {
      getConfig: () => ({ baseUrl: "https://romeo.example/api/v1" }),
    } as GeneratedQueryClient;

    const revalidation = revalidateAfterReconnect({
      apiClient,
      queryClient,
      workspaceId: "workspace-1",
    });
    expect(mutationNetworkState()).toBe("revalidating");
    resolveBootstrap(bootstrap);
    await revalidation;

    expect(fetchQuery).toHaveBeenCalledTimes(2);
    expect(refetchQueries).toHaveBeenCalledOnce();
    expect(mutationNetworkState()).toBe("ready");
  });

  it("fails closed when workspace authorization changed", async () => {
    const queryClient = {
      fetchQuery: vi.fn(() =>
        Promise.resolve({ subject: { workspaceIds: ["workspace-other"] } }),
      ),
      refetchQueries: vi.fn(),
    } as unknown as QueryClient;
    const apiClient = {
      getConfig: () => ({ baseUrl: "https://romeo.example/api/v1" }),
    } as GeneratedQueryClient;

    await expect(
      revalidateAfterReconnect({
        apiClient,
        queryClient,
        workspaceId: "workspace-1",
      }),
    ).rejects.toBeDefined();
    expect(mutationNetworkState()).toBe("revalidation_failed");
  });
});
