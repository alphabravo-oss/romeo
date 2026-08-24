import type { QueryInventoriedTableRowsInput } from "@romeo/core";
import { describe, expect, it } from "vitest";

import { PgInventoriedTablePageRepository } from "./inventoried-table-page-repository";

describe("PgInventoriedTablePageRepository", () => {
  it("returns projected rows without an unnecessary count query", async () => {
    const createdAt = new Date("2026-08-23T12:00:00.000Z");
    await expect(
      repository([[{ id: "job_1", createdAt }]]).queryInventoriedTableRows(
        input({ includeTotals: false }),
      ),
    ).resolves.toEqual({
      items: [{ id: "job_1", createdAt: createdAt.toISOString() }],
    });
  });

  it("supports every filter operator, escaped search, positioning, and totals", async () => {
    const result = await repository([
      [{ id: "usage_1" }],
      [{ total: "1" }],
    ]).queryInventoriedTableRows(
      input({
        resource: "usage_events",
        sort: { field: "quantity", direction: "desc" },
        filters: [
          { field: "quantity", operator: "eq", value: 1 },
          { field: "quantity", operator: "neq", value: 2 },
          { field: "quantity", operator: "gte", value: 0 },
          { field: "quantity", operator: "gt", value: 0 },
          { field: "quantity", operator: "lte", value: 10 },
          { field: "quantity", operator: "lt", value: 11 },
        ],
        search: "100%_safe\\value",
        searchFields: ["metric"],
        snapshotAt: "2026-08-23T12:00:00.000Z",
        workspaceId: "workspace_default",
        position: { id: "usage_0", value: 5 },
      }),
    );
    expect(result).toEqual({ items: [{ id: "usage_1" }], total: 1 });
  });

  it("returns notification and governance summaries from the unfiltered authority", async () => {
    const notificationResult = await repository([
      [{ id: "notification_1" }],
      [{ total: 3 }],
      [{ total: "3", unreadTotal: "2" }],
    ]).queryInventoriedTableRows(
      input({ resource: "notifications", actorType: "user" }),
    );
    expect(notificationResult.summary).toEqual({ total: 3, unreadTotal: 2 });

    const artifact = {
      id: "export_1",
      packageId: "export_1",
      state: "artifact_ready",
      __objectKey: "governance/org/export.ndjson",
      __contentType: "application/x-ndjson",
      __sizeBytes: 42,
      __sha256: "a".repeat(64),
      __fileName: "export.ndjson",
    };
    const governanceResult = await repository([
      [artifact],
      [{ total: 1 }],
      [
        {
          total: "1",
          orgScopeTotal: "0",
          workspaceScopeTotal: "1",
          withContentTotal: "1",
        },
      ],
    ]).queryInventoriedTableRows(
      input({ resource: "governance_export_packages" }),
    );
    expect(governanceResult.summary).toEqual({
      total: 1,
      orgScopeTotal: 0,
      workspaceScopeTotal: 1,
      withContentTotal: 1,
    });
    expect(governanceResult.items[0]).toMatchObject({
      artifact: {
        contentType: "application/x-ndjson",
        sizeBytes: 42,
        storage: { driver: "object_store", rawObjectKeyReturned: false },
      },
    });
    expect(JSON.stringify(governanceResult.items[0])).not.toContain(
      "governance/org/export.ndjson",
    );
  });

  it("handles null cursors and tenant-parent/actor fail-closed predicates", async () => {
    await expect(
      repository([[{ id: "delivery_1" }]]).queryInventoriedTableRows(
        input({
          includeTotals: false,
          resource: "notification_deliveries",
          actorType: "service_account",
          position: { id: "delivery_0", value: null },
        }),
      ),
    ).resolves.toMatchObject({ items: [{ id: "delivery_1" }] });
    await expect(
      repository([[{ id: "sync_1" }]]).queryInventoriedTableRows(
        input({
          includeTotals: false,
          resource: "data_connector_sync_runs",
          position: { id: "sync_0", value: null },
          sort: { field: "startedAt", direction: "desc" },
        }),
      ),
    ).resolves.toMatchObject({ items: [{ id: "sync_1" }] });
  });

  it("rejects unknown fields, operators, malformed values, and unsafe counts", async () => {
    await expect(
      query(input({ sort: { field: "missing", direction: "asc" } })),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      query(
        input({ filters: [{ field: "id", operator: "contains", value: "x" }] }),
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      query(input({ filters: [{ field: "id", operator: "eq", value: "" }] })),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      query(
        input({
          filters: [
            { field: "createdAt", operator: "gte", value: "not-a-date" },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      query(
        input({
          resource: "usage_events",
          filters: [{ field: "quantity", operator: "eq", value: Number.NaN }],
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      repository([
        [],
        [{ total: Number.MAX_SAFE_INTEGER + 1 }],
      ]).queryInventoriedTableRows(input()),
    ).rejects.toThrow("invalid_table_count");
  });
});

function query(value: QueryInventoriedTableRowsInput) {
  return repository([]).queryInventoriedTableRows(value);
}

function input(
  overrides: Partial<QueryInventoriedTableRowsInput> = {},
): QueryInventoriedTableRowsInput {
  return {
    actorId: "user_dev_admin",
    actorType: "user",
    filters: [],
    includeTotals: true,
    limit: 50,
    orgId: "org_default",
    resource: "background_jobs",
    searchFields: [],
    sort: { direction: "asc", field: "createdAt" },
    ...overrides,
  };
}

function repository(results: unknown[][]) {
  return new PgInventoriedTablePageRepository({
    execute: async () => results.shift() ?? [],
  } as never);
}
