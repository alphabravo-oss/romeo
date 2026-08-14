import { z } from "@hono/zod-openapi";

import { ReasoningPolicySchema } from "./reasoning";

const id = z.string().trim().min(1).max(300);
const time = z.iso.datetime();
const count = z.number().int().min(0);
const score = z.number().min(0).max(1);
const reportedTokenCount = z.number().int().min(0).max(2_000_000_000);

export const EvalReasoningPolicyEvidenceSchema = z
  .strictObject({
    requested: ReasoningPolicySchema,
    effective: ReasoningPolicySchema,
  })
  .openapi("EvalReasoningPolicyEvidence");

export const EvalRunMetricsSchema = z
  .strictObject({
    latencyMs: z.number().int().min(0).max(86_400_000),
    usage: z.strictObject({
      coverage: z.enum(["complete", "partial", "none"]),
      inputTokens: reportedTokenCount.optional(),
      outputTokens: reportedTokenCount.optional(),
      reasoningTokens: reportedTokenCount.optional(),
      source: z
        .enum([
          "anthropic",
          "ollama",
          "openai-compatible",
          "openai-responses-compatible",
        ])
        .optional(),
    }),
    costBasis: z.enum(["reported_tokens", "unavailable"]),
    estimatedCostUsd: z.number().min(0).max(1_000_000).optional(),
  })
  .openapi("EvalRunMetrics");

export const RunEvalSuiteSchema = z
  .strictObject({
    modelId: id.optional(),
    reasoningPolicy: ReasoningPolicySchema.optional(),
  })
  .openapi("RunEvalSuiteRequest");

/** Token and cost values are totals across only fully reported runs in each variant. */
export const EvalReasoningComparisonSchema = z
  .strictObject({
    suiteId: id,
    generatedAt: time,
    variants: z.array(
      z.strictObject({
        modelId: id,
        requested: ReasoningPolicySchema,
        effective: ReasoningPolicySchema,
        runCount: count,
        averageScore: score,
        averageLatencyMs: z.number().min(0).max(86_400_000),
        reportedInputTokens: reportedTokenCount.nullable(),
        reportedOutputTokens: reportedTokenCount.nullable(),
        reportedReasoningTokens: reportedTokenCount.nullable(),
        estimatedCostUsd: z.number().min(0).max(1_000_000).nullable(),
        trend: z.array(
          z.strictObject({
            runId: id,
            score,
            latencyMs: z.number().int().min(0).max(86_400_000),
            completedAt: time,
          }),
        ),
      }),
    ),
  })
  .openapi("EvalReasoningComparison");
