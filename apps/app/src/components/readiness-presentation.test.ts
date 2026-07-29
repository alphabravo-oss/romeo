import { describe, expect, it } from "vitest";

import type { ReadinessCheck } from "../features/readiness";
import {
  orderReadinessChecks,
  summarizeReadinessChecks,
} from "./readiness-presentation";

function readinessCheck(
  id: string,
  status: ReadinessCheck["status"],
): ReadinessCheck {
  return {
    details: {},
    id,
    message: id,
    severity:
      status === "fail" ? "critical" : status === "warn" ? "warning" : "info",
    status,
  };
}

describe("readiness presentation", () => {
  it("reports the complete pass, warning, and failure breakdown", () => {
    expect(
      summarizeReadinessChecks([
        readinessCheck("passing", "pass"),
        readinessCheck("warning", "warn"),
        readinessCheck("failing-a", "fail"),
        readinessCheck("failing-b", "fail"),
      ]),
    ).toEqual({
      fail: 2,
      pass: 1,
      total: 4,
      tone: "fail",
      warn: 1,
    });
  });

  it("distinguishes warning-only, ready, and empty reports", () => {
    expect(
      summarizeReadinessChecks([readinessCheck("warning", "warn")]).tone,
    ).toBe("warn");
    expect(
      summarizeReadinessChecks([readinessCheck("passing", "pass")]).tone,
    ).toBe("pass");
    expect(summarizeReadinessChecks([]).tone).toBeUndefined();
  });

  it("orders failures and warnings before passing checks without mutation", () => {
    const checks = [
      readinessCheck("z-pass", "pass"),
      readinessCheck("b-fail", "fail"),
      readinessCheck("a-fail", "fail"),
      readinessCheck("warning", "warn"),
    ];

    expect(orderReadinessChecks(checks).map((check) => check.id)).toEqual([
      "a-fail",
      "b-fail",
      "warning",
      "z-pass",
    ]);
    expect(checks.map((check) => check.id)).toEqual([
      "z-pass",
      "b-fail",
      "a-fail",
      "warning",
    ]);
  });
});
