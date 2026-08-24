import { createRoute, z } from "@hono/zod-openapi";

import {
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
  workerBrokerSecurity,
} from "./common";

export const WorkerBrokerAudienceSchema = z.enum([
  "tool_dispatch",
  "browser_automation",
  "knowledge_extraction",
]);

const params = z.strictObject({ audience: WorkerBrokerAudienceSchema });
const workerId = z.string().min(1).max(160);
const claimToken = z.string().min(1).max(16_384);
const leaseSeconds = z.number().int().min(30).max(900).default(300);
const jsonObject = z.record(z.string(), z.unknown());

export const WorkerBrokerClaimRequestSchema = z
  .strictObject({
    leaseSeconds,
    payloadStorage: z
      .enum([
        "external_worker_secret_store_required",
        "managed_encrypted_object_store",
      ])
      .optional(),
    workerId,
  })
  .openapi("WorkerBrokerClaimRequest");

export const WorkerBrokerRenewRequestSchema = z
  .strictObject({ claimToken, leaseSeconds, workerId })
  .openapi("WorkerBrokerRenewRequest");

const toolResponse = z.strictObject({
  bodyBytes: z.number().int().nonnegative(),
  contentType: z.string().max(255).optional(),
  ok: z.boolean(),
  schemaValidation: z.strictObject({
    errorCode: z.string().max(120).optional(),
    status: z.enum(["failed", "passed"]),
  }),
  status: z.number().int().min(100).max(599),
  truncated: z.boolean(),
});

export const WorkerBrokerCompleteRequestSchema = z
  .strictObject({
    claimToken,
    errorCode: z.string().max(120).optional(),
    response: toolResponse.optional(),
    result: jsonObject.optional(),
    success: z.boolean(),
    workerId,
  })
  .openapi("WorkerBrokerCompleteRequest");

export const WorkerBrokerClaimResponseSchema = z
  .strictObject({
    audience: WorkerBrokerAudienceSchema,
    claim: jsonObject.optional(),
    claimed: z.boolean(),
    claimToken: claimToken.optional(),
  })
  .openapi("WorkerBrokerClaimResponse");

const metadata = {
  tags: ["Internal worker broker"],
  security: workerBrokerSecurity,
};

export const claimWorkerBrokerWorkRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/internal/worker-broker/{audience}/claims",
  operationId: "workerBroker.claim",
  summary: "Claim the next tenant-scoped item for one worker audience",
  request: {
    params,
    body: {
      required: true,
      content: {
        "application/json": { schema: WorkerBrokerClaimRequestSchema },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "Worker claim",
      dataEnvelope(WorkerBrokerClaimResponseSchema),
    ),
    ...standardErrorResponses,
  },
});

export const renewWorkerBrokerClaimRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/internal/worker-broker/{audience}/claims/renew",
  operationId: "workerBroker.renew",
  summary: "Renew an audience-bound fenced worker claim",
  request: {
    params,
    body: {
      required: true,
      content: {
        "application/json": { schema: WorkerBrokerRenewRequestSchema },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "Renewed worker claim",
      dataEnvelope(WorkerBrokerClaimResponseSchema),
    ),
    ...standardErrorResponses,
  },
});

export const completeWorkerBrokerClaimRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/internal/worker-broker/{audience}/claims/complete",
  operationId: "workerBroker.complete",
  summary: "Complete or fail an audience-bound fenced worker claim",
  request: {
    params,
    body: {
      required: true,
      content: {
        "application/json": { schema: WorkerBrokerCompleteRequestSchema },
      },
    },
  },
  responses: {
    200: jsonResponse("Worker completion result", dataEnvelope(jsonObject)),
    ...standardErrorResponses,
  },
});

export const workerBrokerRoutes = [
  claimWorkerBrokerWorkRoute,
  renewWorkerBrokerClaimRoute,
  completeWorkerBrokerClaimRoute,
] as const;
