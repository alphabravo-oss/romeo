import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";

const identifier = z.string().trim().min(1).max(300);
const timestamp = z.iso.datetime();
const capabilityId = z.enum([
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
]);
const imageSize = z.enum(["1024x1024", "1024x1536", "1536x1024"]);

export const CapabilityIdSchema = capabilityId.openapi("CapabilityId");
export const CapabilityLayerSchema = z
  .enum([
    "deployment",
    "platform",
    "entitlement",
    "organization",
    "workspace",
    "agent_version",
    "agent",
    "group",
    "user",
    "resource",
    "provider_model",
    "quota",
    "action",
  ])
  .openapi("CapabilityLayer");
export const CapabilityAssignmentStateSchema = z
  .enum(["inherit", "enabled", "disabled", "required"])
  .openapi("CapabilityAssignmentState");
export const CapabilityScopeTypeSchema = z
  .enum(["organization", "workspace", "agent", "group", "user"])
  .openapi("CapabilityScopeType");

export const ImageGenerationCapabilityConfigurationSchema = z
  .strictObject({
    maxImagesPerRequest: z.number().int().min(1).max(4),
    allowedSizes: z.array(imageSize).min(1).max(3),
  })
  .openapi("ImageGenerationCapabilityConfiguration");

export const CapabilityConfigurationSchema = z
  .strictObject({
    maxImagesPerRequest: z.number().int().min(1).max(4).optional(),
    allowedSizes: z.array(imageSize).max(3).optional(),
    maxSearchResults: z.number().int().min(1).max(10).optional(),
    maxUrlsPerRequest: z.number().int().min(1).max(5).optional(),
    reasoningModeMaximum: z.enum(["off", "auto", "summary"]).optional(),
    reasoningEffortMaximum: z.enum(["low", "medium", "high"]).optional(),
    maxReasoningTokens: z.number().int().min(1).max(200_000).optional(),
    allowReasoningSummaryRetention: z.boolean().optional(),
  })
  .openapi("CapabilityConfiguration");

export const CapabilityConfigurationPatchSchema =
  CapabilityConfigurationSchema.openapi("CapabilityConfigurationPatch");

export const CapabilityDefinitionSchema = z
  .strictObject({
    id: capabilityId,
    schemaVersion: z.literal(1),
    lifecycle: z.enum(["disabled", "preview", "ga", "deprecated"]),
    category: z.enum([
      "media",
      "reasoning",
      "retrieval",
      "compute",
      "compare",
      "security",
      "governance",
    ]),
    risk: z.enum(["low", "medium", "high", "critical"]),
    controllingLayers: z.array(CapabilityLayerSchema),
    allowedStates: z.array(CapabilityAssignmentStateSchema),
    defaultState: z.enum(["enabled", "disabled"]),
    defaultConfiguration: CapabilityConfigurationSchema,
    merge: z.strictObject({
      boolean: z.literal("deny_dominates"),
      booleans: z.array(z.string()),
      maxima: z.array(z.string()),
      allowlists: z.array(z.string()),
    }),
    requiredScopes: z.array(identifier),
    entitlementKey: identifier.optional(),
    dependencies: z.array(identifier),
    copy: z.strictObject({
      nameKey: identifier,
      descriptionKey: identifier,
      riskKey: identifier,
      remediationKey: identifier,
    }),
    registryVersion: identifier,
  })
  .openapi("CapabilityDefinition");

export const CapabilityAssignmentSchema = z
  .strictObject({
    id: identifier,
    orgId: identifier,
    scopeType: CapabilityScopeTypeSchema,
    scopeId: identifier,
    capabilityId,
    state: CapabilityAssignmentStateSchema,
    configuration: CapabilityConfigurationPatchSchema,
    version: z.number().int().positive(),
    supersedesId: identifier.optional(),
    actorId: identifier,
    reason: z.string().trim().min(1).max(1_000),
    effectiveAt: timestamp,
    expiresAt: timestamp.optional(),
    revokedAt: timestamp.optional(),
    createdAt: timestamp,
  })
  .openapi("CapabilityAssignment");

export const CapabilityReasonSchema = z
  .strictObject({
    code: z.enum([
      "platform_disabled",
      "not_configured",
      "not_entitled",
      "organization_policy",
      "workspace_policy",
      "agent_version_policy",
      "agent_policy",
      "group_policy",
      "user_policy",
      "missing_grant",
      "model_unsupported",
      "dependency_unhealthy",
      "quota_exceeded",
      "requested_value_outside_limit",
    ]),
    layer: CapabilityLayerSchema,
    effect: z.string().max(300).optional(),
  })
  .openapi("CapabilityReason");

const dimension = z.enum(["yes", "no", "unknown", "not_required"]);

export const EffectiveCapabilitySchema = z
  .strictObject({
    capabilityId,
    status: z.enum([
      "enabled",
      "disabled",
      "required",
      "normalized",
      "not_configured",
      "not_entitled",
      "not_allowed",
      "unsupported",
      "unhealthy",
    ]),
    dimensions: z.strictObject({
      installed: dimension.exclude(["not_required"]),
      entitled: dimension,
      available: dimension.exclude(["not_required"]),
      allowed: z.enum(["yes", "no"]),
      capable: dimension.exclude(["not_required"]),
      selected: z.enum(["yes", "no", "defaulted"]),
    }),
    effective: CapabilityConfigurationSchema,
    requestedChanges: z.array(
      z.strictObject({
        path: z.string().max(300),
        effect: z.enum(["clamped", "removed", "rejected"]),
      }),
    ),
    reasons: z.array(CapabilityReasonSchema),
    assignmentVersions: z.array(
      z.strictObject({
        layer: CapabilityLayerSchema,
        version: z.number().int().positive(),
      }),
    ),
    registryVersion: identifier,
    resolvedAt: timestamp,
    expiresAt: timestamp.optional(),
  })
  .openapi("EffectiveCapability");

export const ResolveCapabilitiesSchema = z
  .strictObject({
    capabilityIds: z.array(capabilityId).min(1).max(25),
    context: z.strictObject({
      workspaceId: identifier,
      modelId: identifier.optional(),
      agentId: identifier.optional(),
      agentVersionId: identifier.optional(),
    }),
    requested: z
      .partialRecord(
        capabilityId,
        z.strictObject({
          selected: z.boolean().optional(),
          maxImagesPerRequest: z.number().int().min(1).max(4).optional(),
          allowedSizes: z.array(imageSize).min(1).max(3).optional(),
          maxSearchResults: z.number().int().min(1).max(10).optional(),
          maxUrlsPerRequest: z.number().int().min(1).max(5).optional(),
          reasoningMode: z.enum(["off", "auto", "summary"]).optional(),
          reasoningEffort: z.enum(["low", "medium", "high"]).optional(),
          maxReasoningTokens: z.number().int().min(1).max(200_000).optional(),
          retainReasoningSummary: z.boolean().optional(),
        }),
      )
      .optional(),
  })
  .openapi("ResolveCapabilitiesRequest");

export const UpdateCapabilityAssignmentSchema = z
  .strictObject({
    scopeType: CapabilityScopeTypeSchema,
    scopeId: identifier,
    state: CapabilityAssignmentStateSchema,
    configuration: CapabilityConfigurationPatchSchema.default({}),
    reason: z.string().trim().min(1).max(1_000),
    expectedVersion: z.number().int().nonnegative().optional(),
    expiresAt: timestamp.nullable().optional(),
  })
  .openapi("UpdateCapabilityAssignmentRequest");

export const PreviewCapabilityAssignmentSchema =
  UpdateCapabilityAssignmentSchema.omit({
    expectedVersion: true,
    reason: true,
  })
    .extend({
      workspaceId: identifier.optional(),
      requested: z
        .strictObject({
          selected: z.boolean().optional(),
          reasoningMode: z.enum(["off", "auto", "summary"]).optional(),
          reasoningEffort: z.enum(["low", "medium", "high"]).optional(),
          maxReasoningTokens: z.number().int().min(1).max(200_000).optional(),
          retainReasoningSummary: z.boolean().optional(),
        })
        .optional(),
    })
    .openapi("PreviewCapabilityAssignmentRequest");

export const CapabilityAdminOverviewSchema = z
  .strictObject({
    scopeType: CapabilityScopeTypeSchema,
    scopeId: identifier,
    registryVersion: identifier,
    capabilities: z.array(
      z.strictObject({
        definition: CapabilityDefinitionSchema,
        configuredAssignment: CapabilityAssignmentSchema.optional(),
        inheritedAssignment: CapabilityAssignmentSchema.optional(),
        effective: EffectiveCapabilitySchema,
        controllingLayer: CapabilityLayerSchema.optional(),
        canOverride: z.boolean(),
      }),
    ),
  })
  .openapi("CapabilityAdminOverview");

export const CapabilityExplanationSchema = z
  .strictObject({
    effective: EffectiveCapabilitySchema,
    assignments: z.array(
      z.strictObject({
        id: identifier,
        layer: CapabilityLayerSchema,
        version: z.number().int().positive(),
        state: CapabilityAssignmentStateSchema,
        expiresAt: timestamp.optional(),
      }),
    ),
  })
  .openapi("CapabilityExplanation");

export const PlatformCapabilityPostureSchema = z
  .strictObject({
    registryVersion: identifier,
    controlPlane: z.literal("deployment_environment"),
    mutableViaApi: z.literal(false),
    capabilities: z.array(
      z.strictObject({
        capabilityId,
        lifecycle: z.enum(["disabled", "preview", "ga", "deprecated"]),
        risk: z.enum(["low", "medium", "high", "critical"]),
        state: z.enum(["enabled", "disabled"]),
        reason: z.enum(["allowed", "platform_disabled"]),
      }),
    ),
  })
  .openapi("PlatformCapabilityPosture");

const adminScopeQuery = z.strictObject({
  scopeType: CapabilityScopeTypeSchema,
  scopeId: identifier,
  workspaceId: identifier.optional(),
  modelId: identifier.optional(),
});
const assignmentScopeQuery = adminScopeQuery.pick({
  scopeType: true,
  scopeId: true,
});
const capabilityPath = z.strictObject({ capabilityId });
const metadata = { tags: ["Capabilities"], security: authenticationSecurity };
const mutationErrors = {
  ...standardErrorResponses,
  409: standardErrorResponses[409],
} as const;

export const listCapabilityDefinitionsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/admin/capabilities/definitions",
  operationId: "capabilities.listDefinitions",
  summary: "List governed capability definitions",
  responses: {
    200: jsonResponse(
      "Capability definitions",
      dataEnvelope(z.array(CapabilityDefinitionSchema)),
    ),
    ...standardErrorResponses,
  },
});

export const getPlatformCapabilityPostureRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/admin/capabilities/platform",
  operationId: "capabilities.getPlatformPosture",
  summary: "Get global operator capability posture",
  description:
    "Returns the deployment-controlled capability ceiling to global administrators. This layer is read-only through tenant APIs and contains no environment values or secrets.",
  responses: {
    200: jsonResponse(
      "Global operator capability posture",
      dataEnvelope(PlatformCapabilityPostureSchema),
    ),
    ...standardErrorResponses,
  },
});

export const resolveCapabilitiesRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/capabilities/effective",
  operationId: "capabilities.resolveEffective",
  summary: "Resolve capabilities for the authenticated subject",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: ResolveCapabilitiesSchema } },
    },
  },
  responses: {
    200: jsonResponse(
      "Effective capabilities",
      dataEnvelope(z.array(EffectiveCapabilitySchema)),
    ),
    ...standardErrorResponses,
  },
});

export const getCapabilityAdminOverviewRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/admin/capabilities/overview",
  operationId: "capabilities.getAdminOverview",
  summary: "Get layered capability administration overview",
  request: { query: adminScopeQuery },
  responses: {
    200: jsonResponse(
      "Capability administration overview",
      dataEnvelope(CapabilityAdminOverviewSchema),
    ),
    ...standardErrorResponses,
  },
});

export const getCapabilityAssignmentHistoryRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/admin/capabilities/{capabilityId}/history",
  operationId: "capabilities.getAssignmentHistory",
  summary: "Get capability assignment history",
  request: { params: capabilityPath, query: assignmentScopeQuery },
  responses: {
    200: jsonResponse(
      "Capability assignment history",
      dataEnvelope(z.array(CapabilityAssignmentSchema)),
    ),
    ...standardErrorResponses,
  },
});

export const explainCapabilityRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/admin/capabilities/{capabilityId}/explain",
  operationId: "capabilities.explainAdmin",
  summary: "Explain a layered capability decision",
  request: { params: capabilityPath, query: adminScopeQuery },
  responses: {
    200: jsonResponse(
      "Capability explanation",
      dataEnvelope(CapabilityExplanationSchema),
    ),
    ...standardErrorResponses,
  },
});

export const updateCapabilityAssignmentRoute = createRoute({
  ...metadata,
  method: "put",
  path: "/api/v1/admin/capabilities/{capabilityId}/assignment",
  operationId: "capabilities.updateAssignment",
  summary: "Create or replace a versioned capability assignment",
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
      "Updated capability assignment",
      dataEnvelope(CapabilityAssignmentSchema),
    ),
    ...mutationErrors,
  },
});

export const patchCapabilityAssignmentRoute = createRoute({
  ...metadata,
  method: "patch",
  path: "/api/v1/admin/capabilities/{capabilityId}/assignment",
  operationId: "capabilities.patchAssignment",
  summary: "Replace a versioned capability assignment",
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
      "Updated capability assignment",
      dataEnvelope(CapabilityAssignmentSchema),
    ),
    ...mutationErrors,
  },
});

export const capabilityRoutes = [
  listCapabilityDefinitionsRoute,
  getPlatformCapabilityPostureRoute,
  resolveCapabilitiesRoute,
  getCapabilityAdminOverviewRoute,
  getCapabilityAssignmentHistoryRoute,
  explainCapabilityRoute,
  updateCapabilityAssignmentRoute,
  patchCapabilityAssignmentRoute,
] as const;
