import type { ProviderTokenUsage, ProviderUsageParser } from "./types";

export const openAiCompatibleUsageParser: ProviderUsageParser = {
  kind: "openai-compatible",
  parseUsage: usageFromOpenAiPayload,
};

export const openAiResponsesCompatibleUsageParser: ProviderUsageParser = {
  kind: "openai-responses-compatible",
  parseUsage: usageFromOpenAiResponsesPayload,
};

export const ollamaUsageParser: ProviderUsageParser = {
  kind: "ollama",
  parseUsage: usageFromOllamaPayload,
};

export function usageFromOpenAiPayload(
  payload: unknown,
): ProviderTokenUsage | undefined {
  return normalizeProviderTokenUsage(payload, { source: "openai-compatible" });
}

export function usageFromOpenAiResponsesPayload(
  payload: unknown,
): ProviderTokenUsage | undefined {
  return normalizeProviderTokenUsage(payload, {
    source: "openai-responses-compatible",
  });
}

export function usageFromOllamaPayload(
  payload: unknown,
): ProviderTokenUsage | undefined {
  return normalizeProviderTokenUsage(payload, { source: "ollama" });
}

export function normalizeProviderTokenUsage(
  payload: unknown,
  options: { source?: string } = {},
): ProviderTokenUsage | undefined {
  const usage = usageRecord(payload);
  if (usage === undefined) return undefined;

  const inputTokens = integerField(usage, [
    "inputTokens",
    "input_tokens",
    "promptTokens",
    "prompt_tokens",
    "prompt_eval_count",
  ]);
  const outputTokens = integerField(usage, [
    "outputTokens",
    "output_tokens",
    "completionTokens",
    "completion_tokens",
    "eval_count",
  ]);
  const cachedInputTokens =
    integerField(usage, ["cachedInputTokens", "cached_input_tokens"]) ??
    nestedIntegerField(usage, [
      ["input_tokens_details", "cached_tokens"],
      ["prompt_tokens_details", "cached_tokens"],
    ]);
  const reportedReasoningTokens =
    integerField(usage, ["reasoningTokens", "reasoning_tokens"]) ??
    nestedIntegerField(usage, [
      ["output_tokens_details", "reasoning_tokens"],
      ["completion_tokens_details", "reasoning_tokens"],
    ]);
  const reasoningTokens =
    reportedReasoningTokens !== undefined &&
    (outputTokens === undefined || reportedReasoningTokens <= outputTokens)
      ? reportedReasoningTokens
      : undefined;
  const reportedTotalTokens = integerField(usage, [
    "totalTokens",
    "total_tokens",
  ]);
  // Keep the provider's total distinct from a locally derived sum. Callers can
  // add input + output for display when no total was reported, but persisting
  // that inference as `llm.total_token.reported` would overstate its provenance.
  const totalTokens = reportedTotalTokens;
  if (
    inputTokens === undefined &&
    cachedInputTokens === undefined &&
    outputTokens === undefined &&
    reasoningTokens === undefined &&
    totalTokens === undefined
  )
    return undefined;

  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(options.source === undefined ? {} : { source: options.source }),
  };
}

function nestedIntegerField(
  record: Record<string, unknown>,
  paths: ReadonlyArray<readonly [string, string]>,
): number | undefined {
  for (const [parent, child] of paths) {
    const nested = record[parent];
    if (!isRecord(nested)) continue;
    const value = nested[child];
    if (Number.isInteger(value) && Number(value) >= 0) return Number(value);
  }
  return undefined;
}

function usageRecord(payload: unknown): Record<string, unknown> | undefined {
  if (!isRecord(payload)) return undefined;
  if (isRecord(payload.usage)) return payload.usage;
  if (isRecord(payload.response) && isRecord(payload.response.usage))
    return payload.response.usage;
  if (isRecord(payload.data)) {
    if (isRecord(payload.data.usage)) return payload.data.usage;
    if (
      isRecord(payload.data.response) &&
      isRecord(payload.data.response.usage)
    )
      return payload.data.response.usage;
  }
  return payload;
}

function integerField(
  record: Record<string, unknown>,
  names: string[],
): number | undefined {
  for (const name of names) {
    const value = record[name];
    if (Number.isInteger(value) && Number(value) >= 0) return Number(value);
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
