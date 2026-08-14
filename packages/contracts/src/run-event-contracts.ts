import { z } from "@hono/zod-openapi";

const identifier = z.string().trim().min(1).max(300);
const timestamp = z.iso.datetime();

export const RunContinuingEventDataSchema = z
  .strictObject({
    reason: z.enum(["tool_approval", "tool_dispatch"]),
    toolId: identifier,
    approvalRequestId: identifier.optional(),
    jobId: identifier.optional(),
    outcome: z.enum(["completed", "failed"]).optional(),
    errorCode: z.string().optional(),
  })
  .openapi("RunContinuingEventData");

export const ReasoningSummaryDeltaEventDataSchema = z
  .strictObject({
    classification: z.literal("provider_safe_summary"),
    contentPolicyApplied: z.literal(true),
    text: z.string().max(4_096),
  })
  .openapi("ReasoningSummaryDeltaEventData");

const completedMetadata = {
  durationMs: z.number().int().min(0).max(86_400_000).optional(),
  reasoningTokens: z.number().int().min(0).max(200_000).optional(),
};

export const ReasoningSummaryCompletedEventDataSchema = z
  .discriminatedUnion("classification", [
    z.strictObject({
      classification: z.literal("provider_safe_summary"),
      status: z.literal("completed"),
      characterCount: z.number().int().min(0).max(20_000).optional(),
      ...completedMetadata,
    }),
    z.strictObject({
      classification: z.literal("hidden_reasoning_omitted"),
      status: z.literal("discarded"),
      ...completedMetadata,
    }),
  ])
  .openapi("ReasoningSummaryCompletedEventData");

const eventEnvelope = {
  id: identifier,
  runId: identifier,
  sequence: z.number().int().nonnegative(),
  schemaVersion: z.literal(1),
  legId: identifier.optional(),
  channel: z.string().trim().min(1).max(64).optional(),
  createdAt: timestamp,
};

const genericEventTypes = z.enum([
  "run.started",
  "message.started",
  "message.delta",
  "message.reasoning",
  "message.completed",
  "retrieval.completed",
  "tool.requested",
  "tool.started",
  "tool.approval_required",
  "tool.completed",
  "tool.failed",
  "run.cancelled",
  "run.completed",
  "run.failed",
  "run.waiting_tool_approval",
  "run.waiting_tool_dispatch",
  "output.part.ready",
]);

export const RunEventSchema = z
  .discriminatedUnion("type", [
    z.strictObject({
      ...eventEnvelope,
      type: z.literal("reasoning.summary.delta"),
      data: ReasoningSummaryDeltaEventDataSchema,
    }),
    z.strictObject({
      ...eventEnvelope,
      type: z.literal("reasoning.summary.completed"),
      data: ReasoningSummaryCompletedEventDataSchema,
    }),
    z.strictObject({
      ...eventEnvelope,
      type: z.literal("run.continuing"),
      data: RunContinuingEventDataSchema,
    }),
    z.strictObject({
      ...eventEnvelope,
      type: genericEventTypes,
      data: z.record(z.string(), z.unknown()),
    }),
  ])
  .openapi("RunEvent");
