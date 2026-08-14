import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";
import {
  ContentPolicyDetectorActionsSchema,
  ContentPolicyDetectionSchema,
} from "./content-policy";

const identifier = z.string().trim().min(1).max(300);
const metadata = {
  tags: ["Content policy"],
  security: authenticationSecurity,
};
const requestBody = <T extends z.ZodType>(schema: T) => ({
  required: true as const,
  content: { "application/json": { schema } },
});

export const ContentPolicyVersionSchema = z
  .strictObject({
    id: identifier,
    version: z.number().int().positive(),
    state: z.enum(["draft", "staged", "published", "retired"]),
    detectors: ContentPolicyDetectorActionsSchema,
    approvalRequired: z.boolean(),
    approvalTtlSeconds: z.number().int().min(60).max(86_400),
    createdAt: z.iso.datetime(),
    publishedAt: z.iso.datetime().optional(),
  })
  .openapi("ContentPolicyVersion");

export const ContentPolicyDecisionSchema = z
  .strictObject({
    id: identifier,
    versionId: identifier,
    surface: identifier,
    action: z.enum(["allow", "audit", "redact", "block"]),
    detectors: z.array(ContentPolicyDetectionSchema),
    decidedAt: z.iso.datetime(),
  })
  .openapi("ContentPolicyDecision");

export const ContentPolicyApprovalSchema = z
  .strictObject({
    id: identifier,
    runId: identifier,
    decisionId: identifier,
    state: z.enum(["pending", "approved", "denied", "expired"]),
    expiresAt: z.iso.datetime(),
    createdAt: z.iso.datetime(),
    resolvedAt: z.iso.datetime().optional(),
  })
  .openapi("ContentPolicyApproval");

export const CreateContentPolicyVersionSchema = z
  .strictObject({
    detectors: ContentPolicyDetectorActionsSchema,
    approvalRequired: z.boolean().optional(),
    approvalTtlSeconds: z.number().int().min(60).max(86_400).optional(),
  })
  .openapi("CreateContentPolicyVersionRequest");

export const DryRunContentPolicyVersionSchema = z
  .strictObject({ content: z.string().max(200_000) })
  .openapi("DryRunContentPolicyVersionRequest");

export const ContentPolicyDryRunSchema = z
  .strictObject({
    action: z.enum(["allow", "audit", "redact", "block"]),
    detections: z.array(ContentPolicyDetectionSchema),
    evaluatedAt: z.iso.datetime(),
    versionId: identifier,
    redaction: z.strictObject({
      rawContentReturned: z.literal(false),
      rawMatchesReturned: z.literal(false),
    }),
  })
  .openapi("ContentPolicyDryRun");

export const RollbackContentPolicySchema = z
  .strictObject({ versionId: identifier.optional() })
  .openapi("RollbackContentPolicyRequest");

export const RequestContentPolicyApprovalSchema = z
  .strictObject({
    runId: identifier,
    decisionId: identifier,
    expiresAt: z.iso.datetime(),
  })
  .openapi("RequestContentPolicyApprovalRequest");

export const ResolveContentPolicyApprovalSchema = z
  .strictObject({
    decision: z.enum(["approve", "deny"]),
    runId: identifier.optional(),
  })
  .openapi("ResolveContentPolicyApprovalRequest");

export const listContentPolicyVersionsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/admin/content-policy/versions",
  operationId: "contentPolicy.versions.list",
  summary: "List immutable content-policy versions",
  responses: {
    200: jsonResponse(
      "Content policy versions",
      dataEnvelope(z.array(ContentPolicyVersionSchema)),
    ),
    ...standardErrorResponses,
  },
});

export const createContentPolicyVersionRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/admin/content-policy/versions",
  operationId: "contentPolicy.versions.create",
  summary: "Create an immutable content-policy draft",
  request: { body: requestBody(CreateContentPolicyVersionSchema) },
  responses: {
    200: jsonResponse("Content policy version", dataEnvelope(ContentPolicyVersionSchema)),
    ...standardErrorResponses,
  },
});

export const dryRunContentPolicyVersionRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/admin/content-policy/versions/{versionId}/dry-run",
  operationId: "contentPolicy.versions.dryRun",
  summary: "Dry-run a content-policy version without returning matches",
  request: {
    params: z.strictObject({ versionId: identifier }),
    body: requestBody(DryRunContentPolicyVersionSchema),
  },
  responses: {
    200: jsonResponse("Content policy dry-run", dataEnvelope(ContentPolicyDryRunSchema)),
    ...standardErrorResponses,
  },
});

export const publishContentPolicyVersionRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/admin/content-policy/versions/{versionId}/publish",
  operationId: "contentPolicy.versions.publish",
  summary: "Publish a staged or draft content-policy version",
  request: { params: z.strictObject({ versionId: identifier }) },
  responses: {
    200: jsonResponse("Content policy version", dataEnvelope(ContentPolicyVersionSchema)),
    ...standardErrorResponses,
  },
});

export const rollbackContentPolicyRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/admin/content-policy/rollback",
  operationId: "contentPolicy.rollback",
  summary: "Roll back to a previous published content-policy version",
  request: { body: requestBody(RollbackContentPolicySchema) },
  responses: {
    200: jsonResponse("Content policy version", dataEnvelope(ContentPolicyVersionSchema)),
    ...standardErrorResponses,
  },
});

export const listContentPolicyDecisionsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/admin/content-policy/decisions",
  operationId: "contentPolicy.decisions.list",
  summary: "List sanitized content-policy decisions",
  responses: {
    200: jsonResponse(
      "Content policy decisions",
      dataEnvelope(z.array(ContentPolicyDecisionSchema)),
    ),
    ...standardErrorResponses,
  },
});

export const listContentPolicyApprovalsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/admin/content-policy/approvals",
  operationId: "contentPolicy.approvals.list",
  summary: "List scoped content-policy approvals",
  responses: {
    200: jsonResponse(
      "Content policy approvals",
      dataEnvelope(z.array(ContentPolicyApprovalSchema)),
    ),
    ...standardErrorResponses,
  },
});

export const requestContentPolicyApprovalRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/admin/content-policy/approvals",
  operationId: "contentPolicy.approvals.request",
  summary: "Pause a run for a scoped, expiring, content-minimized approval",
  request: { body: requestBody(RequestContentPolicyApprovalSchema) },
  responses: {
    200: jsonResponse(
      "Content policy approval",
      dataEnvelope(ContentPolicyApprovalSchema),
    ),
    ...standardErrorResponses,
  },
});

export const resolveContentPolicyApprovalRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/admin/content-policy/approvals/{approvalId}/resolve",
  operationId: "contentPolicy.approvals.resolve",
  summary: "Resolve a scoped content-policy approval",
  request: {
    params: z.strictObject({ approvalId: identifier }),
    body: requestBody(ResolveContentPolicyApprovalSchema),
  },
  responses: {
    200: jsonResponse(
      "Content policy approval",
      dataEnvelope(ContentPolicyApprovalSchema),
    ),
    ...standardErrorResponses,
  },
});

export const contentPolicyLifecycleRoutes = [
  listContentPolicyVersionsRoute,
  createContentPolicyVersionRoute,
  dryRunContentPolicyVersionRoute,
  publishContentPolicyVersionRoute,
  rollbackContentPolicyRoute,
  listContentPolicyDecisionsRoute,
  listContentPolicyApprovalsRoute,
  requestContentPolicyApprovalRoute,
  resolveContentPolicyApprovalRoute,
] as const;
