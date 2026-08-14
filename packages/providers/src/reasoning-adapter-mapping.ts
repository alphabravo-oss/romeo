import type { ProviderKind } from "./types";

export interface NativeReasoningMapping {
  effort?: "low" | "medium" | "high";
  summary?: "auto" | "concise" | "detailed";
  budgetTokens?: number;
}

export function mapReasoningToNativeAdapter(input: {
  kind: ProviderKind;
  effort?: "low" | "medium" | "high";
  summary?: "auto" | "concise" | "detailed";
  maxReasoningTokens?: number;
  capabilities?: { reasoning?: boolean };
}):
  | { outcome: "mapped"; native: Record<string, unknown> }
  | {
      outcome: "omitted";
      reason: "unsupported_by_dialect" | "capability_opt_in_required";
    } {
  const requested: NativeReasoningMapping = {
    ...(input.effort === undefined ? {} : { effort: input.effort }),
    ...(input.summary === undefined ? {} : { summary: input.summary }),
    ...(input.maxReasoningTokens === undefined
      ? {}
      : { budgetTokens: input.maxReasoningTokens }),
  };
  if (Object.keys(requested).length === 0)
    return { outcome: "omitted", reason: "unsupported_by_dialect" };
  if (input.kind === "openai-compatible")
    return requested.effort === undefined
      ? { outcome: "omitted", reason: "unsupported_by_dialect" }
      : { outcome: "mapped", native: { reasoning_effort: requested.effort } };
  if (input.kind === "openai-responses-compatible")
    return {
      outcome: "mapped",
      native: {
        reasoning: {
          ...(requested.effort === undefined ? {} : { effort: requested.effort }),
          ...(requested.summary === undefined
            ? {}
            : { summary: requested.summary }),
        },
      },
    };
  if (input.capabilities?.reasoning !== true)
    return { outcome: "omitted", reason: "capability_opt_in_required" };
  return {
    outcome: "mapped",
    native: {
      ...(requested.effort === undefined
        ? {}
        : { reasoning_effort: requested.effort }),
      ...(requested.budgetTokens === undefined
        ? {}
        : { thinking_budget: requested.budgetTokens }),
    },
  };
}

export function nativeReasoningBody(
  kind: ProviderKind,
  reasoning?: {
    effort?: "low" | "medium" | "high";
    summary?: "auto" | "concise" | "detailed";
    maxReasoningTokens?: number;
  },
  capabilities?: { reasoning?: boolean },
): Record<string, unknown> {
  const mapped = mapReasoningToNativeAdapter({
    kind,
    ...(reasoning?.effort === undefined ? {} : { effort: reasoning.effort }),
    ...(reasoning?.summary === undefined ? {} : { summary: reasoning.summary }),
    ...(reasoning?.maxReasoningTokens === undefined
      ? {}
      : { maxReasoningTokens: reasoning.maxReasoningTokens }),
    ...(capabilities === undefined ? {} : { capabilities }),
  });
  return mapped.outcome === "mapped" ? mapped.native : {};
}
