import { describe, expect, it } from "vitest";

import { diagnoseQuery, queryDiagnosticMeta } from "./query-cache-diagnostics";
import { queryCacheProfiles } from "./query-cache-policy";
import {
  agentGalleryQueryOptions,
  interfacePreferencesQueryOptions,
  modelsQueryOptions,
  providerOperationalSummaryQueryOptions,
} from "./api-query-options";

describe("query cache policy", () => {
  it("orders resource profiles from volatile to immutable", () => {
    expect(queryCacheProfiles.volatile.networkMode).toBe("online");
    expect(queryCacheProfiles.volatile.refetchOnReconnect).toBe("always");
    expect(queryCacheProfiles.volatile.refetchOnWindowFocus).toBe(true);
    expect(queryCacheProfiles.interactive.refetchOnReconnect).toBe(true);
    expect(queryCacheProfiles.interactive.refetchOnWindowFocus).toBe(true);
    expect(queryCacheProfiles.stable.refetchOnReconnect).toBe(true);
    expect(queryCacheProfiles.stable.refetchOnWindowFocus).toBe(false);
    expect(queryCacheProfiles.immutable.refetchOnReconnect).toBe(false);
    expect(queryCacheProfiles.immutable.refetchOnWindowFocus).toBe(false);
    expect(queryCacheProfiles.volatile.staleTime).toBe(0);
    expect(queryCacheProfiles.interactive.staleTime).toBeLessThan(
      queryCacheProfiles.stable.staleTime,
    );
    expect(queryCacheProfiles.immutable.staleTime).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it("applies shared profiles to primary generated factories", () => {
    expect(modelsQueryOptions().staleTime).toBe(
      queryCacheProfiles.stable.staleTime,
    );
    expect(interfacePreferencesQueryOptions().gcTime).toBe(
      queryCacheProfiles.stable.gcTime,
    );
    expect(providerOperationalSummaryQueryOptions().staleTime).toBe(
      queryCacheProfiles.volatile.staleTime,
    );
    expect(agentGalleryQueryOptions("workspace-1").gcTime).toBe(
      queryCacheProfiles.interactive.gcTime,
    );
  });
});

describe("query cache diagnostics", () => {
  const idleState = { fetchStatus: "idle" } as const;

  it("reports semantic hash collisions", () => {
    const signatures = new Map<string, string>();
    expect(
      diagnoseQuery(
        {
          meta: queryDiagnosticMeta("models"),
          queryHash: "collision",
          queryKey: ["models"],
          state: idleState,
        } as never,
        signatures,
      ),
    ).toEqual([]);
    expect(
      diagnoseQuery(
        {
          meta: queryDiagnosticMeta("providers"),
          queryHash: "collision",
          queryKey: ["providers"],
          state: idleState,
        } as never,
        signatures,
      ),
    ).toEqual(["key collision for hash collision"]);
  });

  it("reports missing declared and known live dimensions", () => {
    expect(
      diagnoseQuery(
        {
          meta: queryDiagnosticMeta("agents", { workspaceId: undefined }),
          queryHash: "agents",
          queryKey: ["agents"],
          state: { fetchStatus: "fetching" },
        } as never,
        new Map(),
      ),
    ).toContain("agents is missing workspaceId");
    expect(
      diagnoseQuery(
        {
          meta: undefined,
          queryHash: "chat",
          queryKey: ["chat"],
          state: { fetchStatus: "fetching" },
        } as never,
        new Map(),
      ),
    ).toContain("chat is missing its resource scope");
    expect(
      diagnoseQuery(
        {
          meta: undefined,
          queryHash: "files",
          queryKey: ["files"],
          state: { fetchStatus: "fetching" },
        } as never,
        new Map(),
      ),
    ).toContain("files is missing its resource scope");
  });

  it("reports declared dimensions omitted from the actual key", () => {
    expect(
      diagnoseQuery(
        {
          meta: queryDiagnosticMeta("agents", {
            workspaceId: "workspace-1",
          }),
          queryHash: "agents-without-workspace",
          queryKey: [{ _id: "managedModelsList" }],
          state: idleState,
        } as never,
        new Map(),
      ),
    ).toContain("agents key is missing workspaceId");
    expect(
      diagnoseQuery(
        {
          meta: queryDiagnosticMeta("agents", {
            workspaceId: "workspace-1",
          }),
          queryHash: "agents-with-workspace",
          queryKey: [
            {
              _id: "managedModelsList",
              query: { workspaceId: "workspace-1" },
            },
          ],
          state: idleState,
        } as never,
        new Map(),
      ),
    ).toEqual([]);
  });
});
