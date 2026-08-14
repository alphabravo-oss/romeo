import type { RunEventType } from "@romeo/core";

export type RunEventTypeRecord = RunEventType;

const runEventTypes: Record<RunEventTypeRecord, true> = {
  "message.completed": true,
  "message.delta": true,
  "message.reasoning": true,
  "reasoning.summary.delta": true,
  "reasoning.summary.completed": true,
  "message.started": true,
  "retrieval.completed": true,
  "run.cancelled": true,
  "run.completed": true,
  "run.continuing": true,
  "run.failed": true,
  "run.started": true,
  "run.waiting_tool_approval": true,
  "run.waiting_tool_dispatch": true,
  "tool.requested": true,
  "tool.approval_required": true,
  "tool.completed": true,
  "tool.failed": true,
  "tool.started": true,
  "output.part.ready": true,
};

/** Strictly maps durable event rows; malformed reasoning always fails closed. */
export function normalizeRunEvent(
  rawType: string,
  data: unknown,
): { type: RunEventTypeRecord; data: unknown } {
  const type = asRunEventType(rawType);
  if (type === "message.reasoning") return { type, data: hiddenReasoningData };
  if (type === "reasoning.summary.delta") {
    const value = record(data);
    return value?.classification === "provider_safe_summary" &&
      value.contentPolicyApplied === true &&
      typeof value.text === "string" &&
      value.text.length <= 4_096
      ? {
          type,
          data: {
            classification: "provider_safe_summary",
            contentPolicyApplied: true,
            text: value.text,
          },
        }
      : { type: "message.reasoning", data: hiddenReasoningData };
  }
  if (type !== "reasoning.summary.completed") return { type, data };
  const value = record(data);
  const safe =
    value?.classification === "provider_safe_summary" &&
    value.status === "completed";
  return {
    type,
    data: {
      classification: safe
        ? "provider_safe_summary"
        : "hidden_reasoning_omitted",
      status: safe ? "completed" : "discarded",
      ...(safe
        ? boundedEventNumber(value?.characterCount, 20_000, "characterCount")
        : {}),
      ...boundedEventNumber(value?.durationMs, 86_400_000, "durationMs"),
      ...boundedEventNumber(value?.reasoningTokens, 200_000, "reasoningTokens"),
    },
  };
}

function asRunEventType(value: string): RunEventTypeRecord {
  return Object.hasOwn(runEventTypes, value)
    ? (value as RunEventTypeRecord)
    : "run.failed";
}

function boundedEventNumber(
  value: unknown,
  maximum: number,
  key: string,
): Record<string, number> {
  return Number.isSafeInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= maximum
    ? { [key]: value as number }
    : {};
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

const hiddenReasoningData = {
  classification: "hidden_reasoning_omitted",
} as const;
