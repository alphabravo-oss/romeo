import type { ReadinessCheck } from "../features/readiness";

export interface ReadinessSummary {
  fail: number;
  pass: number;
  total: number;
  tone: "fail" | "pass" | "warn" | undefined;
  warn: number;
}

export function summarizeReadinessChecks(
  checks: readonly ReadinessCheck[],
): ReadinessSummary {
  let fail = 0;
  let pass = 0;
  let warn = 0;
  for (const check of checks) {
    if (check.status === "pass") pass += 1;
    else if (check.status === "warn") warn += 1;
    else fail += 1;
  }
  return {
    fail,
    pass,
    total: checks.length,
    tone:
      checks.length === 0
        ? undefined
        : fail > 0
          ? "fail"
          : warn > 0
            ? "warn"
            : "pass",
    warn,
  };
}

const statusRank: Record<ReadinessCheck["status"], number> = {
  fail: 0,
  warn: 1,
  pass: 2,
};

export function orderReadinessChecks(
  checks: readonly ReadinessCheck[],
): ReadinessCheck[] {
  return [...checks].sort(
    (left, right) =>
      statusRank[left.status] - statusRank[right.status] ||
      left.id.localeCompare(right.id),
  );
}
