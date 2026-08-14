import type { AuthSubject } from "@romeo/auth";
import {
  hiddenReasoningOmitted,
  providerSafeReasoningSummary,
  type RunEvent,
} from "@romeo/ai-runtime";

import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { enforceContentPolicyStrings } from "./content-policy-service";
import { persistReasoningSummary } from "./persist-reasoning-summary";

const MAX_SUMMARY_CHARACTERS = 20_000;
const MAX_DELTA_CHARACTERS = 4_096;
const MAX_DURATION_MS = 86_400_000;
const MAX_REASONING_TOKENS = 200_000;
const MAX_SUMMARY_DELTAS = 64;

/**
 * Holds a provider-safe summary until its complete, bounded text has passed
 * content policy. This deliberately trades token-live text for protection
 * against secrets split across provider chunks.
 */
export class ReasoningSummaryGovernor {
  private parts: string[] = [];
  private deltaEvents: RunEvent[] = [];
  private characterCount = 0;
  private discard = false;

  constructor(
    private readonly repository: RomeoRepository,
    private readonly subject: AuthSubject,
  ) {}

  async consume(event: RunEvent): Promise<RunEvent[]> {
    if (event.type === "reasoning.summary.delta") {
      this.buffer(event);
      return [];
    }
    if (event.type !== "reasoning.summary.completed") return [event];
    return this.complete(event);
  }

  private buffer(event: RunEvent): void {
    const data = record(event.data);
    if (
      data?.classification !== providerSafeReasoningSummary ||
      typeof data.text !== "string" ||
      this.deltaEvents.length >= MAX_SUMMARY_DELTAS ||
      this.characterCount + data.text.length > MAX_SUMMARY_CHARACTERS
    ) {
      this.discard = true;
      this.parts = [];
      this.deltaEvents = [];
      this.characterCount = 0;
      return;
    }
    if (this.discard) return;
    this.parts.push(data.text);
    this.deltaEvents.push(event);
    this.characterCount += data.text.length;
  }

  private async complete(event: RunEvent): Promise<RunEvent[]> {
    const data = record(event.data);
    const metadata = summaryMetadata(data);
    const summary = this.parts.join("");
    const deltaEvents = this.deltaEvents;
    const valid =
      !this.discard &&
      summary.length > 0 &&
      data?.classification === providerSafeReasoningSummary &&
      data.status === "completed";
    this.reset();
    if (!valid) return [discardedCompletion(event, metadata)];

    try {
      const governed = await enforceContentPolicyStrings(
        this.repository,
        this.subject,
        [summary],
      );
      const persisted = persistReasoningSummary({
        classification: providerSafeReasoningSummary,
        text: governed.contents[0]!,
        ...metadata,
        dlpBlocked: false,
        retentionAllowsPersist: true,
        answerBody: "",
      });
      if (persisted.outcome === "discarded")
        return [discardedCompletion(event, metadata)];
      const text = persisted.record.text;
      const parts = partitionSummary(text, deltaEvents.length);
      if (parts === undefined) return [discardedCompletion(event, metadata)];
      const deltas = parts.map((part, index) => ({
        ...deltaEvents[index]!,
        data: governedDelta(part),
      }));
      return [
        ...deltas,
        {
          ...event,
          data: {
            classification: providerSafeReasoningSummary,
            status: "completed",
            characterCount: text.length,
            ...metadata,
          },
        },
      ];
    } catch (error) {
      if (error instanceof ApiError && error.code === "content_policy_blocked")
        return [discardedCompletion(event, metadata)];
      throw error;
    }
  }

  private reset(): void {
    this.parts = [];
    this.deltaEvents = [];
    this.characterCount = 0;
    this.discard = false;
  }
}

function discardedCompletion(
  event: RunEvent,
  metadata: Record<string, number>,
): RunEvent {
  return {
    ...event,
    data: {
      classification: hiddenReasoningOmitted,
      status: "discarded",
      ...metadata,
    },
  };
}

function partitionSummary(value: string, count: number): string[] | undefined {
  if (count < 1 || value.length > count * MAX_DELTA_CHARACTERS)
    return undefined;
  const parts: string[] = [];
  for (let index = 0; index < count; index += 1)
    parts.push(
      value.slice(
        index * MAX_DELTA_CHARACTERS,
        (index + 1) * MAX_DELTA_CHARACTERS,
      ),
    );
  return parts;
}

function governedDelta(text: string): Record<string, unknown> {
  return {
    classification: providerSafeReasoningSummary,
    contentPolicyApplied: true,
    text,
  };
}

function summaryMetadata(
  data: Record<string, unknown> | undefined,
): Record<string, number> {
  const durationMs = boundedInteger(data?.durationMs, MAX_DURATION_MS);
  const reasoningTokens = boundedInteger(
    data?.reasoningTokens,
    MAX_REASONING_TOKENS,
  );
  return {
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
  };
}

function boundedInteger(value: unknown, maximum: number): number | undefined {
  return Number.isSafeInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= maximum
    ? (value as number)
    : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
