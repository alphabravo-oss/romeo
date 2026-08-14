import { describe, expect, it } from "vitest";

import {
  authorizeBulkSelection,
  classifyServerTableEmptyState,
} from "./server-table-empty-state";

describe("server table empty states and bulk selection", () => {
  it("distinguishes empty, filter, permission, cursor, and transient states", () => {
    expect(
      classifyServerTableEmptyState({
        authorized: true,
        staleCursor: false,
        transientFailure: false,
        total: 0,
        hasFilters: false,
      }),
    ).toBe("no_data");
    expect(
      classifyServerTableEmptyState({
        authorized: true,
        staleCursor: false,
        transientFailure: false,
        total: 0,
        hasFilters: true,
      }),
    ).toBe("no_filter_matches");
    expect(
      classifyServerTableEmptyState({
        authorized: false,
        staleCursor: false,
        transientFailure: false,
        total: 10,
        hasFilters: false,
      }),
    ).toBe("permission_lost");
    expect(
      classifyServerTableEmptyState({
        authorized: true,
        staleCursor: true,
        transientFailure: false,
        total: 10,
        hasFilters: false,
      }),
    ).toBe("stale_cursor");
    expect(
      authorizeBulkSelection({
        mode: "all_matching_query",
        explicitCount: 0,
        matchingCount: 42,
        reauthorized: false,
      }),
    ).toEqual({
      outcome: "denied",
      code: "bulk_selection_reauthorization_required",
    });
    expect(
      authorizeBulkSelection({
        mode: "all_matching_query",
        explicitCount: 0,
        matchingCount: 42,
        reauthorized: true,
      }),
    ).toEqual({ outcome: "accepted", count: 42 });
  });
});
