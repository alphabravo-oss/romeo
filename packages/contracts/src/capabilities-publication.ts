import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";
import {
  CapabilityAssignmentSchema,
  CapabilityLayerSchema,
  CapabilityReasonSchema,
  EffectiveCapabilitySchema,
  PreviewCapabilityAssignmentSchema,
  UpdateCapabilityAssignmentSchema,
} from "./capabilities";

const identifier = z.string().trim().min(1).max(300);
const capabilityPath = z.strictObject({
  capabilityId: z.enum([
    "image_generation",
    "reasoning_policy",
    "voice_processing",
    "web_retrieval",
    "content_firewall",
    "knowledge_acl",
    "realtime_voice",
    "image_editing",
    "secure_compute",
    "multi_model_compare",
    "tenant_encryption",
    "data_export",
  ]),
});
const metadata = { tags: ["Capabilities"], security: authenticationSecurity };
const mutationErrors = {
  ...standardErrorResponses,
  409: standardErrorResponses[409],
} as const;

export const CapabilityImpactPreviewSchema = z
  .strictObject({
    sampleCount: z.number().int().nonnegative(),
    counts: z.strictObject({
      enabled: z.number().int().nonnegative(),
      disabled: z.number().int().nonnegative(),
      required: z.number().int().nonnegative(),
      normalized: z.number().int().nonnegative(),
      not_configured: z.number().int().nonnegative(),
      not_entitled: z.number().int().nonnegative(),
      not_allowed: z.number().int().nonnegative(),
      unsupported: z.number().int().nonnegative(),
      unhealthy: z.number().int().nonnegative(),
    }),
    reasons: z.array(
      z.strictObject({
        code: CapabilityReasonSchema.shape.code,
        layer: CapabilityLayerSchema,
        count: z.number().int().positive(),
      }),
    ),
  })
  .openapi("CapabilityImpactPreview");

export const PreviewCapabilityImpactSchema =
  PreviewCapabilityAssignmentSchema.extend({
    samples: z
      .array(
        z.strictObject({
          role: z.enum(["admin", "member", "service_account"]),
          workspaceClass: z.enum(["default", "regulated", "general"]),
        }),
      )
      .min(1)
      .max(25),
  }).openapi("PreviewCapabilityImpactRequest");

export const PolicyBundleSchema = z
  .strictObject({
    id: identifier,
    orgId: identifier,
    state: z.enum([
      "draft",
      "pending_approval",
      "approved",
      "published",
      "rejected",
      "rolled_back",
    ]),
    proposerId: identifier,
    approverId: identifier.optional(),
    reason: z.string().trim().min(1).max(1_000),
    capabilityId: capabilityPath.shape.capabilityId,
    publicationRequired: z.boolean(),
  })
  .openapi("PolicyBundle");

export const previewCapabilityAssignmentRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/admin/capabilities/{capabilityId}/assignment/preview",
  operationId: "capabilities.previewAssignment",
  summary: "Preview a capability assignment without persisting it",
  request: {
    params: capabilityPath,
    body: {
      required: true,
      content: {
        "application/json": { schema: PreviewCapabilityAssignmentSchema },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "Previewed effective capability",
      dataEnvelope(EffectiveCapabilitySchema),
    ),
    ...standardErrorResponses,
  },
});

export const previewCapabilityImpactRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/admin/capabilities/{capabilityId}/assignment/impact",
  operationId: "capabilities.previewImpact",
  summary: "Preview capability-change impact counts without user content",
  request: {
    params: capabilityPath,
    body: {
      required: true,
      content: {
        "application/json": { schema: PreviewCapabilityImpactSchema },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "Capability impact preview",
      dataEnvelope(CapabilityImpactPreviewSchema),
    ),
    ...standardErrorResponses,
  },
});

export const publishCapabilityAssignmentRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/admin/capabilities/{capabilityId}/assignment/publish",
  operationId: "capabilities.publishAssignment",
  summary: "Publish a capability assignment, using dual approval when required",
  request: {
    params: capabilityPath,
    body: {
      required: true,
      content: {
        "application/json": { schema: UpdateCapabilityAssignmentSchema },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "Published capability assignment or pending approval bundle",
      dataEnvelope(z.union([CapabilityAssignmentSchema, PolicyBundleSchema])),
    ),
    ...mutationErrors,
  },
});

export const approveCapabilityPublicationRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/admin/capabilities/publications/{bundleId}/approve",
  operationId: "capabilities.approvePublication",
  summary: "Approve a high-risk capability publication as a distinct actor",
  request: {
    params: z.strictObject({ bundleId: identifier }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.strictObject({
            reason: z.string().trim().min(1).max(1_000),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonResponse("Approved policy bundle", dataEnvelope(PolicyBundleSchema)),
    ...mutationErrors,
  },
});

export const capabilityPublicationRoutes = [
  previewCapabilityAssignmentRoute,
  previewCapabilityImpactRoute,
  publishCapabilityAssignmentRoute,
  approveCapabilityPublicationRoute,
] as const;
