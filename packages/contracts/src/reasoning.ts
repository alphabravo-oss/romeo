import { z } from "@hono/zod-openapi";

const effort = z.enum(["low", "medium", "high"]);
const maxReasoningTokens = z.number().int().min(1).max(200_000).optional();

export const ReasoningPolicySchema = z
  .discriminatedUnion("mode", [
    z.strictObject({ schemaVersion: z.literal(1), mode: z.literal("off") }),
    z.strictObject({
      schemaVersion: z.literal(1),
      mode: z.literal("auto"),
      effort: effort.optional(),
      maxReasoningTokens,
    }),
    z.strictObject({
      schemaVersion: z.literal(1),
      mode: z.literal("summary"),
      effort: effort.optional(),
      maxReasoningTokens,
      summaryDetail: z.enum(["brief", "standard", "detailed"]).optional(),
      retainSummary: z.boolean(),
    }),
  ])
  .openapi("ReasoningPolicyV1");

export type ReasoningPolicy = z.infer<typeof ReasoningPolicySchema>;
