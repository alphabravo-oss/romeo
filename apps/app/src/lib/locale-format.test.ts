import { describe, expect, it } from "vitest";

import {
  formatBytes,
  formatCurrency,
  formatDateTime,
  formatNumber,
  formatTokens,
} from "./locale-format";

describe("locale-aware UI formatting", () => {
  it("formats numbers with locale-specific grouping and decimals", () => {
    expect(formatNumber(12_345.5, "en")).toBe("12,345.5");
    expect(formatNumber(12_345.5, "es")).toBe("12.345,5");
    expect(formatNumber(12_345.5, "fr")).toContain("12");
    expect(formatNumber(12_345.5, "fr")).toContain(",5");
  });

  it("formats bytes, tokens, and currency through the selected locale", () => {
    expect(formatBytes(1_500, "en")).toBe("1.5 kB");
    expect(formatBytes(1_500, "es")).toBe("1,5 kB");
    expect(formatTokens(12_000, "fr")).toContain("jetons");
    expect(formatCurrency(1.25, "es")).toContain("1,25");
  });

  it("formats the same instant without relying on the browser default locale", () => {
    const instant = "2026-07-16T15:30:00.000Z";
    expect(formatDateTime(instant, "en")).not.toBe(
      formatDateTime(instant, "fr"),
    );
  });
});
