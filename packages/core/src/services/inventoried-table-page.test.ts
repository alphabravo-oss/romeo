import { describe, expect, it } from "vitest";

import { createPageCursorCodec } from "./page-cursor";
import {
  normalizeInventoriedTableQuery,
  pageInventoriedTable,
  type InventoriedTablePolicy,
  type InventoriedTableRow,
} from "./inventoried-table-page";

const policy: InventoriedTablePolicy = {
  defaultSort: { direction: "desc", field: "createdAt" },
  filters: { status: ["eq", "neq"] },
  searchFields: ["name", "id"],
  sortFields: ["createdAt", "name", "id"],
};

const codec = createPageCursorCodec({
  resource: "inventoried_tables",
  secrets: ["romeo-test-inventoried-table-cursor-secret-v1"],
});

function rows(): InventoriedTableRow[] {
  return [
    { createdAt: "2026-01-03T00:00:00Z", id: "key_c", name: "charlie" },
    {
      createdAt: "2026-01-01T00:00:00Z",
      id: "key_a",
      name: "alpha",
      revokedAt: "2026-01-04T00:00:00Z",
    },
    { createdAt: "2026-01-02T00:00:00Z", id: "key_b", name: "bravo" },
  ];
}

describe("pageInventoriedTable", () => {
  it("pages with a signed cursor bound to tenant and sort", () => {
    const first = pageInventoriedTable({
      codec,
      policy,
      query: { filters: [], limit: 2, sort: [] },
      rows: rows(),
      tenant: { orgId: "org_default" },
    });
    expect(first.items.map((row) => row.id)).toEqual(["key_c", "key_b"]);
    expect(first.page.estimatedTotal).toBe(3);
    expect(first.page.nextCursor).toEqual(expect.any(String));

    const second = pageInventoriedTable({
      codec,
      policy,
      query: {
        cursor: first.page.nextCursor!,
        filters: [],
        limit: 2,
        sort: [],
      },
      rows: rows(),
      tenant: { orgId: "org_default" },
    });
    expect(second.items.map((row) => row.id)).toEqual(["key_a"]);
    expect(second.page.nextCursor).toBeNull();
  });

  it("rejects a tampered cursor and a cursor replayed against another tenant", () => {
    const first = pageInventoriedTable({
      codec,
      policy,
      query: { filters: [], limit: 2, sort: [] },
      rows: rows(),
      tenant: { orgId: "org_default" },
    });
    const cursor = first.page.nextCursor!;
    expect(() =>
      pageInventoriedTable({
        codec,
        policy,
        query: { cursor: `${cursor}x`, filters: [], limit: 2, sort: [] },
        rows: rows(),
        tenant: { orgId: "org_default" },
      }),
    ).toThrow(/invalid or expired/i);
    expect(() =>
      pageInventoriedTable({
        codec,
        policy,
        query: { cursor, filters: [], limit: 2, sort: [] },
        rows: rows(),
        tenant: { orgId: "org_other" },
      }),
    ).toThrow(/invalid or expired/i);
  });

  it("rejects a cursor when the sort or filter shape changes", () => {
    const first = pageInventoriedTable({
      codec,
      policy,
      query: { filters: [], limit: 2, sort: [] },
      rows: rows(),
      tenant: { orgId: "org_default" },
    });
    expect(() =>
      pageInventoriedTable({
        codec,
        policy,
        query: {
          cursor: first.page.nextCursor!,
          filters: [],
          limit: 2,
          sort: [{ direction: "asc", field: "name" }],
        },
        rows: rows(),
        tenant: { orgId: "org_default" },
      }),
    ).toThrow(/invalid or expired/i);
    expect(() =>
      pageInventoriedTable({
        codec,
        policy,
        query: {
          cursor: first.page.nextCursor!,
          filters: [{ field: "status", operator: "eq", value: "active" }],
          limit: 2,
          sort: [],
        },
        rows: rows(),
        tenant: { orgId: "org_default" },
      }),
    ).toThrow(/invalid or expired/i);
  });

  it("allowlists sort and filter fields and applies search", () => {
    expect(() =>
      normalizeInventoriedTableQuery(
        { filters: [], limit: 25, sort: [{ direction: "asc", field: "scopes" }] },
        policy,
      ),
    ).toThrow(/invalid/i);
    expect(() =>
      normalizeInventoriedTableQuery(
        {
          filters: [{ field: "scopes", operator: "eq", value: "me:read" }],
          limit: 25,
          sort: [],
        },
        policy,
      ),
    ).toThrow(/invalid/i);

    const page = pageInventoriedTable({
      codec,
      policy,
      query: {
        filters: [{ field: "status", operator: "eq", value: "active" }],
        limit: 25,
        search: "br",
        sort: [{ direction: "asc", field: "name" }],
      },
      rows: rows(),
      tenant: { orgId: "org_default" },
    });
    expect(page.items.map((row) => row.id)).toEqual(["key_b"]);
    expect(page.applied.sort).toEqual([{ direction: "asc", field: "name" }]);
  });
});
