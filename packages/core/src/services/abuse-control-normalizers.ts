import type { BillingPlan } from "../domain/entities";
import { ApiError } from "../errors";

const idPattern = /^[A-Za-z0-9_.:/@-]+$/u;

export function normalizeIdList(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new ApiError(
      "invalid_abuse_control_policy",
      `Abuse control ${field} must be an array.`,
      400,
    );
  }
  const ids = value.map((item) => {
    if (typeof item !== "string" || !isSafeValue(item)) {
      throw new ApiError(
        "invalid_abuse_control_policy",
        `Abuse control ${field} contains an invalid identifier.`,
        400,
      );
    }
    return item.trim();
  });
  return [...new Set(ids)].sort();
}

export function normalizeReasonCode(value: string): string {
  if (!isSafeValue(value)) {
    throw new ApiError(
      "invalid_abuse_control_policy",
      "Suspension reason code is invalid.",
      400,
    );
  }
  return value.trim();
}

export function uniqueBillingStatuses(
  values: unknown[],
): BillingPlan["status"][] {
  const statuses = values.filter(
    (value): value is BillingPlan["status"] =>
      value === "active" ||
      value === "canceled" ||
      value === "past_due" ||
      value === "trialing",
  );
  const unique = [...new Set(statuses)].sort();
  return unique.length === 0 ? ["active", "trialing"] : unique;
}

export function isSafeValue(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 200 && idPattern.test(trimmed);
}
