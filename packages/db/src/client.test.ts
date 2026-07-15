import { describe, expect, it } from "vitest";

import { defaultDatabasePoolMax, normalizeDatabasePoolMax } from "./client";

describe("database client options", () => {
  it("keeps a bounded default pool size and validates overrides", () => {
    expect(defaultDatabasePoolMax).toBe(10);
    expect(normalizeDatabasePoolMax()).toBe(10);
    expect(normalizeDatabasePoolMax(3)).toBe(3);
    expect(() => normalizeDatabasePoolMax(0)).toThrow(
      "Database pool max must be a positive integer.",
    );
    expect(() => normalizeDatabasePoolMax(1.5)).toThrow(
      "Database pool max must be a positive integer.",
    );
  });
});
