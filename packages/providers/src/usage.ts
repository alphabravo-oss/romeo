import type { ProviderTokenUsage } from "./types";

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
  const reportedTotalTokens = integerField(usage, [
    "totalTokens",
    "total_tokens",
  ]);
  const totalTokens =
    reportedTotalTokens ?? sumIfBothPresent(inputTokens, outputTokens);
  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined
  )
    return undefined;

  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(options.source === undefined ? {} : { source: options.source }),
  };
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

function sumIfBothPresent(
  left: number | undefined,
  right: number | undefined,
): number | undefined {
  if (left === undefined || right === undefined) return undefined;
  return left + right;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
