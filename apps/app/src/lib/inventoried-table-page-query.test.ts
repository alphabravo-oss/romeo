import { describe, expect, it } from "vitest";

import {
  inventoriedTablePageQueryOptions,
  parseInventoriedTablePage,
  type InventoriedTablePageQuery,
} from "./inventoried-table-page-query";
import { InventoriedTableContractError } from "./inventoried-table-resource-registry";
import {
  tableDataContinuityKey,
  tableScopeKey,
} from "./inventoried-server-table";

const request = {
  filters: [{ field: "status", operator: "eq", value: "active" }],
  limit: 25,
  resource: "api_keys",
  sort: [{ direction: "desc", field: "createdAt" }],
} as const satisfies InventoriedTablePageQuery<"api_keys">;

const validPage = {
  applied: { filters: request.filters, sort: request.sort },
  items: [
    {
      createdAt: "2026-08-23T12:00:00.000Z",
      id: "key-1",
      name: "Production",
      scopes: ["admin:read"],
    },
  ],
  page: {
    estimatedTotal: 1,
    limit: 25,
    nextCursor: null,
    previousCursor: null,
  },
  resource: "api_keys",
  summary: { revokedTotal: 0, total: 1 },
};

describe("inventoried table page contract", () => {
  it("returns typed rows and server-confirmed filters from a valid envelope", () => {
    const page = parseInventoriedTablePage(request, validPage);

    expect(page.items[0]?.name).toBe("Production");
    expect(page.applied.filters).toEqual(request.filters);
  });

  it.each([
    ["wrong resource", { ...validPage, resource: "groups" }],
    ["bad row", { ...validPage, items: [{ id: "key-1" }] }],
    [
      "duplicate identity",
      { ...validPage, items: [validPage.items[0], validPage.items[0]] },
    ],
    [
      "unsupported applied sort",
      {
        ...validPage,
        applied: {
          ...validPage.applied,
          sort: [{ direction: "asc", field: "displayName" }],
        },
      },
    ],
    ["unsupported summary", { ...validPage, summary: { secretTotal: 1 } }],
  ])("rejects %s", (_label, response) => {
    expect(() => parseInventoriedTablePage(request, response)).toThrow(
      InventoriedTableContractError,
    );
  });

  it("keeps previous data only for pagination inside the same continuity contract", () => {
    const continuityKey = tableDataContinuityKey("org", 25, "", []);
    const options = inventoriedTablePageQueryOptions(request, {
      continuityKey,
      enabled: true,
    });
    const placeholder = options.placeholderData;
    expect(options.meta?.tableContinuityKey).toBe(continuityKey);
    expect(typeof placeholder).toBe("function");
    const previousQuery = { meta: { tableContinuityKey: continuityKey } };
    const otherScopeQuery = { meta: { tableContinuityKey: "other" } };

    expect(
      typeof placeholder === "function"
        ? placeholder(validPage as never, previousQuery as never)
        : undefined,
    ).toBe(validPage);
    expect(
      typeof placeholder === "function"
        ? placeholder(validPage as never, otherScopeQuery as never)
        : validPage,
    ).toBeUndefined();
  });

  it("lets the shared factory poll only while an authoritative job is active", () => {
    const options = inventoriedTablePageQueryOptions(
      {
        filters: [],
        limit: 25,
        resource: "governance_export_packages",
        sort: [],
      },
      {
        continuityKey: "governance-exports",
        enabled: true,
        refetchInterval: (rows) =>
          rows?.some((row) => row.state === "queued" || row.state === "running")
            ? 1_000
            : false,
      },
    );
    if (typeof options.refetchInterval !== "function")
      throw new Error("Expected an authoritative polling policy");

    expect(
      options.refetchInterval({
        state: { data: { items: [{ state: "running" }] } },
      } as never),
    ).toBe(1_000);
    expect(
      options.refetchInterval({
        state: { data: { items: [{ state: "artifact_ready" }] } },
      } as never),
    ).toBe(false);
  });

  it("normalizes filter order into one stable scope identity", () => {
    const first = tableScopeKey("api_keys", undefined, undefined, [
      { field: "b", operator: "eq" },
      { field: "a", operator: "eq" },
    ]);
    const second = tableScopeKey("api_keys", undefined, undefined, [
      { field: "a", operator: "eq" },
      { field: "b", operator: "eq" },
    ]);

    expect(first).toBe(second);
    expect(tableScopeKey("api_keys", undefined, undefined, [])).not.toBe(
      tableScopeKey("api_keys", undefined, "workspace-2", []),
    );
  });

  it("fails closed when a parent-scoped row claims another owner", () => {
    expect(() =>
      parseInventoriedTablePage(
        {
          filters: [],
          limit: 25,
          parentId: "provider-a",
          resource: "provider_models",
          sort: [],
        },
        {
          applied: { filters: [], sort: [] },
          items: [
            {
              capabilities: {},
              contextWindow: 32_000,
              displayName: "Wrong owner",
              enabled: true,
              id: "model-b",
              name: "model-b",
              providerId: "provider-b",
            },
          ],
          page: {
            estimatedTotal: 1,
            limit: 25,
            nextCursor: null,
            previousCursor: null,
          },
          resource: "provider_models",
        },
      ),
    ).toThrow(/does not belong to requested parent/u);
  });
});
