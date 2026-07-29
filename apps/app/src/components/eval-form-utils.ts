import type { EvalResultHumanRatingValue } from "../features/types";

export function evalRatingKey(
  rating: EvalResultHumanRatingValue,
): "evalFail" | "evalNeutral" | "evalPass" {
  if (rating === "pass") return "evalPass";
  if (rating === "neutral") return "evalNeutral";
  return "evalFail";
}

export function rubricFromInput(
  mustContain: string,
  mustNotContain: string,
  expectedTools: string,
  requiredCitations: string,
) {
  const contain = terms(mustContain);
  const notContain = terms(mustNotContain);
  const tools = terms(expectedTools);
  const citations = terms(requiredCitations);
  if (
    contain.length === 0 &&
    notContain.length === 0 &&
    tools.length === 0 &&
    citations.length === 0
  )
    return undefined;
  return {
    ...(contain.length > 0 ? { mustContain: contain } : {}),
    ...(notContain.length > 0 ? { mustNotContain: notContain } : {}),
    ...(tools.length > 0
      ? { expectedToolCalls: tools.map((name) => ({ name })) }
      : {}),
    ...(citations.length > 0 ? { requiredCitations: citations } : {}),
  };
}

function terms(value: string): string[] {
  return value
    .split(",")
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
}
