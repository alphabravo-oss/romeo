import type { RunEvent } from "@romeo/ai-runtime";
import type { ProviderTokenUsage } from "@romeo/providers";

export interface RunProviderUsageSegment {
  modelId: string;
  providerId: string;
  usage: ProviderTokenUsage;
}

export function providerUsageSegmentsFromEvents(
  events: readonly RunEvent[],
): RunProviderUsageSegment[] {
  return events.flatMap((event) => {
    const data = record(event.data);
    if (!Array.isArray(data?.usageSegments)) return [];
    return data.usageSegments.slice(0, 100).flatMap(segmentFromUnknown);
  });
}

function segmentFromUnknown(value: unknown): RunProviderUsageSegment[] {
  const segment = record(value);
  const modelId = boundedIdentifier(segment?.modelId);
  const providerId = boundedIdentifier(segment?.providerId);
  const usage = usageFromUnknown(segment?.usage);
  return modelId === undefined ||
    providerId === undefined ||
    usage === undefined
    ? []
    : [{ modelId, providerId, usage }];
}

function usageFromUnknown(value: unknown): ProviderTokenUsage | undefined {
  const raw = record(value);
  if (raw === undefined) return undefined;
  const usage: ProviderTokenUsage = {};
  for (const field of [
    "inputTokens",
    "cachedInputTokens",
    "outputTokens",
    "reasoningTokens",
    "totalTokens",
  ] as const) {
    const count = raw[field];
    if (Number.isSafeInteger(count) && (count as number) >= 0)
      usage[field] = count as number;
  }
  const source = raw.source;
  if (
    source === "anthropic" ||
    source === "ollama" ||
    source === "openai-compatible" ||
    source === "openai-responses-compatible"
  )
    usage.source = source;
  if (
    usage.reasoningTokens !== undefined &&
    (usage.outputTokens === undefined ||
      usage.reasoningTokens > usage.outputTokens)
  )
    delete usage.reasoningTokens;
  return Object.keys(usage).length === 0 ? undefined : usage;
}

function boundedIdentifier(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 300
    ? value
    : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
