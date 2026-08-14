import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";

const identifier = z.string().trim().min(1).max(300);
const timestamp = z.iso.datetime();
const runStatus = z.enum([
  "queued",
  "running",
  "waiting_tool_approval",
  "cancelled",
  "completed",
  "failed",
]);
const runContextCheckpointType = z.enum([
  "run.started",
  "message.started",
  "message.completed",
  "reasoning.summary.completed",
  "retrieval.completed",
  "tool.requested",
  "tool.started",
  "tool.approval_required",
  "tool.completed",
  "tool.failed",
  "run.cancelled",
  "run.completed",
  "run.failed",
  "run.continuing",
  "run.waiting_tool_approval",
  "run.waiting_tool_dispatch",
  "output.part.ready",
]);

export const PersistedRunContextInspectionSchema = z
  .strictObject({
    run: z.strictObject({
      id: identifier,
      chatId: identifier,
      agentId: identifier,
      agentVersionId: identifier,
      status: runStatus,
      createdAt: timestamp,
      completedAt: timestamp.optional(),
    }),
    branch: z.strictObject({
      inputMessageId: identifier.optional(),
      parentMessageId: identifier.optional(),
      visibleMessageCount: z.number().int().nonnegative(),
      currentTranscriptVersion: z.string().regex(/^[0-9]{1,20}$/u),
    }),
    model: z.strictObject({
      id: identifier,
      displayName: z.string().trim().min(1).max(300).optional(),
      available: z.boolean(),
    }),
    provider: z.strictObject({
      id: identifier,
      displayName: z.string().trim().min(1).max(300).optional(),
      available: z.boolean(),
    }),
    messages: z
      .array(
        z.strictObject({
          id: identifier,
          role: z.enum(["assistant", "user"]),
          content: z.string().max(20_000),
          contentTruncated: z.boolean(),
          createdAt: timestamp,
        }),
      )
      .max(8),
    checkpoints: z
      .array(
        z.strictObject({
          sequence: z.number().int().nonnegative(),
          type: runContextCheckpointType,
          createdAt: timestamp,
        }),
      )
      .max(50),
    knowledge: z.strictObject({
      totalCitationCount: z.number().int().nonnegative(),
      revokedOrUnavailableCount: z.number().int().nonnegative(),
      citations: z
        .array(
          z.strictObject({
            chunkId: identifier,
            documentId: identifier,
            title: z.string().trim().min(1).max(1_000),
            sourceType: z.string().trim().min(1).max(100).optional(),
            provider: z.string().trim().min(1).max(100).optional(),
          }),
        )
        .max(100),
    }),
    tools: z
      .array(
        z.strictObject({
          toolId: identifier,
          status: z.enum([
            "blocked",
            "approval_required",
            "success",
            "failure",
          ]),
          riskLevel: z.string().trim().min(1).max(100),
          approvalRequired: z.boolean(),
          startedAt: timestamp,
          completedAt: timestamp,
        }),
      )
      .max(50),
    policies: z.strictObject({
      memoryMode: z.enum(["disabled", "recent_messages"]),
      memoryMessageLimit: z.number().int().positive().optional(),
      knowledgeGroundingMode: z
        .enum(["optional", "prefer", "required"])
        .optional(),
      maxUserInputLength: z.number().int().positive().optional(),
      blockedTermCount: z.number().int().nonnegative(),
      promptInjectionGuard: z
        .strictObject({
          mode: z.literal("block"),
          scanUserInput: z.boolean(),
          scanRetrievedContext: z.boolean(),
        })
        .optional(),
    }),
    transformations: z
      .array(
        z.strictObject({
          type: z.enum([
            "content_policy_applied",
            "history_trimmed",
            "knowledge_dropped",
            "knowledge_prompt_injection_filtered",
            "provider_fallback",
          ]),
          count: z.number().int().nonnegative().optional(),
        }),
      )
      .max(10),
  })
  .openapi("PersistedRunContextInspection");

export const inspectPersistedRunContextRoute = createRoute({
  method: "get",
  path: "/api/v1/chats/{chatId}/context-inspection",
  operationId: "runs.inspectPersistedContext",
  tags: ["Runs"],
  security: authenticationSecurity,
  summary: "Inspect privacy-safe context provenance for a chat run",
  description:
    "Returns bounded persisted run provenance and currently authorized visible sources without provider request bodies, hidden reasoning, secret values, or policy match text. The latest run is selected when runId is omitted.",
  request: {
    params: z.strictObject({ chatId: identifier }),
    query: z.strictObject({ runId: identifier.optional() }),
  },
  responses: {
    200: jsonResponse(
      "Privacy-safe persisted run context inspection",
      dataEnvelope(z.union([PersistedRunContextInspectionSchema, z.null()])),
    ),
    400: standardErrorResponses[400],
    401: standardErrorResponses[401],
    403: standardErrorResponses[403],
    404: standardErrorResponses[404],
    500: standardErrorResponses[500],
  },
});
