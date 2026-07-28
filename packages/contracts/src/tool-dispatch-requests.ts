import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";

const id = z.string().min(1).max(200);
const tags = ["Tool dispatch requests"];
const body = <T extends z.ZodType>(schema: T) => ({
  required: true as const,
  content: { "application/json": { schema } },
});
const job = z.strictObject({
  id,
  type: z.string(),
  status: z.enum(["completed", "failed", "queued", "running"]),
});
const payloadStorage = z.enum([
  "external_worker_secret_store_required",
  "managed_encrypted_object_store",
]);
const requestMetadata = z.strictObject({
  parameterKeys: z.array(z.string()),
  bodyKeys: z.array(z.string()),
  host: z.string(),
  payloadStorage,
});
const responseValidation = z.strictObject({
  status: z.enum(["failed", "not_applicable", "passed", "skipped"]),
  errorCode: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9_.-]+$/u)
    .optional(),
});
const responseReadback = z.strictObject({
  ok: z.boolean(),
  status: z.number().int().min(100).max(599),
  contentType: z.string().min(1).max(120).optional(),
  bodyBytes: z.number().int().nonnegative().max(1_000_000_000),
  truncated: z.boolean(),
  schemaValidation: responseValidation,
});
const reasonCode = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9_.-]+$/u);

export const EnqueueToolDispatchRequestSchema = z
  .strictObject({
    parameters: z.record(z.string(), z.unknown()).optional(),
    body: z.record(z.string(), z.unknown()).optional(),
    approved: z.boolean().optional(),
    approvalRequestId: id.optional(),
    idempotencyKey: z.string().min(1).max(200).optional(),
  })
  .openapi("EnqueueToolDispatchRequest");
export const ClaimToolDispatchRequestSchema = z
  .strictObject({
    leaseSeconds: z.number().int().min(30).max(3600).default(300),
    payloadStorage: payloadStorage.optional(),
  })
  .openapi("ClaimToolDispatchRequest");
export const ExpireToolDispatchRequestsRequestSchema = z
  .strictObject({
    queuedTimeoutSeconds: z
      .number()
      .int()
      .min(60)
      .max(2_592_000)
      .default(86_400),
    runningTimeoutSeconds: z
      .number()
      .int()
      .min(60)
      .max(2_592_000)
      .default(3_600),
    limit: z.number().int().min(1).max(500).default(100),
  })
  .openapi("ExpireToolDispatchRequestsRequest");
export const CompleteToolDispatchRequestSchema = z
  .strictObject({ response: responseReadback })
  .openapi("CompleteToolDispatchRequest");
export const FailToolDispatchRequestSchema = z
  .strictObject({ errorCode: reasonCode })
  .openapi("FailToolDispatchRequest");
export const CancelToolDispatchRequestSchema = z
  .strictObject({ reasonCode: reasonCode.optional() })
  .openapi("CancelToolDispatchRequest");

export const ToolDispatchRequestResultSchema = z
  .strictObject({
    job,
    connectorId: id,
    operationId: id,
    method: z.string(),
    pathTemplate: z.string(),
    workerQueue: z.literal("external_tool_operations"),
    request: requestMetadata,
    approval: z.strictObject({
      required: z.boolean(),
      approvalPolicy: z.enum([
        "never",
        "write_operations",
        "external_side_effects",
        "always",
        "admin_only",
      ]),
      riskLevel: z.enum(["low", "medium", "high", "critical"]),
      approvalRequestId: id.optional(),
    }),
    idempotency: z.strictObject({ replayed: z.boolean() }).optional(),
  })
  .openapi("ToolDispatchRequestResult");
export const ToolDispatchRequestClaimResultSchema = z
  .strictObject({
    claimed: z.boolean(),
    job: job.optional(),
    connectorId: id.optional(),
    operationId: id.optional(),
    method: z.string().optional(),
    pathTemplate: z.string().optional(),
    workerQueue: z.literal("external_tool_operations"),
    request: requestMetadata.optional(),
    payloadStore: z
      .strictObject({
        contentType: z.literal(
          "application/vnd.romeo.tool-dispatch-payload+json",
        ),
        driver: z.literal("object_store"),
        encrypted: z.literal(true),
        objectKey: z.string(),
        schemaVersion: z.literal("romeo.tool-dispatch-payload.v1"),
      })
      .optional(),
    lease: z
      .strictObject({
        workerId: id,
        claimedAt: z.string().datetime(),
        renewedAt: z.string().datetime(),
        expiresAt: z.string().datetime(),
        leaseSeconds: z.number().int().positive(),
        attempt: z.number().int().positive(),
      })
      .optional(),
    authPolicy: z
      .strictObject({
        oauthClientAuthMethod: z
          .enum(["client_secret_basic", "client_secret_post"])
          .optional(),
        oauthScopes: z.array(z.string()).optional(),
        oauthTokenUrl: z.string().optional(),
        type: z.enum([
          "none",
          "api_key",
          "bearer",
          "oauth2_client_credentials",
        ]),
      })
      .optional(),
    responseValidation: z
      .strictObject({
        jsonSchemas: z.record(z.string(), z.record(z.string(), z.unknown())),
      })
      .optional(),
    transport: z
      .discriminatedUnion("protocol", [
        z.strictObject({
          protocol: z.literal("http"),
          requestBody: z.literal("raw_json"),
        }),
        z.strictObject({
          protocol: z.literal("mcp_streamable_http"),
          requestBody: z.literal("mcp_tools_call"),
          mcpToolName: z.string(),
          mcpProtocolVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
        }),
      ])
      .optional(),
  })
  .openapi("ToolDispatchRequestClaimResult");

const payloadAuth = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("bearer"), secretRef: z.string() }),
  z.strictObject({
    type: z.literal("api_key"),
    secretRef: z.string(),
    apiKeyIn: z.enum(["header", "query"]).optional(),
    apiKeyName: z.string().optional(),
  }),
  z.strictObject({
    type: z.literal("oauth2_client_credentials"),
    secretRef: z.string(),
  }),
]);
export const ToolDispatchRequestPayloadResultSchema = z
  .strictObject({
    job,
    connectorId: id,
    operationId: id,
    method: z.string(),
    pathTemplate: z.string(),
    workerQueue: z.literal("external_tool_operations"),
    request: requestMetadata,
    payload: z.strictObject({
      auth: payloadAuth.optional(),
      body: z.record(z.string(), z.unknown()).optional(),
      headers: z.record(z.string(), z.string()).optional(),
      parameters: z.record(z.string(), z.unknown()).optional(),
    }),
  })
  .openapi("ToolDispatchRequestPayloadResult");
export const ToolDispatchRequestReadbackResultSchema = z
  .strictObject({
    job,
    connectorId: id,
    operationId: id,
    method: z.string(),
    pathTemplate: z.string(),
    workerQueue: z.literal("external_tool_operations"),
    outcome: z.enum(["cancelled", "completed", "failed"]),
    response: responseReadback.optional(),
    errorCode: z.string().optional(),
  })
  .openapi("ToolDispatchRequestReadbackResult");
export const ToolDispatchRequestExpiryResultSchema = z
  .strictObject({
    expired: z.number().int().nonnegative(),
    workerQueue: z.literal("external_tool_operations"),
    jobs: z.array(
      z.strictObject({
        job,
        connectorId: id,
        operationId: id,
        method: z.string(),
        pathTemplate: z.string(),
        reasonCode: z.enum(["queued_timeout", "running_lease_timeout"]),
      }),
    ),
  })
  .openapi("ToolDispatchRequestExpiryResult");

const connectorOperationParams = z.strictObject({
  connectorId: id,
  operationId: id,
});
const jobParams = z.strictObject({ jobId: id });
const route = <T extends z.ZodType>(description: string, schema: T) =>
  jsonResponse(description, dataEnvelope(schema));

export const enqueueToolDispatchRequestRoute = createRoute({
  method: "post",
  path: "/api/v1/tool-connectors/{connectorId}/operations/{operationId}/dispatch-requests",
  operationId: "toolDispatchRequests.enqueue",
  tags,
  summary: "Queue a metadata-only tool dispatch request",
  security: authenticationSecurity,
  request: {
    params: connectorOperationParams,
    body: body(EnqueueToolDispatchRequestSchema),
  },
  responses: {
    200: route("Queued tool dispatch request", ToolDispatchRequestResultSchema),
    ...standardErrorResponses,
  },
});
export const claimToolDispatchRequestRoute = createRoute({
  method: "post",
  path: "/api/v1/tool-operation-dispatch-requests/claim",
  operationId: "toolDispatchRequests.claim",
  tags,
  summary: "Claim the next queued tool dispatch request",
  security: authenticationSecurity,
  request: { body: body(ClaimToolDispatchRequestSchema) },
  responses: {
    200: route(
      "Tool dispatch request claim",
      ToolDispatchRequestClaimResultSchema,
    ),
    ...standardErrorResponses,
  },
});
export const expireToolDispatchRequestsRoute = createRoute({
  method: "post",
  path: "/api/v1/tool-operation-dispatch-requests/expire",
  operationId: "toolDispatchRequests.expire",
  tags,
  summary: "Expire stale tool dispatch requests",
  security: authenticationSecurity,
  request: { body: body(ExpireToolDispatchRequestsRequestSchema) },
  responses: {
    200: route(
      "Expired tool dispatch requests",
      ToolDispatchRequestExpiryResultSchema,
    ),
    ...standardErrorResponses,
  },
});
export const renewToolDispatchRequestLeaseRoute = createRoute({
  method: "post",
  path: "/api/v1/tool-operation-dispatch-requests/{jobId}/renew-lease",
  operationId: "toolDispatchRequests.renewLease",
  tags,
  summary: "Renew a tool dispatch lease",
  security: authenticationSecurity,
  request: { params: jobParams, body: body(ClaimToolDispatchRequestSchema) },
  responses: {
    200: route(
      "Renewed tool dispatch lease",
      ToolDispatchRequestClaimResultSchema,
    ),
    ...standardErrorResponses,
  },
});
export const readToolDispatchRequestPayloadRoute = createRoute({
  method: "post",
  path: "/api/v1/tool-operation-dispatch-requests/{jobId}/payload",
  operationId: "toolDispatchRequests.readPayload",
  tags,
  summary: "Read the encrypted payload for an active lease",
  security: authenticationSecurity,
  request: { params: jobParams },
  responses: {
    200: route(
      "Tool dispatch request payload",
      ToolDispatchRequestPayloadResultSchema,
    ),
    ...standardErrorResponses,
  },
});
export const completeToolDispatchRequestRoute = createRoute({
  method: "post",
  path: "/api/v1/tool-operation-dispatch-requests/{jobId}/complete",
  operationId: "toolDispatchRequests.complete",
  tags,
  summary: "Complete a tool dispatch request",
  security: authenticationSecurity,
  request: { params: jobParams, body: body(CompleteToolDispatchRequestSchema) },
  responses: {
    200: route(
      "Completed tool dispatch request",
      ToolDispatchRequestReadbackResultSchema,
    ),
    ...standardErrorResponses,
  },
});
export const failToolDispatchRequestRoute = createRoute({
  method: "post",
  path: "/api/v1/tool-operation-dispatch-requests/{jobId}/fail",
  operationId: "toolDispatchRequests.fail",
  tags,
  summary: "Fail a tool dispatch request",
  security: authenticationSecurity,
  request: { params: jobParams, body: body(FailToolDispatchRequestSchema) },
  responses: {
    200: route(
      "Failed tool dispatch request",
      ToolDispatchRequestReadbackResultSchema,
    ),
    ...standardErrorResponses,
  },
});
export const cancelToolDispatchRequestRoute = createRoute({
  method: "post",
  path: "/api/v1/tool-operation-dispatch-requests/{jobId}/cancel",
  operationId: "toolDispatchRequests.cancel",
  tags,
  summary: "Cancel a tool dispatch request",
  security: authenticationSecurity,
  request: { params: jobParams, body: body(CancelToolDispatchRequestSchema) },
  responses: {
    200: route(
      "Cancelled tool dispatch request",
      ToolDispatchRequestReadbackResultSchema,
    ),
    ...standardErrorResponses,
  },
});

export const toolDispatchRequestRoutes = [
  enqueueToolDispatchRequestRoute,
  claimToolDispatchRequestRoute,
  expireToolDispatchRequestsRoute,
  renewToolDispatchRequestLeaseRoute,
  readToolDispatchRequestPayloadRoute,
  completeToolDispatchRequestRoute,
  failToolDispatchRequestRoute,
  cancelToolDispatchRequestRoute,
] as const;
