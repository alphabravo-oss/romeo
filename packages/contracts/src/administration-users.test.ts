import { describe, expect, it } from "vitest";

import {
  AdminUserTablePageSchema,
  AdminUserTableQuerySchema,
} from "./administration-users";

describe("admin user server table contracts", () => {
  it("defaults to bounded stable name ordering", () => {
    expect(AdminUserTableQuerySchema.parse({})).toEqual({
      filters: [],
      limit: 50,
      sort: [{ direction: "asc", field: "name" }],
    });
  });

  it("accepts only the explicit search, sort, and filter allowlists", () => {
    expect(
      AdminUserTableQuerySchema.safeParse({
        filters: [
          { field: "role", operator: "in", value: ["org_admin", "user"] },
          { field: "status", operator: "eq", value: "active" },
        ],
        limit: 100,
        search: "alice@example.com",
        sort: [{ direction: "desc", field: "email" }],
      }).success,
    ).toBe(true);
    for (const invalid of [
      { search: "al" },
      { sort: [{ direction: "asc", field: "orgId" }] },
      { filters: [{ field: "email", operator: "contains", value: "@" }] },
      { filters: [{ field: "status", operator: "eq", value: "pending" }] },
    ]) {
      expect(AdminUserTableQuerySchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("uses the shared cursor envelope plus sanitized directory summary", () => {
    expect(
      AdminUserTablePageSchema.safeParse({
        data: {
          applied: {
            filters: [{ field: "status", operator: "eq", value: "active" }],
            sort: [{ direction: "asc", field: "name" }],
          },
          items: [],
          page: {
            estimatedTotal: 0,
            limit: 50,
            nextCursor: null,
            previousCursor: null,
          },
          summary: {
            activeGlobalAdminTotal: 1,
            adminTotal: 1,
            disabledTotal: 0,
            userTotal: 1,
          },
        },
      }).success,
    ).toBe(true);
  });
});
