import { describe, expect, it } from "vitest";
import { z } from "@hono/zod-openapi";

import {
  createServerTablePageSchema,
  createServerTableQuerySchema,
} from "./server-table";

const querySchema = createServerTableQuerySchema({
  sortFields: ["createdAt", "id", "status"],
  defaultSort: [
    { field: "createdAt", direction: "desc" },
    { field: "id", direction: "asc" },
  ],
  filters: {
    status: {
      eq: z.enum(["active", "disabled"]),
      in: z
        .array(z.enum(["active", "disabled"]))
        .min(1)
        .max(2),
    },
    createdAt: {
      gte: z.iso.datetime(),
      lte: z.iso.datetime(),
    },
    deletedAt: { is_null: null, not_null: null },
  },
  search: { maxLength: 120 },
});

describe("server table contracts", () => {
  it("applies bounded defaults and accepts allowlisted sort/filter fields", () => {
    expect(
      querySchema.parse({
        filters: [{ field: "status", operator: "eq", value: "active" }],
      }),
    ).toEqual({
      limit: 50,
      search: undefined,
      sort: [
        { field: "createdAt", direction: "desc" },
        { field: "id", direction: "asc" },
      ],
      filters: [{ field: "status", operator: "eq", value: "active" }],
    });
  });

  it.each([
    [
      "unknown sort field",
      { sort: [{ field: "name", direction: "asc" }], filters: [] },
    ],
    [
      "unknown filter field",
      { filters: [{ field: "name", operator: "eq", value: "x" }] },
    ],
    [
      "operator not allowed for field",
      { filters: [{ field: "status", operator: "contains", value: "act" }] },
    ],
    [
      "invalid typed value",
      { filters: [{ field: "status", operator: "eq", value: "pending" }] },
    ],
    [
      "value on null operator",
      { filters: [{ field: "deletedAt", operator: "is_null", value: true }] },
    ],
  ])("rejects %s", (_name, input) => {
    expect(querySchema.safeParse(input).success).toBe(false);
  });

  it("rejects search when a resource has not enabled it", () => {
    const withoutSearch = createServerTableQuerySchema({
      sortFields: ["id"],
      defaultSort: [{ field: "id", direction: "asc" }],
      filters: {},
    });
    expect(withoutSearch.safeParse({ search: "secret" }).success).toBe(false);
  });

  it("validates the standard response envelope", () => {
    const page = createServerTablePageSchema(
      z.strictObject({ id: z.string(), status: z.string() }),
    );
    expect(
      page.parse({
        data: {
          items: [{ id: "user_1", status: "active" }],
          page: {
            nextCursor: "cursor_2",
            previousCursor: null,
            limit: 50,
            estimatedTotal: 123,
          },
          applied: {
            sort: [{ field: "createdAt", direction: "desc" }],
            filters: [{ field: "status", operator: "eq", value: "active" }],
          },
        },
      }).data.items,
    ).toHaveLength(1);
  });

  it("rejects unsafe or internally inconsistent policies", () => {
    expect(() =>
      createServerTableQuerySchema({
        sortFields: ["created_at"],
        defaultSort: [{ field: "created_at", direction: "asc" }],
        filters: {},
      }),
    ).toThrow(TypeError);
    expect(() =>
      createServerTableQuerySchema({
        sortFields: ["id"],
        defaultSort: [{ field: "createdAt", direction: "desc" }],
        filters: {},
      }),
    ).toThrow(TypeError);
    expect(() =>
      createServerTableQuerySchema({
        sortFields: ["id"],
        defaultSort: [{ field: "id", direction: "asc" }],
        filters: {},
        search: { minLength: 4, maxLength: 3 },
      }),
    ).toThrow(TypeError);
  });
});
