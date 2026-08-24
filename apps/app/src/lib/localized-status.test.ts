import { describe, expect, it } from "vitest";

import { knownOperationalStatuses, localizedStatus } from "./localized-status";

describe("localized operational status", () => {
  it("maps every declared API status and contains unknown values", () => {
    const seen = new Set<string>();
    for (const status of knownOperationalStatuses) {
      const result = localizedStatus(status, (key) => {
        seen.add(key);
        return key;
      });
      expect(result).not.toBe("localizedStatusUnknown");
    }
    expect(seen.size).toBe(knownOperationalStatuses.length);
    expect(localizedStatus("future_status", (key) => key)).toBe(
      "localizedStatusUnknown",
    );
  });
});
