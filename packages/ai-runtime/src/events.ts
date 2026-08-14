export type RunEventType =
  | "run.started"
  | "message.started"
  | "message.delta"
  | "message.reasoning"
  | "reasoning.summary.delta"
  | "reasoning.summary.completed"
  | "message.completed"
  | "retrieval.completed"
  | "tool.requested"
  | "tool.started"
  | "tool.approval_required"
  | "tool.completed"
  | "tool.failed"
  | "run.cancelled"
  | "run.completed"
  | "run.failed"
  | "run.continuing"
  | "run.waiting_tool_approval"
  | "run.waiting_tool_dispatch"
  | "output.part.ready";

export interface RunEvent<TData = unknown> {
  id: string;
  runId: string;
  sequence: number;
  /** Present on all public stream envelopes; optional here for persisted v0 rows. */
  schemaVersion?: 1;
  /** Optional comparison/realtime leg identifier reserved for multiplexed runs. */
  legId?: string;
  /** Optional logical event channel reserved for compatible stream extensions. */
  channel?: string;
  type: RunEventType;
  data: TData;
  createdAt: string;
}

export const providerSafeReasoningSummary = "provider_safe_summary" as const;
export const hiddenReasoningOmitted = "hidden_reasoning_omitted" as const;
const maxReasoningSummaryDeltaCharacters = 4_096;
const maxReasoningSummaryCharacters = 20_000;
const maxReasoningDurationMs = 86_400_000;
const maxReasoningTokens = 200_000;

export function publicRunEvent(event: RunEvent): RunEvent {
  if (event.type === "reasoning.summary.delta")
    return publicReasoningSummaryDelta(event);
  if (event.type === "reasoning.summary.completed")
    return publicReasoningSummaryCompleted(event);
  if (event.type !== "message.reasoning") return event;
  const data = record(event.data);
  const metadata = reasoningMetadata(data);
  return {
    ...event,
    data: { classification: hiddenReasoningOmitted, ...metadata },
  };
}

function publicReasoningSummaryDelta(event: RunEvent): RunEvent {
  const data = record(event.data);
  if (
    data?.classification !== providerSafeReasoningSummary ||
    data.contentPolicyApplied !== true ||
    typeof data.text !== "string"
  )
    return {
      ...event,
      type: "message.reasoning",
      data: { classification: hiddenReasoningOmitted },
    };
  return {
    ...event,
    data: {
      classification: providerSafeReasoningSummary,
      contentPolicyApplied: true,
      text: data.text.slice(0, maxReasoningSummaryDeltaCharacters),
    },
  };
}

function publicReasoningSummaryCompleted(event: RunEvent): RunEvent {
  const data = record(event.data);
  const safeClassification =
    data?.classification === providerSafeReasoningSummary
      ? providerSafeReasoningSummary
      : hiddenReasoningOmitted;
  const status =
    safeClassification === providerSafeReasoningSummary &&
    data?.status === "completed"
      ? "completed"
      : "discarded";
  const characterCount = boundedInteger(
    data?.characterCount,
    maxReasoningSummaryCharacters,
  );
  return {
    ...event,
    data: {
      classification: safeClassification,
      status,
      ...(safeClassification !== providerSafeReasoningSummary ||
      characterCount === undefined
        ? {}
        : { characterCount }),
      ...reasoningMetadata(data),
    },
  };
}

export function createRunEvent<TData>(input: {
  runId: string;
  sequence: number;
  type: RunEventType;
  data: TData;
}): RunEvent<TData> {
  return {
    id: `evt_${input.runId}_${input.sequence}`,
    runId: input.runId,
    sequence: input.sequence,
    schemaVersion: 1,
    type: input.type,
    data: input.data,
    createdAt: new Date().toISOString(),
  };
}

function reasoningMetadata(data: Record<string, unknown> | undefined) {
  const durationMs = boundedInteger(data?.durationMs, maxReasoningDurationMs);
  const reasoningTokens = boundedInteger(
    data?.reasoningTokens,
    maxReasoningTokens,
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
