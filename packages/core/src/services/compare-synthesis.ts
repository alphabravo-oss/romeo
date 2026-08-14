export function authorizeCompareSynthesis(input: {
  candidateIds: string[];
  candidateHashes: string[];
  providerAuthorized: boolean;
  policyChecked: boolean;
}):
  | {
      outcome: "accepted";
      citations: Array<{ candidateId: string; hash: string }>;
    }
  | { outcome: "denied"; code: "capability_platform_disabled" } {
  if (!input.providerAuthorized || !input.policyChecked)
    return { outcome: "denied", code: "capability_platform_disabled" };
  if (
    input.candidateIds.length === 0 ||
    input.candidateIds.length !== input.candidateHashes.length
  )
    return { outcome: "denied", code: "capability_platform_disabled" };
  return {
    outcome: "accepted",
    citations: input.candidateIds.map((candidateId, index) => ({
      candidateId,
      hash: input.candidateHashes[index]!,
    })),
  };
}

export function promoteCompareEvalCase(input: {
  authorized: boolean;
  prompt: string;
  preference: "a" | "b" | "tie";
  retainAllCandidates: boolean;
}):
  | {
      outcome: "accepted";
      case: { promptLength: number; preference: "a" | "b" | "tie" };
    }
  | { outcome: "denied"; code: "capability_not_allowed" } {
  if (!input.authorized || input.retainAllCandidates)
    return { outcome: "denied", code: "capability_not_allowed" };
  return {
    outcome: "accepted",
    case: { promptLength: input.prompt.length, preference: input.preference },
  };
}

export function summarizeCompareCost(input: {
  estimatedMicroUsd: number;
  policyCapMicroUsd: number;
  legs: Array<{ legId: string; actualMicroUsd: number }>;
}):
  | {
      outcome: "accepted";
      estimatedMicroUsd: number;
      policyCapMicroUsd: number;
      actualMicroUsd: number;
      legs: Array<{ legId: string; actualMicroUsd: number }>;
    }
  | { outcome: "denied"; code: "compare_cost_cap_exceeded" } {
  if (input.estimatedMicroUsd > input.policyCapMicroUsd)
    return { outcome: "denied", code: "compare_cost_cap_exceeded" };
  const actualMicroUsd = input.legs.reduce(
    (sum, leg) => sum + Math.max(0, leg.actualMicroUsd),
    0,
  );
  return {
    outcome: "accepted",
    estimatedMicroUsd: input.estimatedMicroUsd,
    policyCapMicroUsd: input.policyCapMicroUsd,
    actualMicroUsd,
    legs: input.legs.map((leg) => ({
      legId: leg.legId,
      actualMicroUsd: Math.max(0, leg.actualMicroUsd),
    })),
  };
}
