export interface CompareLegRequest {
  legId: string;
  modelId: string;
  providerId: string;
  authorized: boolean;
  estimatedMicroUsd: number;
}

export interface ComparePreflightInput {
  platformDisabled: boolean;
  maxLegs: number;
  maxAggregateMicroUsd: number;
  legs: CompareLegRequest[];
}

export type ComparePreflightResult =
  | {
      outcome: "accepted";
      estimatedMicroUsd: number;
      legIds: string[];
    }
  | {
      outcome: "denied";
      code:
        | "capability_platform_disabled"
        | "compare_preflight_failed"
        | "compare_cost_cap_exceeded";
      failedLegIds: string[];
    };

export function preflightCompareSession(
  input: ComparePreflightInput,
): ComparePreflightResult {
  if (input.platformDisabled)
    return {
      outcome: "denied",
      code: "capability_platform_disabled",
      failedLegIds: [],
    };
  if (input.legs.length === 0 || input.legs.length > input.maxLegs)
    return {
      outcome: "denied",
      code: "compare_preflight_failed",
      failedLegIds: input.legs.map((leg) => leg.legId),
    };
  const unauthorized = input.legs.filter((leg) => !leg.authorized);
  if (unauthorized.length > 0)
    return {
      outcome: "denied",
      code: "compare_preflight_failed",
      failedLegIds: unauthorized.map((leg) => leg.legId),
    };
  const estimatedMicroUsd = input.legs.reduce(
    (sum, leg) => sum + leg.estimatedMicroUsd,
    0,
  );
  if (estimatedMicroUsd > input.maxAggregateMicroUsd)
    return {
      outcome: "denied",
      code: "compare_cost_cap_exceeded",
      failedLegIds: [],
    };
  return {
    outcome: "accepted",
    estimatedMicroUsd,
    legIds: input.legs.map((leg) => leg.legId),
  };
}

export function recordCompareLegOutcome(input: {
  completedLegIds: string[];
  failedLegId?: string;
}): { completedLegIds: string[]; failedLegIds: string[]; partial: boolean } {
  return {
    completedLegIds: [...input.completedLegIds],
    failedLegIds: input.failedLegId === undefined ? [] : [input.failedLegId],
    partial: input.failedLegId !== undefined && input.completedLegIds.length > 0,
  };
}

export function compareIdempotencyFingerprint(input: {
  orgId: string;
  workspaceId: string;
  modelIds: string[];
  promptHash: string;
}): string {
  return [
    input.orgId,
    input.workspaceId,
    [...input.modelIds].sort().join(","),
    input.promptHash,
  ].join(":");
}
