export interface CompareReviewIdentity {
  legId: string;
  modelId: string;
  providerId: string;
}

export function projectCompareBlinding(input: {
  identities: CompareReviewIdentity[];
  reveal: boolean;
}): Array<{
  legId: string;
  modelId?: string;
  providerId?: string;
  blinded: boolean;
}> {
  return input.identities.map((identity) =>
    input.reveal
      ? {
          legId: identity.legId,
          modelId: identity.modelId,
          providerId: identity.providerId,
          blinded: false,
        }
      : { legId: identity.legId, blinded: true },
  );
}

export function applyCompareGroupCancel(input: {
  legs: Array<{
    legId: string;
    state: "queued" | "running" | "completed" | "failed" | "cancelled";
  }>;
}): Array<{
  legId: string;
  state: "queued" | "running" | "completed" | "failed" | "cancelled";
  retryable: boolean;
}> {
  return input.legs.map((leg) => {
    if (leg.state === "completed" || leg.state === "failed")
      return { ...leg, retryable: false };
    return { legId: leg.legId, state: "cancelled", retryable: false };
  });
}

export interface EvalRubric {
  version: string;
  dimensions: Array<"helpfulness" | "correctness" | "citations" | "safety" | "cost" | "latency">;
}

export function scoreEvalRubric(input: {
  rubric: EvalRubric;
  scores: Partial<Record<EvalRubric["dimensions"][number], number>>;
  notes?: string;
}): {
  version: string;
  scores: Partial<Record<EvalRubric["dimensions"][number], number>>;
  noteLength: number;
} {
  const scores: Partial<Record<EvalRubric["dimensions"][number], number>> = {};
  for (const dimension of input.rubric.dimensions) {
    const value = input.scores[dimension];
    if (typeof value === "number" && value >= 0 && value <= 1)
      scores[dimension] = value;
  }
  return {
    version: input.rubric.version,
    scores,
    noteLength: input.notes?.length ?? 0,
  };
}
