import { providerReasoningPolicyFromUnknown } from "@romeo/providers";

import type { EvalRunRecord } from "./eval-records";

export function evalRunEvidenceFromUnknown(input: {
  reasoningPolicy: unknown;
  metrics: unknown;
}): Pick<EvalRunRecord, "reasoningPolicy" | "metrics"> {
  const reasoningPolicy = asReasoningPolicyEvidence(input.reasoningPolicy);
  const metrics = asEvalRunMetrics(input.metrics);
  return {
    ...(reasoningPolicy === undefined ? {} : { reasoningPolicy }),
    ...(metrics === undefined ? {} : { metrics }),
  };
}

function asReasoningPolicyEvidence(
  value: unknown,
): EvalRunRecord["reasoningPolicy"] {
  const evidence = asRecord(value);
  if (
    evidence === undefined ||
    !hasExactKeys(evidence, ["requested", "effective"])
  )
    return undefined;
  const requested = providerReasoningPolicyFromUnknown(evidence.requested);
  const effective = providerReasoningPolicyFromUnknown(evidence.effective);
  return requested === undefined || effective === undefined
    ? undefined
    : { requested, effective };
}

function asEvalRunMetrics(value: unknown): EvalRunRecord["metrics"] {
  const metrics = asRecord(value);
  if (
    metrics === undefined ||
    !hasRequiredAndAllowedKeys(
      metrics,
      ["latencyMs", "usage", "costBasis"],
      ["latencyMs", "usage", "costBasis", "estimatedCostUsd"],
    ) ||
    !boundedInteger(metrics.latencyMs, 0, 86_400_000) ||
    (metrics.costBasis !== "reported_tokens" &&
      metrics.costBasis !== "unavailable") ||
    (metrics.estimatedCostUsd !== undefined &&
      !boundedNumber(metrics.estimatedCostUsd, 0, 1_000_000)) ||
    (metrics.costBasis === "reported_tokens") !==
      (metrics.estimatedCostUsd !== undefined)
  )
    return undefined;
  const usage = asEvalRunUsage(metrics.usage);
  if (usage === undefined) return undefined;
  if (
    metrics.costBasis === "reported_tokens" &&
    (usage.coverage !== "complete" ||
      usage.inputTokens === undefined ||
      usage.outputTokens === undefined)
  )
    return undefined;
  return {
    latencyMs: metrics.latencyMs,
    usage,
    costBasis: metrics.costBasis,
    ...(metrics.estimatedCostUsd === undefined
      ? {}
      : { estimatedCostUsd: metrics.estimatedCostUsd }),
  };
}

function asEvalRunUsage(
  value: unknown,
): NonNullable<EvalRunRecord["metrics"]>["usage"] | undefined {
  const usage = asRecord(value);
  if (
    usage === undefined ||
    !hasRequiredAndAllowedKeys(
      usage,
      ["coverage"],
      ["coverage", "inputTokens", "outputTokens", "reasoningTokens", "source"],
    ) ||
    (usage.coverage !== "complete" &&
      usage.coverage !== "partial" &&
      usage.coverage !== "none")
  )
    return undefined;
  for (const field of [
    "inputTokens",
    "outputTokens",
    "reasoningTokens",
  ] as const)
    if (
      usage[field] !== undefined &&
      !boundedInteger(usage[field], 0, 2_000_000_000)
    )
      return undefined;
  const inputTokens = optionalBoundedInteger(usage.inputTokens);
  const outputTokens = optionalBoundedInteger(usage.outputTokens);
  const reasoningTokens = optionalBoundedInteger(usage.reasoningTokens);
  if (
    (usage.coverage === "complete" &&
      (inputTokens === undefined || outputTokens === undefined)) ||
    (usage.coverage === "none" &&
      (inputTokens !== undefined ||
        outputTokens !== undefined ||
        reasoningTokens !== undefined ||
        usage.source !== undefined))
  )
    return undefined;
  if (
    reasoningTokens !== undefined &&
    (outputTokens === undefined || reasoningTokens > outputTokens)
  )
    return undefined;
  if (
    usage.source !== undefined &&
    ![
      "anthropic",
      "ollama",
      "openai-compatible",
      "openai-responses-compatible",
    ].includes(usage.source as string)
  )
    return undefined;
  return {
    coverage: usage.coverage,
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    ...(usage.source === undefined
      ? {}
      : {
          source: usage.source as NonNullable<
            NonNullable<EvalRunRecord["metrics"]>["usage"]["source"]
          >,
        }),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function hasRequiredAndAllowedKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  allowed: readonly string[],
) {
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.includes(key))
  );
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= minimum &&
    (value as number) <= maximum
  );
}

function optionalBoundedInteger(value: unknown): number | undefined {
  return boundedInteger(value, 0, 2_000_000_000) ? value : undefined;
}

function boundedNumber(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}
