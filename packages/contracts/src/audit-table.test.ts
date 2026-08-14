import { describe, expect, it } from "vitest";

import { AuditLogTableQuerySchema } from "./operational-governance";

describe("audit table contract", () => {
  it("accepts only the explicit sort and filter allowlist", () => {
    expect(AuditLogTableQuerySchema.safeParse({}).success).toBe(true);
    expect(
      AuditLogTableQuerySchema.safeParse({
        sort: [{ field: "createdAt", direction: "asc" }],
        filters: [
          { field: "category", operator: "eq", value: "security" },
          {
            field: "createdAt",
            operator: "gte",
            value: "2026-08-14T00:00:00.000Z",
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      AuditLogTableQuerySchema.safeParse({
        sort: [{ field: "metadata", direction: "desc" }],
      }).success,
    ).toBe(false);
    expect(
      AuditLogTableQuerySchema.safeParse({
        filters: [{ field: "metadata", operator: "contains", value: "x" }],
      }).success,
    ).toBe(false);
    expect(AuditLogTableQuerySchema.safeParse({ limit: 201 }).success).toBe(
      false,
    );
    expect(AuditLogTableQuerySchema.safeParse({ search: "ab" }).success).toBe(
      false,
    );
    expect(AuditLogTableQuerySchema.safeParse({ search: "abc" }).success).toBe(
      true,
    );
  });
});
