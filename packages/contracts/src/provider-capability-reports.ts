import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";
import {
  ProviderCapabilitiesSchema,
  ProviderKindSchema,
} from "./provider-capability-schemas";
import { ProviderDialectSummarySchema } from "./providers";

const identifier = z.string().trim().min(1).max(300);
const timestamp = z.iso.datetime();
const catalogStatus = z.enum(["error", "never", "ready", "stale", "syncing"]);

export const ProviderCapabilityReportSchema = z
  .strictObject({
    providerId: identifier,
    kind: ProviderKindSchema,
    enabled: z.boolean(),
    credentialConfigured: z.boolean(),
    dialect: ProviderDialectSummarySchema,
    advertisedDefaults: ProviderCapabilitiesSchema,
    configuredCapabilities: ProviderCapabilitiesSchema,
    catalog: z.strictObject({
      status: catalogStatus,
      modelCount: z.number().int().nonnegative().max(1_000_000),
      lastAttemptAt: timestamp.optional(),
      lastSyncedAt: timestamp.optional(),
    }),
    visibleModels: z.strictObject({
      total: z.number().int().nonnegative().max(1_000_000),
      enabled: z.number().int().nonnegative().max(1_000_000),
      available: z.number().int().nonnegative().max(1_000_000),
    }),
  })
  .openapi("ProviderCapabilityReport");

const modelCapabilityReason = z.enum([
  "available",
  "model_disabled",
  "model_unavailable",
  "provider_disabled",
]);

export const ProviderModelCapabilityReportSchema = z
  .strictObject({
    modelId: identifier,
    providerId: identifier,
    kind: ProviderKindSchema,
    name: z.string().trim().min(1).max(500),
    displayName: z.string().trim().min(1).max(500),
    enabled: z.boolean(),
    available: z.boolean(),
    capabilitySource: z.enum(["detected", "override"]),
    capabilities: ProviderCapabilitiesSchema,
    limits: z.strictObject({
      contextWindow: z.number().int().positive().max(10_000_000),
      defaultParameters: z
        .strictObject({
          temperature: z.number().min(0).max(2).optional(),
          topP: z.number().min(0).max(1).optional(),
          maxOutputTokens: z.number().int().positive().max(200_000).optional(),
        })
        .optional(),
    }),
    provider: z.strictObject({
      enabled: z.boolean(),
      dialect: ProviderDialectSummarySchema,
      catalogStatus,
    }),
    operationallyUsable: z.boolean(),
    operationalReason: modelCapabilityReason,
  })
  .openapi("ProviderModelCapabilityReport");

const providerPath = z.strictObject({ providerId: identifier });
const modelPath = z.strictObject({ modelId: identifier });
const readErrors = {
  401: standardErrorResponses[401],
  403: standardErrorResponses[403],
  404: standardErrorResponses[404],
  500: standardErrorResponses[500],
} as const;

export const getProviderCapabilityReportRoute = createRoute({
  tags: ["Providers"],
  security: authenticationSecurity,
  method: "get",
  path: "/api/v1/providers/{providerId}/capability-report",
  operationId: "providers.getCapabilityReport",
  summary: "Get an authorized provider capability report",
  description:
    "Separates registry defaults, configured provider capability posture, dialect operations, catalog freshness, and authorized model counts. It never returns endpoints or credentials.",
  request: { params: providerPath },
  responses: {
    200: jsonResponse(
      "Provider capability report",
      dataEnvelope(ProviderCapabilityReportSchema),
    ),
    ...readErrors,
  },
});

export const getProviderModelCapabilityReportRoute = createRoute({
  tags: ["Providers"],
  security: authenticationSecurity,
  method: "get",
  path: "/api/v1/models/{modelId}/capability-report",
  operationId: "providers.getModelCapabilityReport",
  summary: "Get an authorized provider-model capability report",
  description:
    "Reports detected or overridden model capability truth and current provider/model operational availability. Operational usability is not a substitute for workspace policy or action-time authorization.",
  request: { params: modelPath },
  responses: {
    200: jsonResponse(
      "Provider model capability report",
      dataEnvelope(ProviderModelCapabilityReportSchema),
    ),
    ...readErrors,
  },
});

export const providerCapabilityReportRoutes = [
  getProviderCapabilityReportRoute,
  getProviderModelCapabilityReportRoute,
] as const;

export type ProviderCapabilityReport = z.infer<
  typeof ProviderCapabilityReportSchema
>;
export type ProviderModelCapabilityReport = z.infer<
  typeof ProviderModelCapabilityReportSchema
>;
