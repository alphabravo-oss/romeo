// Recovery-code state derived from the local auth status. Extracted because the
// lockout condition -- MFA enabled with no usable recovery codes -- is invisible
// in the raw status object: the count lives on a sibling factor, not on the
// status, and its absence is indistinguishable from zero unless you look for
// the factor first.

export interface MfaFactorLike {
  type: "recovery_codes" | "totp";
  status: "pending" | "active" | "disabled";
  disabledAt?: string;
  recoveryCodeRemainingCount?: number;
}

export interface MfaRecoveryState {
  mfaEnabled: boolean;
  factors: readonly MfaFactorLike[];
}

export function recoveryCodesRemaining(state: MfaRecoveryState): number {
  const factor = state.factors.find(
    (item) => item.type === "recovery_codes" && item.disabledAt === undefined,
  );
  return factor?.recoveryCodeRemainingCount ?? 0;
}

/** True when the account can be permanently locked out by losing one device. */
export function isLockoutRisk(state: MfaRecoveryState): boolean {
  return state.mfaEnabled && recoveryCodesRemaining(state) === 0;
}
