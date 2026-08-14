import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";

export const ContentPolicyActionSchema = z.enum([
  "disabled",
  "audit",
  "block",
  "redact",
]);
export const ContentPolicyDetectorCodeSchema = z.enum([
  "credit_card",
  "email_address",
  "us_ssn",
  "api_token",
]);

export const ContentPolicyDetectorActionsSchema = z.strictObject({
  credit_card: ContentPolicyActionSchema,
  email_address: ContentPolicyActionSchema,
  us_ssn: ContentPolicyActionSchema,
  api_token: ContentPolicyActionSchema,
});

export const ContentPolicyReportSchema = z
  .strictObject({
    schema: z.literal("romeo.content-policy.v1"),
    orgId: z.string().trim().min(1).max(300),
    detectors: ContentPolicyDetectorActionsSchema,
    policySource: z.enum(["default", "org"]),
    updatedAt: z.iso.datetime().optional(),
    updatedBy: z.string().trim().min(1).max(300).optional(),
    redaction: z.strictObject({
      rawContentReturned: z.literal(false),
      rawMatchesReturned: z.literal(false),
      detectorPatternsReturned: z.literal(false),
    }),
  })
  .openapi("ContentPolicyReport");

export const UpdateContentPolicySchema = z
  .strictObject({
    detectors: ContentPolicyDetectorActionsSchema.partial(),
  })
  .refine((value) => Object.keys(value.detectors).length > 0, {
    message: "At least one detector action is required.",
  })
  .openapi("UpdateContentPolicyRequest");

export const ContentPolicyDetectionSchema = z.strictObject({
  code: ContentPolicyDetectorCodeSchema,
  count: z.number().int().positive(),
  action: ContentPolicyActionSchema.exclude(["disabled"]),
});

export const SimulateContentPolicySchema = z
  .strictObject({ content: z.string().max(200_000) })
  .openapi("SimulateContentPolicyRequest");

export const ContentPolicySimulationSchema = z
  .strictObject({
    action: z.enum(["allow", "audit", "redact", "block"]),
    detections: z.array(ContentPolicyDetectionSchema),
    evaluatedAt: z.iso.datetime(),
    redaction: z.strictObject({
      rawContentReturned: z.literal(false),
      rawMatchesReturned: z.literal(false),
    }),
  })
  .openapi("ContentPolicySimulation");

const metadata = {
  tags: ["Content policy"],
  security: authenticationSecurity,
};
const requestBody = <T extends z.ZodType>(schema: T) => ({
  required: true as const,
  content: { "application/json": { schema } },
});

export const getContentPolicyRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/admin/content-policy",
  operationId: "contentPolicy.get",
  summary: "Get organization content policy",
  responses: {
    200: jsonResponse(
      "Content policy",
      dataEnvelope(ContentPolicyReportSchema),
    ),
    ...standardErrorResponses,
  },
});

export const updateContentPolicyRoute = createRoute({
  ...metadata,
  method: "patch",
  path: "/api/v1/admin/content-policy",
  operationId: "contentPolicy.update",
  summary: "Update organization content policy",
  request: { body: requestBody(UpdateContentPolicySchema) },
  responses: {
    200: jsonResponse(
      "Content policy",
      dataEnvelope(ContentPolicyReportSchema),
    ),
    ...standardErrorResponses,
  },
});

export const simulateContentPolicyRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/admin/content-policy/simulate",
  operationId: "contentPolicy.simulate",
  summary: "Simulate content policy without returning sensitive content",
  request: { body: requestBody(SimulateContentPolicySchema) },
  responses: {
    200: jsonResponse(
      "Content policy simulation",
      dataEnvelope(ContentPolicySimulationSchema),
    ),
    ...standardErrorResponses,
  },
});

export const contentPolicyRoutes = [
  getContentPolicyRoute,
  updateContentPolicyRoute,
  simulateContentPolicyRoute,
] as const;
