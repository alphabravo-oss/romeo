import type { ProviderReasoningParameters } from "./chat-parameter-types";
import type { BaseModel, ProviderInstance, ProviderKind } from "./types";

export type ProviderReasoningPolicyMode = "auto" | "off" | "summary";
export type ProviderReasoningSummaryDetail = "brief" | "detailed" | "standard";

export type ProviderReasoningPolicy =
  | { schemaVersion: 1; mode: "off" }
  | {
      schemaVersion: 1;
      mode: "auto";
      effort?: "high" | "low" | "medium" | undefined;
      maxReasoningTokens?: number | undefined;
    }
  | {
      schemaVersion: 1;
      mode: "summary";
      effort?: "high" | "low" | "medium" | undefined;
      maxReasoningTokens?: number | undefined;
      summaryDetail?: ProviderReasoningSummaryDetail | undefined;
      retainSummary: boolean;
    };

export interface ProviderReasoningPolicyLayers {
  agentDefault?: ProviderReasoningPolicy;
  organizationMaximum?: ProviderReasoningPolicy;
  runRequest?: ProviderReasoningPolicy;
}

export interface ProviderReasoningPolicyAdjustment {
  parameter:
    | "effort"
    | "maxReasoningTokens"
    | "mode"
    | "retainSummary"
    | "summaryDetail";
  reason:
    | "capped_by_governance"
    | "summary_persistence_not_implemented"
    | "unsupported_by_dialect"
    | "unsupported_by_model_or_provider";
}

export interface ProviderReasoningPolicyResolution {
  adjustments: readonly ProviderReasoningPolicyAdjustment[];
  effective: ProviderReasoningPolicy;
  nativeParameters?: ProviderReasoningParameters;
  /**
   * True when the policy could not be honoured, which the caller turns into a
   * 400. A `capped_by_governance` adjustment that lands inside the same mode is
   * NOT a rejection: `effective` carries the clamped policy and the run should
   * proceed at the lower setting. Treating every adjustment as a rejection made
   * each organization maximum hard-fail instead of capping and left the whole
   * clamp path unreachable. A cap that drives mode to "off" still rejects,
   * since the caller asked for reasoning and governance denies it outright.
   */
  rejected: boolean;
  requested: ProviderReasoningPolicy;
  source: "agent_default" | "run_request";
}

const dialectSupport = {
  anthropic: { effort: false, summary: false, tokenBudget: false },
  ollama: { effort: false, summary: false, tokenBudget: false },
  "openai-compatible": { effort: true, summary: false, tokenBudget: false },
  "openai-responses-compatible": {
    effort: true,
    summary: true,
    tokenBudget: false,
  },
} as const satisfies Record<
  ProviderKind,
  { effort: boolean; summary: boolean; tokenBudget: boolean }
>;

export function resolveProviderReasoningPolicy(input: {
  kind: ProviderKind;
  layers: ProviderReasoningPolicyLayers;
  model: BaseModel;
  provider: ProviderInstance;
}): ProviderReasoningPolicyResolution | undefined {
  const selected = input.layers.runRequest ?? input.layers.agentDefault;
  if (selected === undefined) return undefined;
  const source =
    input.layers.runRequest === undefined ? "agent_default" : "run_request";
  const requested = normalizePolicy(selected);
  const adjustments: ProviderReasoningPolicyAdjustment[] = [];
  let effective = applyOrganizationMaximum(
    requested,
    input.layers.organizationMaximum,
    adjustments,
  );
  if (effective.mode !== "off" && !supportsReasoning(input)) {
    adjustments.push({
      parameter: "mode",
      reason: "unsupported_by_model_or_provider",
    });
    effective = offPolicy;
  }
  const support = dialectSupport[input.kind];
  if (effective.mode === "summary" && !support.summary) {
    adjustments.push({ parameter: "mode", reason: "unsupported_by_dialect" });
    effective = offPolicy;
  }
  if (effective.mode !== "off" && !support.effort) {
    adjustments.push({ parameter: "mode", reason: "unsupported_by_dialect" });
    effective = offPolicy;
  }
  if (
    effective.mode !== "off" &&
    effective.maxReasoningTokens !== undefined &&
    !support.tokenBudget
  ) {
    if (policyTokenBudget(requested) === undefined) {
      // Ceiling inherited from the organization maximum, which every default
      // configuration carries. The caller never asked for a token budget and no
      // dialect can express one natively, so drop the field rather than
      // disabling reasoning outright -- nothing the caller requested changed.
      // Once a dialect declares tokenBudget support the ceiling binds normally.
      effective = withoutTokenBudget(effective);
    } else {
      // A maximum the caller explicitly asked for is a safety constraint, not
      // an optional hint: fail closed rather than run unbounded.
      adjustments.push({
        parameter: "maxReasoningTokens",
        reason: "unsupported_by_dialect",
      });
      effective = offPolicy;
    }
  }
  const nativeParameters = nativeReasoningParameters(effective);
  // A governance cap that lands inside the same mode is enforceable, so the run
  // proceeds at the lower setting. A cap that takes the mode all the way to
  // "off" is not a cap at all -- the caller asked for reasoning and governance
  // denies it outright, which the caller must see rather than silently getting
  // a non-reasoning run.
  const governanceDisabled =
    requested.mode !== "off" && effective.mode === "off";
  return Object.freeze({
    adjustments: Object.freeze(adjustments),
    effective: Object.freeze(effective),
    ...(nativeParameters === undefined ? {} : { nativeParameters }),
    rejected:
      governanceDisabled ||
      adjustments.some(
        (adjustment) => adjustment.reason !== "capped_by_governance",
      ),
    requested: Object.freeze(requested),
    source,
  });
}

/** Strict parser for durable policy snapshots. Unknown or future shapes fail closed. */
export function providerReasoningPolicyFromUnknown(
  value: unknown,
): ProviderReasoningPolicy | undefined {
  const policy = record(value);
  if (policy?.schemaVersion !== 1) return undefined;
  if (policy.mode === "off") {
    return Object.keys(policy).every((key) =>
      ["schemaVersion", "mode"].includes(key),
    )
      ? { schemaVersion: 1, mode: "off" }
      : undefined;
  }
  if (policy.mode !== "auto" && policy.mode !== "summary") return undefined;
  if (
    !optionalEffort(policy.effort) ||
    !optionalTokenMaximum(policy.maxReasoningTokens)
  )
    return undefined;
  const shared = {
    schemaVersion: 1 as const,
    ...(policy.effort === undefined ? {} : { effort: policy.effort }),
    ...(policy.maxReasoningTokens === undefined
      ? {}
      : { maxReasoningTokens: policy.maxReasoningTokens }),
  };
  if (policy.mode === "auto") {
    return Object.keys(policy).every((key) =>
      ["schemaVersion", "mode", "effort", "maxReasoningTokens"].includes(key),
    )
      ? { ...shared, mode: "auto" }
      : undefined;
  }
  if (
    typeof policy.retainSummary !== "boolean" ||
    (policy.summaryDetail !== undefined &&
      policy.summaryDetail !== "brief" &&
      policy.summaryDetail !== "standard" &&
      policy.summaryDetail !== "detailed") ||
    !Object.keys(policy).every((key) =>
      [
        "schemaVersion",
        "mode",
        "effort",
        "maxReasoningTokens",
        "summaryDetail",
        "retainSummary",
      ].includes(key),
    )
  )
    return undefined;
  return {
    ...shared,
    mode: "summary",
    ...(policy.summaryDetail === undefined
      ? {}
      : { summaryDetail: policy.summaryDetail }),
    retainSummary: policy.retainSummary,
  };
}

function applyOrganizationMaximum(
  requested: ProviderReasoningPolicy,
  maximum: ProviderReasoningPolicy | undefined,
  adjustments: ProviderReasoningPolicyAdjustment[],
): ProviderReasoningPolicy {
  if (maximum === undefined || requested.mode === "off") return requested;
  const normalizedMaximum = normalizePolicy(maximum);
  if (modeRank(requested.mode) > modeRank(normalizedMaximum.mode)) {
    adjustments.push({
      parameter: "mode",
      reason: "capped_by_governance",
    });
  }
  const mode = lowerMode(requested.mode, normalizedMaximum.mode);
  if (mode === "off") return offPolicy;
  const effort = lowerEffort(
    requested.effort ?? "medium",
    normalizedMaximum.mode === "off"
      ? undefined
      : (normalizedMaximum.effort ?? "medium"),
  );
  if (effort !== requested.effort) {
    adjustments.push({
      parameter: "effort",
      reason: "capped_by_governance",
    });
  }
  const maxReasoningTokens = lowerPositiveInteger(
    requested.maxReasoningTokens,
    normalizedMaximum.mode === "off"
      ? undefined
      : normalizedMaximum.maxReasoningTokens,
  );
  // Only a value the caller actually specified can be "capped". Inheriting the
  // organization ceiling on a request that omitted the field changes nothing
  // the caller asked for, and reporting it as an adjustment surfaced a cap in
  // the preview API that the dialect then dropped anyway.
  if (
    requested.maxReasoningTokens !== undefined &&
    maxReasoningTokens !== requested.maxReasoningTokens
  ) {
    adjustments.push({
      parameter: "maxReasoningTokens",
      reason: "capped_by_governance",
    });
  }
  if (mode === "auto") {
    return {
      schemaVersion: 1,
      mode,
      effort,
      ...(maxReasoningTokens === undefined ? {} : { maxReasoningTokens }),
    };
  }
  const summaryDetail = lowerSummaryDetail(
    requested.mode === "summary"
      ? (requested.summaryDetail ?? "standard")
      : "standard",
    normalizedMaximum.mode === "summary"
      ? (normalizedMaximum.summaryDetail ?? "standard")
      : "standard",
  );
  if (
    requested.mode === "summary" &&
    summaryDetail !== requested.summaryDetail
  ) {
    adjustments.push({
      parameter: "summaryDetail",
      reason: "capped_by_governance",
    });
  }
  const retainSummary =
    requested.mode === "summary" &&
    requested.retainSummary &&
    normalizedMaximum.mode === "summary" &&
    normalizedMaximum.retainSummary;
  if (
    requested.mode === "summary" &&
    retainSummary !== requested.retainSummary
  ) {
    adjustments.push({
      parameter: "retainSummary",
      reason: "capped_by_governance",
    });
  }
  return {
    schemaVersion: 1,
    mode,
    effort,
    ...(maxReasoningTokens === undefined ? {} : { maxReasoningTokens }),
    summaryDetail,
    retainSummary,
  };
}

function normalizePolicy(
  policy: ProviderReasoningPolicy,
): ProviderReasoningPolicy {
  if (policy.mode === "off") return offPolicy;
  const effort = policy.effort ?? "medium";
  if (policy.mode === "auto") {
    return {
      schemaVersion: 1,
      mode: "auto",
      effort,
      ...(policy.maxReasoningTokens === undefined
        ? {}
        : { maxReasoningTokens: policy.maxReasoningTokens }),
    };
  }
  return {
    schemaVersion: 1,
    mode: "summary",
    effort,
    ...(policy.maxReasoningTokens === undefined
      ? {}
      : { maxReasoningTokens: policy.maxReasoningTokens }),
    summaryDetail: policy.summaryDetail ?? "standard",
    retainSummary: policy.retainSummary,
  };
}

function nativeReasoningParameters(
  policy: ProviderReasoningPolicy,
): ProviderReasoningParameters | undefined {
  if (policy.mode === "off") return undefined;
  return {
    effort: policy.effort ?? "medium",
    ...(policy.mode === "summary"
      ? {
          summary:
            policy.summaryDetail === "brief"
              ? ("concise" as const)
              : policy.summaryDetail === "detailed"
                ? ("detailed" as const)
                : ("auto" as const),
        }
      : {}),
  };
}

function supportsReasoning(input: {
  model: BaseModel;
  provider: ProviderInstance;
}): boolean {
  return (
    input.provider.capabilities?.reasoning === true &&
    input.model.capabilities?.reasoning === true
  );
}

function optionalEffort(
  value: unknown,
): value is "high" | "low" | "medium" | undefined {
  return (
    value === undefined ||
    value === "low" ||
    value === "medium" ||
    value === "high"
  );
}

function optionalTokenMaximum(value: unknown): value is number | undefined {
  return (
    value === undefined ||
    (typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value > 0 &&
      value <= 200_000)
  );
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

const offPolicy = Object.freeze({
  schemaVersion: 1 as const,
  mode: "off" as const,
});
const effortRank = { low: 0, medium: 1, high: 2 } as const;
const modeRanks = { off: 0, auto: 1, summary: 2 } as const;
const summaryRanks = { brief: 0, standard: 1, detailed: 2 } as const;

function modeRank(mode: ProviderReasoningPolicyMode): number {
  return modeRanks[mode];
}

function lowerMode(
  requested: ProviderReasoningPolicyMode,
  maximum: ProviderReasoningPolicyMode,
): ProviderReasoningPolicyMode {
  return modeRank(requested) <= modeRank(maximum) ? requested : maximum;
}

function lowerEffort(
  requested: "high" | "low" | "medium",
  maximum: "high" | "low" | "medium" | undefined,
): "high" | "low" | "medium" {
  return maximum === undefined || effortRank[requested] <= effortRank[maximum]
    ? requested
    : maximum;
}

/** mode "off" carries no budget field, so narrow before reading it. */
function policyTokenBudget(
  policy: ProviderReasoningPolicy,
): number | undefined {
  return policy.mode === "off" ? undefined : policy.maxReasoningTokens;
}

function withoutTokenBudget(
  policy: ProviderReasoningPolicy,
): ProviderReasoningPolicy {
  if (policy.mode === "off") return policy;
  const { maxReasoningTokens: _dropped, ...rest } = policy;
  return rest;
}

function lowerPositiveInteger(
  requested: number | undefined,
  maximum: number | undefined,
): number | undefined {
  // Omitting the field is not an opt-out of the organization maximum. Falling
  // back to `maximum` mirrors lowerEffort, which defaults the request to
  // "medium" before comparing; returning undefined here made the org token cap
  // a no-op for every request that left maxReasoningTokens unset.
  if (requested === undefined) return maximum;
  return maximum === undefined ? requested : Math.min(requested, maximum);
}

function lowerSummaryDetail(
  requested: ProviderReasoningSummaryDetail,
  maximum: ProviderReasoningSummaryDetail,
): ProviderReasoningSummaryDetail {
  return summaryRanks[requested] <= summaryRanks[maximum] ? requested : maximum;
}
