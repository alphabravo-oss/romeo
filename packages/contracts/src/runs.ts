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

export const RunSchema = z
  .strictObject({
    id: identifier,
    orgId: identifier,
    workspaceId: identifier,
    chatId: identifier,
    agentId: identifier,
    agentVersionId: identifier,
    modelId: identifier,
    providerId: identifier,
    status: runStatus,
    createdBy: identifier,
    createdAt: timestamp,
    completedAt: timestamp.optional(),
  })
  .openapi("RunRecord");

export const QueuedChatTurnSchema = z
  .strictObject({
    id: identifier,
    chatId: identifier,
    content: z.string().min(1).max(200_000),
    idempotencyKey: z.string().min(1).max(200),
    status: z.enum(["queued", "leased", "failed", "cancelled", "completed"]),
    error: z.string().optional(),
    createdAt: timestamp,
  })
  .openapi("QueuedChatTurn");

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

export const RunEventSchema = z
  .strictObject({
    id: identifier,
    runId: identifier,
    sequence: z.number().int().nonnegative(),
    type: z.enum([
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
      "run.continuing",
      "run.waiting_tool_approval",
      "run.waiting_tool_dispatch",
    ]),
    data: z.union([
      RunContinuingEventDataSchema,
      z.record(z.string(), z.unknown()),
    ]),
    createdAt: timestamp,
  })
  .openapi("RunEvent");

const imageAttachment = z.strictObject({
  fileName: z.string().min(1).max(160),
  mimeType: z.enum(["image/gif", "image/jpeg", "image/png", "image/webp"]),
  sizeBytes: z.number().int().positive().max(5_000_000),
  dataBase64: z.string().min(1).max(7_000_000),
});

export const StartRunSchema = z
  .strictObject({
    chatId: identifier,
    agentId: identifier,
    content: z.string().min(1).max(200_000),
    modelId: identifier.optional(),
    historyBoundaryMessageId: identifier.optional(),
    // Attaches the new turn under an existing message instead of extending the
    // active branch: `null` forks from the chat root, absent extends the leaf.
    parentMessageId: z.union([identifier, z.null()]).optional(),
    fileIds: z.array(z.string().min(1).max(160)).max(8).optional(),
    webSearch: z.boolean().optional(),
    urls: z.array(z.url()).max(5).optional(),
    attachments: z.array(imageAttachment).max(4).optional(),
    /**
     * Optional per-turn knowledge bases. When set, retrieval uses these ids
     * (still subject to grants + org RAG policy) instead of only the agent's
     * enabled bindings. Empty array means "no knowledge for this turn".
     */
    knowledgeBaseIds: z.array(identifier).max(25).optional(),
    agenticRag: z.boolean().optional(),
  })
  .openapi("StartRunRequest");

export const EnqueueChatTurnSchema = StartRunSchema.omit({
  chatId: true,
  attachments: true,
  fileIds: true,
  historyBoundaryMessageId: true,
  parentMessageId: true,
})
  .extend({ idempotencyKey: z.string().min(1).max(200).optional() })
  .openapi("EnqueueChatTurnRequest");

export const InspectRunContextSchema = z
  .strictObject({
    chatId: identifier,
    agentId: identifier,
    content: z.string().min(1).max(200_000),
    modelId: identifier.optional(),
    fileIds: z.array(z.string().trim().min(1).max(160)).max(8).optional(),
    imageCount: z.number().int().min(0).max(4).optional(),
    webSearch: z.boolean().optional(),
    urls: z.array(z.url()).max(5).optional(),
    agenticRag: z.boolean().optional(),
  })
  .openapi("InspectRunContextRequest");

const citationSchema = z.strictObject({
  chunkId: identifier,
  documentId: identifier,
  title: z.string().min(1).max(1_000),
  sourceUri: z.string().optional(),
  sourceType: z.string().optional(),
  provider: z.string().optional(),
  retrievedAt: z.string().optional(),
  accessedAt: z.string().optional(),
  publishedAt: z.string().optional(),
});

export const RunContextPreviewSchema = z
  .strictObject({
    model: z.strictObject({
      id: identifier,
      name: z.string().min(1).max(300),
      contextWindow: z.number().int().positive(),
    }),
    budget: z.strictObject({
      estimatedInputTokens: z.number().int().nonnegative(),
      usableInputTokens: z.number().int().nonnegative(),
      remainingInputTokens: z.number().int().nonnegative(),
    }),
    history: z.strictObject({
      includedMessages: z.number().int().nonnegative(),
      availableMessages: z.number().int().nonnegative(),
      truncated: z.boolean(),
    }),
    attachments: z.strictObject({
      currentFiles: z.array(
        z.strictObject({
          fileName: z.string().min(1).max(300),
          mimeType: z.string().min(1).max(200),
        }),
      ),
      retainedDocuments: z.array(z.string().min(1).max(300)),
      retainedImages: z.number().int().nonnegative(),
      pendingImages: z.number().int().nonnegative(),
    }),
    knowledge: z.array(citationSchema),
    memories: z.array(
      z.strictObject({
        id: identifier,
        title: z.string().min(1).max(300),
        scope: z.enum(["personal", "workspace"]),
      }),
    ),
    messages: z.array(
      z.strictObject({
        role: z.enum(["assistant", "system", "tool", "user"]),
        content: z.string(),
        imageCount: z.number().int().nonnegative(),
      }),
    ),
  })
  .openapi("RunContextPreview");

export const inspectRunContextRoute = createRoute({
  method: "post",
  path: "/api/v1/runs/context-preview",
  operationId: "runs.inspectContext",
  tags: ["Runs"],
  security: authenticationSecurity,
  summary: "Inspect the exact governed context for a proposed run",
  description:
    "Uses the same context builder as run execution and returns redacted messages, retained context, citations, memory metadata, and the estimated token budget.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: InspectRunContextSchema } },
    },
  },
  responses: {
    200: jsonResponse(
      "Governed run context preview",
      dataEnvelope(RunContextPreviewSchema),
    ),
    400: standardErrorResponses[400],
    401: standardErrorResponses[401],
    403: standardErrorResponses[403],
    404: standardErrorResponses[404],
    500: standardErrorResponses[500],
  },
});

const metadata = {
  tags: ["Runs"],
  security: authenticationSecurity,
};
const path = z.strictObject({ runId: identifier });
const chatPath = z.strictObject({ chatId: identifier });
const queuedPath = z.strictObject({ chatId: identifier, turnId: identifier });
const authenticatedErrors = {
  400: standardErrorResponses[400],
  401: standardErrorResponses[401],
  403: standardErrorResponses[403],
  404: standardErrorResponses[404],
  409: standardErrorResponses[409],
  500: standardErrorResponses[500],
} as const;

export const getActiveRunRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/chats/{chatId}/runs/active",
  operationId: "runs.getActiveForChat",
  summary: "Get the active resumable run for a chat",
  request: { params: chatPath },
  responses: {
    200: jsonResponse(
      "Active run",
      dataEnvelope(z.union([RunSchema, z.null()])),
    ),
    ...authenticatedErrors,
  },
});

export const listQueuedChatTurnsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/chats/{chatId}/queue",
  operationId: "runs.listQueuedTurns",
  summary: "List persisted queued turns",
  request: { params: chatPath },
  responses: {
    200: jsonResponse(
      "Queued turns",
      dataEnvelope(z.array(QueuedChatTurnSchema)),
    ),
    ...authenticatedErrors,
  },
});

export const enqueueChatTurnRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/chats/{chatId}/queue",
  operationId: "runs.enqueueTurn",
  summary: "Queue a chat turn for durable execution",
  request: {
    params: chatPath,
    body: {
      required: true,
      content: { "application/json": { schema: EnqueueChatTurnSchema } },
    },
  },
  responses: {
    202: jsonResponse("Queued turn", dataEnvelope(QueuedChatTurnSchema)),
    ...authenticatedErrors,
  },
});

export const cancelQueuedChatTurnRoute = createRoute({
  ...metadata,
  method: "delete",
  path: "/api/v1/chats/{chatId}/queue/{turnId}",
  operationId: "runs.cancelQueuedTurn",
  summary: "Cancel a queued chat turn",
  request: { params: queuedPath },
  responses: {
    200: jsonResponse("Cancelled turn", dataEnvelope(QueuedChatTurnSchema)),
    ...authenticatedErrors,
  },
});

export const startRunRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/runs",
  operationId: "runs.start",
  summary: "Start a streamed chat run",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: StartRunSchema } },
    },
  },
  responses: {
    202: jsonResponse("Started run", dataEnvelope(RunSchema)),
    ...authenticatedErrors,
  },
});

export const getRunRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/runs/{runId}",
  operationId: "runs.get",
  summary: "Get run state",
  request: { params: path },
  responses: {
    200: jsonResponse("Run", dataEnvelope(RunSchema)),
    ...authenticatedErrors,
  },
});

export const streamRunEventsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/runs/{runId}/events",
  operationId: "runs.streamEvents",
  summary: "Stream or replay run events",
  request: {
    params: path,
    query: z.strictObject({
      after: z.coerce.number().int().min(0).max(10_000_000).optional(),
    }),
  },
  responses: {
    200: {
      description: "Server-sent run lifecycle events",
      content: {
        "text/event-stream": {
          schema: RunEventSchema,
          "x-romeo-event-schema": {
            $ref: "#/components/schemas/RunEvent",
          },
          "x-romeo-run-continuing-data-schema": {
            $ref: "#/components/schemas/RunContinuingEventData",
          },
        },
      },
    },
    ...authenticatedErrors,
  },
});

export const cancelRunRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/runs/{runId}/cancel",
  operationId: "runs.cancel",
  summary: "Cancel an active run",
  request: { params: path },
  responses: {
    200: jsonResponse("Cancelled run", dataEnvelope(RunSchema)),
    ...authenticatedErrors,
  },
});

export const runRoutes = [
  inspectRunContextRoute,
  getActiveRunRoute,
  listQueuedChatTurnsRoute,
  enqueueChatTurnRoute,
  cancelQueuedChatTurnRoute,
  startRunRoute,
  getRunRoute,
  streamRunEventsRoute,
  cancelRunRoute,
] as const;
