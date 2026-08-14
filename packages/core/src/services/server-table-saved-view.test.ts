import { describe, expect, it } from "vitest";

import {
  mergeSavedViews,
  migrateLocalSavedView,
  SAVED_VIEW_SCHEMA,
} from "./server-table-saved-view";

const identity = {
  orgId: "org_default",
  workspaceId: "workspace_default",
  ownerUserId: "user_dev_admin",
  resource: "audit_logs",
  allowedFields: new Set(["createdAt", "action"]),
  now: "2026-08-14T12:00:00.000Z",
};

describe("server table saved views", () => {
  it("migrates local v1 preferences and lets server rows win on name", () => {
    const local = migrateLocalSavedView({
      ...identity,
      local: {
        name: "Open incidents",
        globalFilter: "denied",
        pageSize: 50,
        density: "compact",
        columnVisibility: { createdAt: true, secret: false },
        sorting: [{ id: "createdAt", desc: true }, { id: "unknown", desc: false }],
      },
    });
    if ("outcome" in local) throw new Error("expected migrated view");
    expect(local).toMatchObject({
      schema: SAVED_VIEW_SCHEMA,
      source: "local_fallback",
      name: "Open incidents",
      query: {
        search: "denied",
        pageSize: 50,
        sort: [{ field: "createdAt", direction: "desc" }],
      },
      presentation: {
        columnVisibility: { createdAt: true },
        density: "compact",
      },
    });
    const server = {
      ...local,
      id: "saved_view_server_1",
      source: "server" as const,
      query: { ...local.query, search: "timeout" },
      version: 4,
    };
    const merged = mergeSavedViews({
      server: [server],
      localFallback: [local],
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      source: "server",
      query: { search: "timeout" },
      version: 4,
    });
  });

  it("rejects secret-bearing local search instead of persisting it", () => {
    expect(
      migrateLocalSavedView({
        ...identity,
        local: { name: "Keys", globalFilter: "bearer abc.secret" },
      }),
    ).toEqual({ outcome: "rejected", code: "saved_view_invalid" });
  });
});
