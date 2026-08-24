import { describe, expect, it } from "vitest";

import { parseInventoriedTablePage } from "./inventoried-table-page-query";
import {
  inventoriedTableResourceRegistry,
  type InventoriedTableResourceName,
} from "./inventoried-table-resource-registry";

const resources = Object.entries(inventoriedTableResourceRegistry) as Array<
  [
    InventoriedTableResourceName,
    (typeof inventoriedTableResourceRegistry)[InventoriedTableResourceName],
  ]
>;

describe.each(resources)(
  "%s inventoried table behavior",
  (resource, policy) => {
    const sort = policy.sortFields.map((field) => ({
      direction: "asc" as const,
      field,
    }));
    const filters = Object.entries(policy.filters).flatMap(
      ([field, operators]) =>
        operators.map((operator: string) => ({
          field,
          operator,
          value: "fixture",
        })),
    );
    const request = {
      filters,
      limit: 25,
      resource,
      sort,
      ...(policy.scope === "parent" ? { parentId: "parent-1" } : {}),
      ...(policy.scope === "workspace" ? { workspaceId: "workspace-1" } : {}),
    };
    const envelope = {
      applied: { filters, sort },
      items: [],
      page: {
        estimatedTotal: 0,
        limit: 25,
        nextCursor: null,
        previousCursor: null,
      },
      resource,
    };

    it("round-trips every declared sort/filter and explicit scope", () => {
      const page = parseInventoriedTablePage(request as never, envelope);
      expect(page.applied).toEqual({ filters, sort });
      expect(request).toMatchObject(
        policy.scope === "parent"
          ? { parentId: "parent-1" }
          : policy.scope === "workspace"
            ? { workspaceId: "workspace-1" }
            : {},
      );
    });

    it("fails closed for unknown controls and malformed rows", () => {
      expect(() =>
        parseInventoriedTablePage(request as never, {
          ...envelope,
          applied: {
            filters: [{ field: "__unknown__", operator: "eq" }],
            sort,
          },
        }),
      ).toThrow(/unsupported applied filter field/u);
      expect(() =>
        parseInventoriedTablePage(request as never, {
          ...envelope,
          applied: {
            filters,
            sort: [{ direction: "asc", field: "__unknown__" }],
          },
        }),
      ).toThrow(/unsupported applied sort field/u);
      expect(() => policy.parseRow({})).toThrow(
        /expected|must|invalid|required/iu,
      );
    });
  },
);

describe("inventoried behavior coverage", () => {
  it("is generated from the typed production registry", () => {
    expect(resources).toHaveLength(
      Object.keys(inventoriedTableResourceRegistry).length,
    );
    expect(resources.length).toBeGreaterThan(20);
  });
});
