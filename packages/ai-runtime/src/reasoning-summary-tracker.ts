const MAX_SUMMARY_CHARACTERS = 20_000;
const MAX_DURATION_MS = 86_400_000;
const MAX_REASONING_TOKENS = 200_000;
const MAX_SUMMARY_DELTAS = 64;

interface SummaryEvent {
  type: "reasoning.summary.delta" | "reasoning.summary.completed";
  data: Record<string, unknown>;
}

/** Attempt-scoped buffer for a provider-designated safe summary. */
export class ReasoningSummaryTracker {
  private readonly parts: string[] = [];
  private characters = 0;
  private startedAt: number | undefined;
  private finished = false;
  private overflowed = false;

  observe(text: string): void {
    this.startedAt ??= Date.now();
    if (
      this.parts.length >= MAX_SUMMARY_DELTAS ||
      this.characters + text.length > MAX_SUMMARY_CHARACTERS
    ) {
      this.overflowed = true;
      this.parts.length = 0;
      this.characters = 0;
      return;
    }
    if (this.overflowed) return;
    this.parts.push(text);
    this.characters += text.length;
  }

  finish(
    status: "completed" | "discarded",
    reasoningTokens?: number,
  ): SummaryEvent[] {
    if (this.startedAt === undefined || this.finished) return [];
    this.finished = true;
    const metadata = this.metadata(reasoningTokens);
    if (status === "discarded" || this.overflowed) return [discarded(metadata)];
    return [
      ...this.parts.map((text) => ({
        type: "reasoning.summary.delta" as const,
        data: { classification: "provider_safe_summary", text },
      })),
      {
        type: "reasoning.summary.completed",
        data: {
          classification: "provider_safe_summary",
          status: "completed",
          characterCount: this.characters,
          ...metadata,
        },
      },
    ];
  }

  private metadata(reasoningTokens?: number): Record<string, number> {
    return {
      durationMs: Math.min(
        MAX_DURATION_MS,
        Math.max(0, Date.now() - this.startedAt!),
      ),
      ...(boundedTokens(reasoningTokens) === undefined
        ? {}
        : { reasoningTokens: reasoningTokens! }),
    };
  }
}

function discarded(metadata: Record<string, number>): SummaryEvent {
  return {
    type: "reasoning.summary.completed",
    data: {
      classification: "hidden_reasoning_omitted",
      status: "discarded",
      ...metadata,
    },
  };
}

function boundedTokens(value: number | undefined): number | undefined {
  return Number.isSafeInteger(value) &&
    value! >= 0 &&
    value! <= MAX_REASONING_TOKENS
    ? value
    : undefined;
}
