import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  errorResponse,
  jsonResponse,
  standardErrorResponses,
} from "./common";

const identifier = z.string().trim().min(1).max(300);
const providerKind = z.enum([
  "anthropic",
  "openai-compatible",
  "openai-responses-compatible",
  "ollama",
]);
const modelModality = z.enum([
  "audio-input",
  "audio-output",
  "embeddings",
  "text",
  "vision",
]);

export const ProviderCapabilitiesSchema = z
  .strictObject({
    streaming: z.boolean(),
    toolCalling: z.boolean(),
    vision: z.boolean(),
    audioInput: z.boolean(),
    structuredJson: z.boolean(),
    reasoning: z.boolean(),
    imageGeneration: z.boolean().optional(),
    modalities: z.array(modelModality),
    deployment: z.strictObject({
      mode: z.enum(["hosted-api", "local-runtime"]),
      networkAccess: z.enum(["external-http", "local-http"]),
      credentialRequired: z.boolean(),
    }),
  })
  .openapi("ProviderCapabilities");

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
    credentialConfigured: z.boolean(),
    credentialRefScheme: z.string().optional(),
  })
  .openapi("ProviderConnection");

const imagePricing = z.strictObject({
  "1024x1024": z.number().nonnegative(),
  "1024x1536": z.number().nonnegative(),
  "1536x1024": z.number().nonnegative(),
});

export const ProviderModelSchema = z
  .strictObject({
    id: identifier,
    providerId: identifier,
    name: z.string().min(1),
    displayName: z.string().min(1),
    enabled: z.boolean(),
    capabilities: ProviderCapabilitiesSchema,
    contextWindow: z.number().int().positive(),
    pricing: z
      .strictObject({
        inputTokenUsd: z.number().nonnegative(),
        outputTokenUsd: z.number().nonnegative(),
        imageGenerationUsd: imagePricing.optional(),
      })
      .optional(),
    capabilitiesSource: z.enum(["detected", "override"]).optional(),
  })
  .openapi("ProviderModel");

export const CreateProviderConnectionSchema = z
  .strictObject({
    type: providerKind,
    name: z.string().trim().min(1).max(200),
    baseUrl: z.url(),
    credentialRef: z.string().trim().min(1).max(500).optional(),
    modelIds: z.array(identifier).max(100).optional(),
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

const operationalSummary = z
  .strictObject({
    alerts: z.array(
      z.strictObject({
        code: z.enum([
          "fallback_unavailable",
          "no_available_providers",
          "provider_circuit_open",
          "provider_disabled",
          "provider_kill_switch",
          "provider_without_enabled_models",
          "object_store_failures_recent",
          "provider_errors_recent",
          "queue_wait_high",
          "sse_disconnects_recent",
          "time_to_first_token_high",
        ]),
        id: identifier,
        modelId: identifier.optional(),
        providerId: identifier.optional(),
        severity: z.enum(["critical", "warning"]),
      }),
    ),
    fallback: z.strictObject({
      available: z.boolean(),
      configured: z.boolean(),
      modelId: identifier.optional(),
      providerId: identifier.optional(),
      reason: z
        .enum(["model_disabled", "model_missing", "provider_disabled"])
        .optional(),
    }),
    generatedAt: z.iso.datetime(),
    policy: z.strictObject({
      circuitCooldownMs: z.number().nonnegative(),
      circuitFailureThreshold: z.number().int().nonnegative(),
      disabledProviderIds: z.array(identifier),
      fallbackModelId: identifier.optional(),
      retryAttempts: z.number().int().nonnegative(),
      retryBackoffMs: z.number().nonnegative(),
      streamTimeoutMs: z.number().nonnegative(),
    }),
    providers: z.array(
      z.strictObject({
        circuit: z.strictObject({
          consecutiveFailures: z.number().int().nonnegative(),
          state: z.enum(["closed", "half_open", "open"]),
        }),
        enabled: z.boolean(),
        enabledModelCount: z.number().int().nonnegative(),
        killSwitchActive: z.boolean(),
        modelCount: z.number().int().nonnegative(),
        providerId: identifier,
        reasons: z.array(z.string()),
        status: z.enum(["available", "degraded", "unavailable"]),
        type: providerKind,
      }),
    ),
    runtime: z.strictObject({
      contextInputTokensAverage: z.number(),
      lookbackSeconds: z.number().nonnegative(),
      objectStoreFailureCount: z.number().nonnegative(),
      providerErrorCount: z.number().nonnegative(),
      queueWaitP95Ms: z.number().nonnegative(),
      recoveryCount: z.number().nonnegative(),
      sseDisconnectCount: z.number().nonnegative(),
      sseReconnectCount: z.number().nonnegative(),
      timeToFirstTokenAverageMs: z.number().nonnegative(),
      timeToFirstTokenP95Ms: z.number().nonnegative(),
      uploadPipelineAverageMs: z.number().nonnegative(),
      webRetrievalAverageMs: z.number().nonnegative(),
      outputThroughputAverage: z.number(),
    }),
    status: z.enum(["critical", "degraded", "healthy"]),
  })
  .openapi("ProviderOperationalSummary");

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
    "Preserves administrative capability and enabled-state overrides while synchronizing the remote catalog.",
  request: { params: providerPath },
  responses: {
    200: jsonResponse("Synchronized provider models", modelsResponse),
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
      enabled: z.enum(["true", "false"]).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
      offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
      providerId: identifier.optional(),
      q: z.string().trim().max(300).optional(),
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
      dataEnvelope(operationalSummary),
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
  pullOllamaModelRoute,
  deleteOllamaModelRoute,
  listProviderModelsRoute,
  updateProviderModelPricingRoute,
  updateProviderModelCapabilitiesRoute,
  updateProviderModelEnabledRoute,
  getProviderOperationalSummaryRoute,
] as const;
