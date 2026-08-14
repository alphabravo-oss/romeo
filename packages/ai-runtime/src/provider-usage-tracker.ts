import type { ProviderTokenUsage } from "@romeo/providers";

import type { ProviderFallbackTarget } from "./run-executor-types";

export interface ProviderUsageSegment {
  modelId: string;
  providerId: string;
  usage: ProviderTokenUsage;
}

export class ProviderUsageTracker {
  private current: ProviderUsageSegment | undefined;
  private readonly completed: ProviderUsageSegment[] = [];

  observe(target: ProviderFallbackTarget, usage: ProviderTokenUsage): void {
    const merged = { ...this.current?.usage, ...usage };
    if (
      merged.reasoningTokens !== undefined &&
      merged.outputTokens !== undefined &&
      merged.reasoningTokens > merged.outputTokens
    )
      delete merged.reasoningTokens;
    this.current = {
      modelId: target.model.id,
      providerId: target.provider.id,
      usage: merged,
    };
  }

  finishAttempt(): void {
    if (this.current === undefined) return;
    this.completed.push(this.current);
    this.current = undefined;
  }

  currentUsage(): ProviderTokenUsage | undefined {
    return this.current === undefined ? undefined : { ...this.current.usage };
  }

  evidence(): {
    usage?: ProviderTokenUsage;
    usageSegments?: ProviderUsageSegment[];
  } {
    this.finishAttempt();
    if (this.completed.length === 0) return {};
    return {
      usage: aggregateUsage(this.completed),
      usageSegments: this.completed.map((segment) => ({
        ...segment,
        usage: { ...segment.usage },
      })),
    };
  }
}

function aggregateUsage(
  segments: readonly ProviderUsageSegment[],
): ProviderTokenUsage {
  const result: ProviderTokenUsage = {};
  for (const field of [
    "inputTokens",
    "cachedInputTokens",
    "outputTokens",
    "reasoningTokens",
    "totalTokens",
  ] as const) {
    const values = segments.map((segment) => segment.usage[field]);
    if (values.every((value): value is number => value !== undefined))
      result[field] = values.reduce((sum, value) => sum + value, 0);
  }
  const sources = new Set(segments.map((segment) => segment.usage.source));
  const source = segments[0]!.usage.source;
  if (sources.size === 1 && source !== undefined) result.source = source;
  return result;
}
