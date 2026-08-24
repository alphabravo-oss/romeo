import { describe, expect, it, vi } from "vitest";

import {
  formatBytes,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatTokens,
  formatUnit,
  formatterCacheStats,
  resetFormatterCaches,
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
    expect(formatTokens(1, "fr")).toContain("jeton");
    expect(formatTokens(0, "fr")).toContain("jetons");
    expect(formatPercent(-0.125, "fr")).toContain("12,5");
    expect(formatUnit(1.5, "es", "second")).toContain("1,5");
  });

  it("formats the same instant without relying on the browser default locale", () => {
    const instant = "2026-07-16T15:30:00.000Z";
    expect(formatDateTime(instant, "en")).not.toBe(
      formatDateTime(instant, "fr"),
    );
    expect(formatDateTime(instant, "en", { timeZone: "UTC" })).not.toBe(
      formatDateTime(instant, "en", { timeZone: "America/New_York" }),
    );
  });

  it("contains malformed dates at the display boundary and reports trace context", () => {
    const reportInvalid = vi.fn();
    expect(
      formatDateTime("", "en", {
        reportInvalid,
        traceId: "trace-1",
        unknownLabel: "Unknown date",
      }),
    ).toBe("Unknown date");
    expect(formatDate(Number.NaN, "es", { unknownLabel: "Desconocida" })).toBe(
      "Desconocida",
    );
    expect(formatDate(9e15, "fr", { unknownLabel: "Inconnue" })).toBe(
      "Inconnue",
    );
    expect(reportInvalid).toHaveBeenCalledWith({
      traceId: "trace-1",
      value: "",
    });
  });

  it("reuses formatter instances without allowing unbounded option keys", () => {
    resetFormatterCaches();
    formatDateTime("2026-07-16T15:30:00.000Z", "en");
    formatDateTime("2026-07-17T15:30:00.000Z", "en");
    formatNumber(1, "en", { maximumFractionDigits: 1 });
    formatNumber(2, "en", { maximumFractionDigits: 1 });
    expect(formatterCacheStats()).toMatchObject({ date: 1, number: 1 });

    for (let digits = 0; digits < 40; digits += 1) {
      formatNumber(1, digits % 2 === 0 ? "en" : "fr", {
        minimumIntegerDigits: (digits % 20) + 1,
        signDisplay: digits % 3 === 0 ? "always" : "auto",
      });
    }
    expect(formatterCacheStats().number).toBeLessThanOrEqual(
      formatterCacheStats().limit,
    );
  });
});
