import type { GeneratedQueryClient } from "@romeo/api-client/runtime/generated-query-client";
import type { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import type { RomeoRouterContext } from "./router-context";
import { prefetchPrimaryRouteData } from "./route-data";
import { RouteWorkspaceSelectionError } from "./route-workspace-selection";

const bootstrap = {
  deployment: { tenancyMode: "single" as const },
  organizations: [],
  subject: {
    groupIds: [],
    id: "user-1",
    isAdmin: true,
    orgId: "org-1",
    scopes: [],
    type: "user" as const,
    workspaceIds: ["workspace-1"],
  },
  workspaces: [{ id: "workspace-1", name: "Primary", orgId: "org-1" }],
};

function operationIds(prefetchQuery: ReturnType<typeof vi.fn>): string[] {
  return prefetchQuery.mock.calls.map(([options]) => {
    const root = options.queryKey[0] as { _id?: string } | string;
    return typeof root === "string" ? root : (root._id ?? "unknown");
  });
}

const selection = { source: "default" as const, workspaceId: "workspace-1" };

function queryOperationId(options: { queryKey: readonly unknown[] }): string {
  const root = options.queryKey[0] as { _id?: string } | string;
  return typeof root === "string" ? root : (root._id ?? "unknown");
}

function createContext(
  selectionResult = Promise.resolve(selection),
  bootstrapResult = bootstrap,
) {
  const fetchQuery = vi.fn((options: { queryKey: readonly unknown[] }) =>
    queryOperationId(options) === "routeWorkspaceSelection"
      ? selectionResult
      : Promise.resolve(bootstrap),
  );
  const prefetchQuery = vi.fn(() => Promise.resolve());
  const prefetchInfiniteQuery = vi.fn(() => Promise.resolve());
  const apiClient = {
    getConfig: () => ({ baseUrl: "https://romeo.example/api/v1" }),
  } as GeneratedQueryClient;
  return {
    context: {
      apiClient,
      locale: "fr" as const,
      queryClient: {
        fetchQuery,
        getQueryData: () => bootstrapResult,
        prefetchInfiniteQuery,
        prefetchQuery,
      } as unknown as QueryClient,
    } satisfies RomeoRouterContext,
    fetchQuery,
    prefetchInfiniteQuery,
    prefetchQuery,
  };
}

describe("primary route data prefetch", () => {
  it("starts independent workspace data before bootstrap resolves", async () => {
    let resolveSelection!: (value: typeof selection) => void;
    const pendingSelection = new Promise<typeof selection>((resolve) => {
      resolveSelection = resolve;
    });
    const { context, prefetchInfiniteQuery, prefetchQuery } =
      createContext(pendingSelection);

    const loading = prefetchPrimaryRouteData("workspace", context);
    expect(operationIds(prefetchQuery)).toEqual([
      "interfacePreferencesGetCurrent",
      "routerSession",
      "providersListModels",
      "providersListConnections",
      "providersGetOperationalSummary",
    ]);

    resolveSelection(selection);
    await loading;
    expect(operationIds(prefetchQuery)).toContain("managedModelsList");
    expect(operationIds(prefetchQuery)).toContain("routerSession");
    expect(operationIds(prefetchQuery)).toContain("workspaceCapabilities");
    expect(operationIds(prefetchInfiniteQuery)).toEqual(["chats"]);
  });

  it("passes selected chat/workspace dimensions to the authorization query", async () => {
    const route = createContext();
    await prefetchPrimaryRouteData("chat", route.context, "navigation", {
      chatId: "chat-1",
      workspaceId: "workspace-1",
    });
    const [selectionCall] = route.fetchQuery.mock.calls;
    expect(selectionCall?.[0].queryKey).toEqual([
      "routeWorkspaceSelection",
      { chatId: "chat-1", workspaceId: "workspace-1" },
    ]);
  });

  it("does not start workspace-scoped requests after route authorization fails", async () => {
    const route = createContext(
      Promise.reject(
        new RouteWorkspaceSelectionError("workspace_not_authorized"),
      ),
    );
    await expect(
      prefetchPrimaryRouteData("chat", route.context, "navigation", {
        workspaceId: "workspace-other",
      }),
    ).rejects.toMatchObject({
      code: "workspace_not_authorized",
      status: 404,
    });

    expect(operationIds(route.prefetchQuery)).not.toContain(
      "managedModelsList",
    );
    expect(operationIds(route.prefetchQuery)).not.toContain(
      "workspaceCapabilities",
    );
    expect(route.prefetchInfiniteQuery).not.toHaveBeenCalled();
  });

  it("prefetches draft models for admin and keeps settings bounded", async () => {
    const admin = createContext();
    await prefetchPrimaryRouteData("admin", admin.context);
    expect(operationIds(admin.prefetchQuery)).toContain("managedModelsList");

    const settings = createContext();
    await prefetchPrimaryRouteData("settings", settings.context);
    expect(operationIds(settings.prefetchQuery)).toEqual([
      "interfacePreferencesGetCurrent",
      "routerSession",
    ]);
  });

  it("denies a non-admin before privileged admin prefetch begins", async () => {
    const nonAdmin = createContext(Promise.resolve(selection), {
      ...bootstrap,
      subject: { ...bootstrap.subject, isAdmin: false },
    });

    await expect(
      prefetchPrimaryRouteData("admin", nonAdmin.context),
    ).rejects.toMatchObject({
      code: "admin_route_not_authorized",
      message: "The requested route is unavailable.",
      status: 404,
    });
    expect(operationIds(nonAdmin.prefetchQuery)).toEqual([
      "interfacePreferencesGetCurrent",
      "routerSession",
    ]);
    expect(nonAdmin.prefetchInfiniteQuery).not.toHaveBeenCalled();
  });

  it("does no work for admin intent and bounds safe workspace/settings intent", async () => {
    const admin = createContext();
    await prefetchPrimaryRouteData("admin", admin.context, "intent");
    expect(admin.fetchQuery).not.toHaveBeenCalled();
    expect(admin.prefetchQuery).not.toHaveBeenCalled();

    const workspace = createContext();
    await prefetchPrimaryRouteData("workspace", workspace.context, "intent");
    expect(workspace.fetchQuery).toHaveBeenCalledTimes(1);
    expect(operationIds(workspace.prefetchQuery)).toEqual([
      "interfacePreferencesGetCurrent",
      "routerSession",
    ]);

    const settings = createContext();
    await prefetchPrimaryRouteData("settings", settings.context, "intent");
    expect(settings.fetchQuery).toHaveBeenCalledTimes(1);
    expect(operationIds(settings.prefetchQuery)).toEqual([
      "interfacePreferencesGetCurrent",
      "routerSession",
    ]);
  });
});
