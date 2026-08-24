import { describe, expect, it } from "vitest";

import {
  applySavedTableView,
  defaultTableRouteState,
  parseTableRouteState,
  resetTableRouteScope,
  serializeTableRouteState,
  updateTableRouteState,
} from "./table-route-state";

const policy = {
  defaultPageSize: 25,
  defaultSort: "name",
  filterKeys: ["status", "owner"],
  pageSizes: [25, 50],
  sorts: ["name", "status"],
  views: ["table", "cards"],
} as const;

describe("table route state", () => {
  it("round-trips a compact validated direct link", () => {
    const state = {
      direction: "desc" as const,
      filters: { ignored: "secret", status: "active" },
      page: 4,
      pageSize: 50,
      query: "romeo",
      savedViewId: "view-1",
      sort: "status",
      view: "cards",
    };
    const encoded = serializeTableRouteState(state, policy);
    expect(encoded).toBe(
      '{"q":"romeo","s":"status","d":"desc","f":{"status":"active"},"p":4,"z":50,"v":"cards","w":"view-1"}',
    );
    expect(parseTableRouteState(encoded, policy)).toEqual({
      ...state,
      filters: { status: "active" },
    });
  });

  it("fails closed for malformed and unallowlisted URL state", () => {
    expect(parseTableRouteState("not-json", policy)).toEqual(
      defaultTableRouteState(policy),
    );
    expect(
      parseTableRouteState(
        '{"q":7,"s":"__proto__","f":{"evil":"x"},"p":-2,"z":999}',
        policy,
      ),
    ).toEqual(defaultTableRouteState(policy));
  });

  it("resets pagination on result changes but preserves explicit back/forward pages", () => {
    const current = { ...defaultTableRouteState(policy), page: 8 };
    expect(updateTableRouteState(current, { query: "next" }, policy).page).toBe(
      0,
    );
    expect(updateTableRouteState(current, { page: 3 }, policy).page).toBe(3);
  });

  it("coordinates saved views without accumulating state or loops", () => {
    const current = { ...defaultTableRouteState(policy), page: 7 };
    const saved = {
      direction: "desc" as const,
      filters: { status: "disabled" },
      pageSize: 50,
      query: "owner:me",
      sort: "status",
      view: "cards",
    };
    const applied = applySavedTableView(current, saved, "saved-1", policy);
    const reapplied = applySavedTableView(applied, saved, "saved-1", policy);
    expect(reapplied).toEqual(applied);
    expect(applied.page).toBe(0);
    expect(resetTableRouteScope(applied)).toEqual({
      ...applied,
      page: 0,
      savedViewId: undefined,
    });
  });
});
