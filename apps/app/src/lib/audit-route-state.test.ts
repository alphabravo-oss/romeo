import { describe, expect, it } from "vitest";

import {
  auditRouteSearchFields,
  DEFAULT_AUDIT_ROUTE_STATE,
  resolveAuditRouteState,
} from "./audit-route-state";

describe("audit route state", () => {
  it("round-trips bounded shareable table state without cursor or selection", () => {
    const state = resolveAuditRouteState({
      auditCategory: "security",
      auditNoise: true,
      auditOutcome: "failure",
      auditPageSize: 100,
      auditRange: "30d",
      auditSort: "asc",
    });

    expect(state).toEqual({
      category: "security",
      includeNoise: true,
      outcome: "failure",
      pageSize: 100,
      range: "30d",
      sortDirection: "asc",
    });
    expect(auditRouteSearchFields(state)).toEqual({
      auditCategory: "security",
      auditNoise: true,
      auditOutcome: "failure",
      auditPageSize: 100,
      auditRange: "30d",
      auditSort: "asc",
    });
  });

  it("fails invalid route values back to safe defaults", () => {
    expect(
      resolveAuditRouteState({
        auditCategory: "secret-category",
        auditNoise: false,
        auditOutcome: "maybe",
        auditPageSize: 1_000_000,
        auditRange: "forever",
        auditSort: "DROP TABLE",
      }),
    ).toEqual({
      ...DEFAULT_AUDIT_ROUTE_STATE,
    });
    expect(auditRouteSearchFields(DEFAULT_AUDIT_ROUTE_STATE)).toEqual({});
  });
});
