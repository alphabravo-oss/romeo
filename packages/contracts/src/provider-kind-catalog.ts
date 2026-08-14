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

const configurationFieldId = z.enum([
  "baseUrl",
  "credentialRef",
  "modelIds",
  "name",
]);

export const ProviderKindConfigurationFieldSchema = z
  .strictObject({
    id: configurationFieldId,
    input: z.enum(["identifier_list", "secret_reference", "text", "url"]),
    required: z.boolean(),
    writeOnly: z.boolean(),
    sensitive: z.boolean(),
    maxLength: z.number().int().positive().max(10_000).optional(),
    maxItems: z.number().int().positive().max(10_000).optional(),
    copyKey: z
      .string()
      .regex(/^providerSetupField(?:BaseUrl|CredentialRef|ModelIds|Name)$/u),
  })
  .openapi("ProviderKindConfigurationField");

export const ProviderKindCatalogEntrySchema = z
  .strictObject({
    kind: ProviderKindSchema,
    defaultClassification: z.enum(["external", "local"]),
    supportedClassifications: z
      .array(z.enum(["external", "local"]))
      .min(1)
      .max(2)
      .refine((values) => new Set(values).size === values.length),
    displayName: z.string().trim().min(1).max(100),
    dialect: ProviderDialectSummarySchema,
    defaultCapabilities: ProviderCapabilitiesSchema,
    configuration: z.strictObject({
      schemaVersion: z.literal(1),
      fields: z.array(ProviderKindConfigurationFieldSchema).min(3).max(8),
    }),
  })
  .openapi("ProviderKindCatalogEntry");

export const listProviderKindsRoute = createRoute({
  tags: ["Providers"],
  security: authenticationSecurity,
  method: "get",
  path: "/api/v1/provider-kinds",
  operationId: "providers.listKinds",
  summary: "List installed provider kinds and safe setup metadata",
  description:
    "Returns static provider protocol and configuration-field metadata. It never returns configured endpoints, credential references, secret values, or tenant provider instances.",
  responses: {
    200: jsonResponse(
      "Installed provider kinds",
      dataEnvelope(z.array(ProviderKindCatalogEntrySchema).max(32)),
    ),
    401: standardErrorResponses[401],
    403: standardErrorResponses[403],
    500: standardErrorResponses[500],
  },
});

export const providerKindCatalogRoutes = [listProviderKindsRoute] as const;

export type ProviderKindCatalogEntry = z.infer<
  typeof ProviderKindCatalogEntrySchema
>;
