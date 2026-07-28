import { describe, expect, it } from "vitest";

import { catalogPage } from "./catalog-page";

describe("catalogPage", () => {
  const items = Array.from({ length: 55 }, (_, index) => ({
    id: index,
    label: index % 2 === 0 ? `Alpha ${index}` : `Beta ${index}`,
  }));

  it("bounds rendered items and reports stable page metadata", () => {
    expect(catalogPage(items, { page: 1, pageSize: 20 })).toMatchObject({
      page: 1,
      pageCount: 3,
      total: 55,
      items: items.slice(20, 40),
    });
  });

  it("searches before paging and clamps a stale page", () => {
    const result = catalogPage(items, {
      page: 9,
      pageSize: 10,
      query: " alpha ",
      searchText: (item) => item.label,
    });

    expect(result.page).toBe(2);
    expect(result.pageCount).toBe(3);
    expect(result.total).toBe(28);
    expect(result.items).toHaveLength(8);
  });

  it("returns an empty first page for an empty result", () => {
    expect(
      catalogPage(items, {
        page: 4,
        pageSize: 20,
        query: "missing",
        searchText: (item) => item.label,
      }),
    ).toEqual({ items: [], page: 0, pageCount: 1, total: 0 });
  });
});
