import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  errorResponse,
  jsonResponse,
  standardErrorResponses,
} from "./common";
import {
  CatalogModelSurfaceSchema,
  ProviderCatalogSyncJobSchema,
  ProviderCatalogSyncSchema,
} from "./provider-catalog-schemas";
import {
  getProviderCatalogSyncJobRoute,
  runProviderCatalogSyncJobRoute,
} from "./provider-catalog-sync-routes";

export {
  getProviderCatalogSyncJobRoute,
  runProviderCatalogSyncJobRoute,
} from "./provider-catalog-sync-routes";
export { ProviderCatalogSyncJobSchema } from "./provider-catalog-schemas";
import { ProviderOperationalSummarySchema } from "./provider-operational-schema";
import {
  ProviderCapabilitiesSchema,
  ProviderImagePricingSchema as imagePricing,
  ProviderKindSchema as providerKind,
} from "./provider-capability-schemas";

export { ProviderCapabilitiesSchema } from "./provider-capability-schemas";

const identifier = z.string().trim().min(1).max(300);

export const ProviderDialectSummarySchema = z
  .strictObject({
    contractVersion: z.literal("1"),
    version: z.string().regex(/^[a-z0-9][a-z0-9.-]{2,79}$/u),
    operations: z.strictObject({
      audio: z.boolean(),
      batches: z.boolean(),
      capabilityProbing: z.boolean(),
      chat: z.literal(true),
      discovery: z.literal(true),
      embeddings: z.boolean(),
      errorNormalization: z.boolean(),
      files: z.boolean(),
      imageGeneration: z.boolean(),
      tokenCounting: z.boolean(),
      usageParsing: z.boolean(),
    }),
  })
  .openapi("ProviderDialectSummary");

export const ProviderConnectionSchema = z
  .strictObject({
    id: identifier,
    orgId: identifier,
    type: providerKind,
    name: z.string().min(1).max(200),
    baseUrl: z.url(),
    modelIds: z.array(identifier).optional(),
    enabled: z.boolean(),
    capabilities: ProviderCapabilitiesSchema,
    dialect: ProviderDialectSummarySchema,
    catalogSync: ProviderCatalogSyncSchema.optional(),
    credentialConfigured: z.boolean(),
    credentialRefScheme: z.string().optional(),
    auth: z.string().min(1).max(80).optional(),
    target: z.string().min(1).max(80).optional(),
    region: z.string().min(1).max(80).optional(),
    project: z.string().min(1).max(80).optional(),
    deployment: z.string().min(1).max(80).optional(),
  })
  .openapi("ProviderConnection");

export const ProviderModelSchema = z
  .strictObject({
    id: identifier,
    providerId: identifier,
    name: z.string().min(1),
    displayName: z.string().min(1),
    enabled: z.boolean(),
    available: z.boolean().optional(),
    capabilities: ProviderCapabilitiesSchema,
    contextWindow: z.number().int().positive(),
    pricing: z
      .strictObject({
        inputTokenUsd: z.number().nonnegative(),
        outputTokenUsd: z.number().nonnegative(),
        imageGenerationUsd: imagePricing.optional(),
      })
      .optional(),
    defaultParameters: z
      .strictObject({
        temperature: z.number().min(0).max(2).optional(),
        topP: z.number().min(0).max(1).optional(),
        maxOutputTokens: z.number().int().min(1).max(200_000).optional(),
      })
      .optional(),
    capabilitiesSource: z.enum(["detected", "override"]).optional(),
    probedAt: z.iso.datetime().optional(),
    catalogSurface: CatalogModelSurfaceSchema.optional(),
  })
  .openapi("ProviderModel");

export const CreateProviderConnectionSchema = z
  .strictObject({
    type: providerKind,
    name: z.string().trim().min(1).max(200),
    baseUrl: z.url(),
    auth: z.string().trim().min(1).max(80).optional(),
    credentialRef: z.string().trim().min(1).max(500).optional(),
    deployment: z.string().trim().min(1).max(80).optional(),
    modelIds: z.array(identifier).max(2_000).optional(),
    project: z.string().trim().min(1).max(80).optional(),
    region: z.string().trim().min(1).max(80).optional(),
    target: z.string().trim().min(1).max(80).optional(),
  })
  .openapi("CreateProviderConnectionRequest");

export const UpdateProviderConnectionSchema =
  CreateProviderConnectionSchema.omit({ type: true })
    .extend({ enabled: z.boolean().optional() })
    .partial()
    .refine((value) => Object.keys(value).length > 0, {
      message: "At least one provider field is required.",
    })
    .openapi("UpdateProviderConnectionRequest");

export const ProviderVerificationSchema = z
  .strictObject({
    ok: z.boolean(),
    message: z.string(),
    latencyMs: z.number().nonnegative(),
    checks: z.array(
      z.strictObject({
        label: z.string(),
        status: z.enum(["fail", "pass", "warning"]),
        detail: z.string(),
      }),
    ),
  })
  .openapi("ProviderVerification");

const providerPath = z.strictObject({ providerId: identifier });
const modelPath = z.strictObject({ modelId: identifier });
const providerResponse = dataEnvelope(ProviderConnectionSchema);
const providersResponse = dataEnvelope(z.array(ProviderConnectionSchema));
const modelResponse = dataEnvelope(ProviderModelSchema);
const modelsResponse = dataEnvelope(z.array(ProviderModelSchema));
const metadata = { tags: ["Providers"], security: authenticationSecurity };
const readErrors = {
  401: standardErrorResponses[401],
  403: standardErrorResponses[403],
  404: standardErrorResponses[404],
  500: standardErrorResponses[500],
} as const;
const mutationErrors = {
  400: standardErrorResponses[400],
  ...readErrors,
  409: standardErrorResponses[409],
} as const;

export const listProviderConnectionsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/providers",
  operationId: "providers.listConnections",
  summary: "List provider connections",
  responses: {
    200: jsonResponse("Provider connections", providersResponse),
    ...readErrors,
  },
});

export const createProviderConnectionRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/providers",
  operationId: "providers.createConnection",
  summary: "Create a provider connection",
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: CreateProviderConnectionSchema },
      },
    },
  },
  responses: {
    201: jsonResponse("Created provider connection", providerResponse),
    ...mutationErrors,
  },
});

export const updateProviderConnectionRoute = createRoute({
  ...metadata,
  method: "patch",
  path: "/api/v1/providers/{providerId}",
  operationId: "providers.updateConnection",
  summary: "Update a provider connection",
  request: {
    params: providerPath,
    body: {
      required: true,
      content: {
        "application/json": { schema: UpdateProviderConnectionSchema },
      },
    },
  },
  responses: {
    200: jsonResponse("Updated provider connection", providerResponse),
    ...mutationErrors,
  },
});

export const verifyProviderConnectionRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/providers/{providerId}/verify",
  operationId: "providers.verifyConnection",
  summary: "Run provider connection diagnostics",
  request: { params: providerPath },
  responses: {
    200: jsonResponse(
      "Provider connection diagnostics",
      dataEnvelope(ProviderVerificationSchema),
    ),
    ...readErrors,
    502: errorResponse,
  },
});

export const syncProviderModelsRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/providers/{providerId}/sync",
  operationId: "providers.syncModels",
  summary: "Discover and synchronize provider models",
  description:
    "Preserves administrative capability and enabled-state overrides while synchronizing the remote catalog. Large catalogs must use mode=async_job.",
  request: {
    params: providerPath,
    query: z.strictObject({
      mode: z.enum(["async_job", "inline"]).optional(),
    }),
  },
  responses: {
    200: jsonResponse("Synchronized provider models", modelsResponse),
    202: jsonResponse(
      "Accepted catalog sync job",
      dataEnvelope(ProviderCatalogSyncJobSchema),
    ),
    ...mutationErrors,
    502: errorResponse,
  },
});

export const pullOllamaModelRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/providers/{providerId}/ollama/pull",
  operationId: "providers.pullOllamaModel",
  summary: "Pull a model into an Ollama connection",
  request: {
    params: providerPath,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.strictObject({ model: identifier }),
        },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "Ollama pull result",
      dataEnvelope(
        z.strictObject({
          completed: z.number().nonnegative(),
          digest: z.string().optional(),
          model: identifier,
          status: z.string(),
          total: z.number().nonnegative(),
        }),
      ),
    ),
    ...mutationErrors,
    502: errorResponse,
  },
});

export const deleteOllamaModelRoute = createRoute({
  ...metadata,
  method: "delete",
  path: "/api/v1/providers/{providerId}/ollama/models/{model}",
  operationId: "providers.deleteOllamaModel",
  summary: "Delete a model from an Ollama connection",
  request: {
    params: z.strictObject({ providerId: identifier, model: identifier }),
  },
  responses: {
    200: jsonResponse(
      "Ollama delete result",
      dataEnvelope(
        z.strictObject({ model: identifier, status: z.string().min(1) }),
      ),
    ),
    ...mutationErrors,
    502: errorResponse,
  },
});

export const listProviderModelsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/models",
  operationId: "providers.listModels",
  summary: "List authorized provider models",
  request: {
    query: z.strictObject({
      available: z.enum(["true", "false"]).optional(),
      enabled: z.enum(["true", "false"]).optional(),
      direction: z.enum(["asc", "desc"]).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
      offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
      providerId: identifier.optional(),
      q: z.string().trim().max(300).optional(),
      sort: z
        .enum([
          "availability",
          "contextWindow",
          "displayName",
          "enabled",
          "name",
        ])
        .optional(),
    }),
  },
  responses: {
    200: jsonResponse(
      "Provider models",
      modelsResponse.extend({
        meta: z
          .strictObject({
            limit: z.number().int().positive(),
            offset: z.number().int().nonnegative(),
            total: z.number().int().nonnegative(),
            hasMore: z.boolean(),
          })
          .optional(),
      }),
    ),
    400: standardErrorResponses[400],
    ...readErrors,
  },
});

export const updateProviderModelPricingRoute = createRoute({
  ...metadata,
  method: "patch",
  path: "/api/v1/models/{modelId}/pricing",
  operationId: "providers.updateModelPricing",
  summary: "Update provider-model pricing",
  request: {
    params: modelPath,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.strictObject({
            inputTokenUsd: z.number().nonnegative(),
            outputTokenUsd: z.number().nonnegative(),
            imageGenerationUsd: imagePricing.optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonResponse("Updated provider model", modelResponse),
    ...mutationErrors,
  },
});

export const updateProviderModelCapabilitiesRoute = createRoute({
  ...metadata,
  method: "patch",
  path: "/api/v1/models/{modelId}/capabilities",
  operationId: "providers.updateModelCapabilities",
  summary: "Override provider-model capabilities",
  request: {
    params: modelPath,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.strictObject({
            capabilities: ProviderCapabilitiesSchema,
            contextWindow: z.number().int().positive().max(10_000_000),
            defaultParameters: z
              .strictObject({
                temperature: z.number().min(0).max(2).optional(),
                topP: z.number().min(0).max(1).optional(),
                maxOutputTokens: z
                  .number()
                  .int()
                  .min(1)
                  .max(200_000)
                  .optional(),
              })
              .optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonResponse("Updated provider model", modelResponse),
    ...mutationErrors,
  },
});

export const updateProviderModelEnabledRoute = createRoute({
  ...metadata,
  method: "patch",
  path: "/api/v1/models/{modelId}/enabled",
  operationId: "providers.updateModelEnabled",
  summary: "Enable or disable a provider model",
  request: {
    params: modelPath,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.strictObject({ enabled: z.boolean() }),
        },
      },
    },
  },
  responses: {
    200: jsonResponse("Updated provider model", modelResponse),
    ...mutationErrors,
  },
});

export const getProviderOperationalSummaryRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/providers/operational-summary",
  operationId: "providers.getOperationalSummary",
  summary: "Get provider operational diagnostics",
  responses: {
    200: jsonResponse(
      "Provider operational summary",
      dataEnvelope(ProviderOperationalSummarySchema),
    ),
    ...readErrors,
  },
});

export const providerRoutes = [
  listProviderConnectionsRoute,
  createProviderConnectionRoute,
  updateProviderConnectionRoute,
  verifyProviderConnectionRoute,
  syncProviderModelsRoute,
  runProviderCatalogSyncJobRoute,
  getProviderCatalogSyncJobRoute,
  pullOllamaModelRoute,
  deleteOllamaModelRoute,
  listProviderModelsRoute,
  updateProviderModelPricingRoute,
  updateProviderModelCapabilitiesRoute,
  updateProviderModelEnabledRoute,
  getProviderOperationalSummaryRoute,
] as const;
