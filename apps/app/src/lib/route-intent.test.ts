import { readFile } from "node:fs/promises";

import type { GeneratedQueryClient } from "@romeo/api-client/runtime/generated-query-client";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import * as appQueryKeys from "./app-query-keys";
import {
  cancelWorkspaceIntentData,
  clearRouteDataForLogout,
  prefetchAuthorizedWorkspaceIntentData,
} from "./route-intent";

describe("route intent cache boundaries", () => {
  it("issues one bounded request only for the authorized workspace key", async () => {
    const prefetchQuery = vi.fn(() => Promise.resolve());
    const queryClient = { prefetchQuery } as unknown as QueryClient;
    const apiClient = {
      getConfig: () => ({ baseUrl: "https://romeo.example/api/v1" }),
    } as GeneratedQueryClient;

    await expect(
      prefetchAuthorizedWorkspaceIntentData(
        queryClient,
        apiClient,
        "workspace-denied",
        ["workspace-allowed"],
      ),
    ).resolves.toBe(false);
    expect(prefetchQuery).not.toHaveBeenCalled();

    await expect(
      prefetchAuthorizedWorkspaceIntentData(
        queryClient,
        apiClient,
        "workspace-allowed",
        ["workspace-allowed"],
      ),
    ).resolves.toBe(true);
    expect(prefetchQuery).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(prefetchQuery.mock.calls)).toContain(
      "workspace-allowed",
    );
    expect(JSON.stringify(prefetchQuery.mock.calls)).not.toContain(
      "workspace-denied",
    );
  });

  it("cancels and removes only the workspace being left", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const oldKey = appQueryKeys.workspaceCapabilities("workspace-old");
    const nextKey = appQueryKeys.workspaceCapabilities("workspace-next");
    let observedAbort = false;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const pending = queryClient.fetchQuery({
      queryKey: oldKey,
      queryFn: ({ signal }) =>
        new Promise<never>((_resolve, reject) => {
          markStarted();
          signal.addEventListener(
            "abort",
            () => {
              observedAbort = true;
              reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
          );
        }),
    });
    queryClient.setQueryData(nextKey, "preserve");

    await started;
    await cancelWorkspaceIntentData(queryClient, "workspace-old");
    await pending.catch(() => undefined);

    expect(observedAbort).toBe(true);
    expect(queryClient.getQueryState(oldKey)).toBeUndefined();
    expect(queryClient.getQueryData(nextKey)).toBe("preserve");
  });

  it("cancels and clears the subject/org cache before re-authentication", async () => {
    const queryClient = new QueryClient();
    const abort = vi.fn();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const pending = queryClient.fetchQuery({
      queryKey: ["intent", "pending"],
      queryFn: ({ signal }) =>
        new Promise<never>((_resolve, reject) => {
          markStarted();
          signal.addEventListener(
            "abort",
            () => {
              abort();
              reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
          );
        }),
    });
    queryClient.setQueryData(appQueryKeys.jobs(), ["org-a-job"]);
    queryClient.setQueryData(appQueryKeys.routerSession("en"), {
      orgId: "org-a",
      subjectId: "subject-a",
    });

    await started;
    await clearRouteDataForLogout(queryClient);
    await pending.catch(() => undefined);

    expect(abort).toHaveBeenCalledOnce();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);

    queryClient.setQueryData(appQueryKeys.jobs(), ["org-b-job"]);
    expect(queryClient.getQueryData(appQueryKeys.jobs())).toEqual([
      "org-b-job",
    ]);
    expect(JSON.stringify(queryClient.getQueryCache().getAll())).not.toContain(
      "org-a",
    );
  });

  it("wires workspace changes and logout to the cache boundary helpers", async () => {
    const [workspaceContext, userMenu] = await Promise.all([
      readFile(
        new URL("../components/WorkspaceContext.tsx", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../components/WorkspaceUserMenu.tsx", import.meta.url),
        "utf8",
      ),
    ]);
    expect(workspaceContext).toContain("cancelWorkspaceIntentData(");
    expect(userMenu).toContain("clearRouteDataForLogout(queryClient)");
  });
});
