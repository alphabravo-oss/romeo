import type { LocalMfaFactor } from "../domain/entities";
import type { LocalMfaMethod } from "./local-auth-types";

export interface LocalMfaPosture {
  factorCount: number;
  methods: LocalMfaMethod[];
}

export function summarizeLocalMfaPosture(
  factors: LocalMfaFactor[],
  recoveryCodeRemainingCount: (factor: LocalMfaFactor) => number | undefined,
): LocalMfaPosture {
  const activeTotpCount = factors.filter(
    (factor) => factor.type === "totp" && factor.status === "active",
  ).length;
  const activeRecoveryCount = factors.filter(
    (factor) =>
      factor.type === "recovery_codes" &&
      factor.status === "active" &&
      (recoveryCodeRemainingCount(factor) ?? 0) > 0,
  ).length;
  const methods: LocalMfaMethod[] = [];
  if (activeTotpCount > 0) methods.push("totp");
  if (activeRecoveryCount > 0) methods.push("recovery_code");
  return { factorCount: activeTotpCount + activeRecoveryCount, methods };
}
