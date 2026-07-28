import type { LocalMfaFactor } from "../domain/entities";
import type { LocalMfaFactorSummary } from "./local-auth-types";

export function toFactorSummary(
  factor: LocalMfaFactor,
  recoveryCodeRemainingCount?: number,
): LocalMfaFactorSummary {
  return {
    id: factor.id,
    type: factor.type,
    name: normalizeFactorName(factor.name),
    status: factor.status,
    createdAt: factor.createdAt,
    ...(factor.confirmedAt === undefined
      ? {}
      : { confirmedAt: factor.confirmedAt }),
    ...(factor.disabledAt === undefined
      ? {}
      : { disabledAt: factor.disabledAt }),
    ...(factor.lastUsedAt === undefined
      ? {}
      : { lastUsedAt: factor.lastUsedAt }),
    ...(recoveryCodeRemainingCount === undefined
      ? {}
      : { recoveryCodeRemainingCount }),
  };
}

export function normalizeFactorName(name: string | undefined): string {
  const normalized = name?.trim();
  return normalized === undefined || normalized.length === 0
    ? "Authenticator"
    : normalized.slice(0, 80);
}
