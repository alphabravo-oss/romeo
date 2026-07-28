import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";

const identifier = z.string().trim().min(1).max(300);
const timestamp = z.iso.datetime();
const count = z.number().int().nonnegative();
const body = <T extends z.ZodType>(schema: T, required = true) => ({
  required,
  content: { "application/json": { schema } },
});

export const SsoOidcProviderPresetIdSchema = z.enum([
  "generic",
  "keycloak",
  "google",
  "github",
  "azure-ad",
  "okta",
  "auth0",
]);
export const SsoOidcProviderPresetSchema = z
  .strictObject({
    id: SsoOidcProviderPresetIdSchema,
    name: z.string(),
    recommendedGroupClaim: z.string(),
    issuerHint: z.string(),
    notes: z.array(z.string()),
  })
  .openapi("SsoOidcProviderPreset");
export const SsoSettingsReportSchema = z
  .strictObject({
    generatedAt: timestamp,
    configurationSource: z.enum(["database", "environment"]),
    status: z.enum(["disabled", "enabled", "partial"]),
    localLogin: z.strictObject({
      seededDevelopmentLoginEnabled: z.boolean(),
    }),
    oidc: z.strictObject({
      detectedProviderPreset: SsoOidcProviderPresetIdSchema,
      providerPresets: z.array(SsoOidcProviderPresetSchema),
      bearerTokenAuthEnabled: z.boolean(),
      browserPkceLoginEnabled: z.boolean(),
      issuerConfigured: z.boolean(),
      issuerHost: z.string().optional(),
      clientIdConfigured: z.boolean(),
      groupClaim: z.string(),
      adminGroupCount: count,
      groupMappingCount: count,
      workspaceGroupMappingCount: count,
      workspaceGroupPrefixConfigured: z.boolean(),
      jitProvisioningEnabled: z.boolean(),
      accountLinkingEnabled: z.literal(false),
    }),
    notes: z.array(z.string()),
  })
  .openapi("SsoSettingsReport");

const SsoStringMapSchema = z.record(
  z.string().min(1).max(200),
  z.string().min(1).max(200),
);
export const UpdateSsoSettingsRequestSchema = z
  .strictObject({
    oidc: z.strictObject({
      enabled: z.boolean().optional(),
      issuerUrl: z.union([z.string().url(), z.literal("")]).optional(),
      clientId: z.string().max(200).optional(),
      groupClaim: z.string().min(1).max(100).optional(),
      adminGroups: z.array(z.string().min(1).max(200)).max(100).optional(),
      groupMap: SsoStringMapSchema.optional(),
      workspaceGroupMap: SsoStringMapSchema.optional(),
      workspaceGroupPrefix: z.string().max(200).optional(),
      providerPreset: SsoOidcProviderPresetIdSchema.optional(),
    }),
  })
  .openapi("UpdateSsoSettingsRequest");

const SsoConnectionTestCheckSchema = z
  .strictObject({
    id: z.enum(["configuration", "discovery", "jwks"]),
    status: z.enum(["fail", "pass", "skip"]),
    code: z.string(),
  })
  .openapi("SsoConnectionTestCheck");
export const SsoConnectionTestReportSchema = z
  .strictObject({
    generatedAt: timestamp,
    status: z.enum(["disabled", "failed", "partial", "passed"]),
    issuerHost: z.string().optional(),
    checks: z.array(SsoConnectionTestCheckSchema),
    notes: z.array(z.string()),
  })
  .openapi("SsoConnectionTestReport");

export const SecretRewrapPreviewRequestSchema = z
  .strictObject({
    includeDisabledMfaFactors: z.boolean().optional(),
    includeGlobalManagedSecrets: z.boolean().optional(),
    targetOrgId: z.string().trim().min(1).max(120).optional(),
  })
  .openapi("SecretRewrapPreviewRequest");
export const SecretRewrapExecuteRequestSchema =
  SecretRewrapPreviewRequestSchema.extend({
    confirmRewrap: z.literal("rewrap-secret-envelopes"),
  }).openapi("SecretRewrapExecuteRequest");

const SecretRewrapCountSummaryShape = {
  currentKeyConfigured: z.boolean(),
  decryptableCount: count,
  eligibleCount: count,
  failedCount: count,
  failureCodes: z.array(z.string()),
  previousKeyConfigured: z.boolean(),
  previousKeyDecryptableCount: count,
  rewrappedCount: count,
};
const SecretRewrapLocalMfaSummarySchema = z
  .strictObject({
    ...SecretRewrapCountSummaryShape,
    activeFactorCount: count,
    disabledFactorCount: count,
    pendingFactorCount: count,
    totpSecretsReturned: z.literal(false),
  })
  .openapi("SecretRewrapLocalMfaSummary");
const SecretRewrapManagedSecretSummarySchema = z
  .strictObject({
    ...SecretRewrapCountSummaryShape,
    globalSecretCount: count,
    orgSecretCount: count,
    secretRefsReturned: z.literal(false),
    secretValuesReturned: z.literal(false),
  })
  .openapi("SecretRewrapManagedSecretSummary");
export const SecretRewrapReportSchema = z
  .strictObject({
    schema: z.literal("romeo.secret-rotation-rewrap.v1"),
    generatedAt: timestamp,
    mode: z.enum(["apply", "preview"]),
    orgId: identifier,
    status: z.enum(["blocked", "completed", "partial", "ready"]),
    scope: z.strictObject({
      includeDisabledMfaFactors: z.boolean(),
      includeGlobalManagedSecrets: z.boolean(),
      targetOrgId: identifier,
    }),
    localMfa: SecretRewrapLocalMfaSummarySchema,
    managedSecrets: SecretRewrapManagedSecretSummarySchema,
    warnings: z.array(z.string()),
    redaction: z.strictObject({
      factorIdsReturned: z.literal(false),
      keyMaterialReturned: z.literal(false),
      rawSecretValuesReturned: z.literal(false),
      secretRefsReturned: z.literal(false),
      totpSecretsReturned: z.literal(false),
      userEmailsReturned: z.literal(false),
    }),
  })
  .openapi("SecretRewrapReport");

const metadata = {
  tags: ["SSO administration"],
  security: authenticationSecurity,
};
export const getSsoSettingsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/admin/sso-settings",
  operationId: "ssoAdministration.getSettings",
  summary: "Get sanitized SSO settings",
  responses: {
    200: jsonResponse(
      "Sanitized SSO settings",
      dataEnvelope(SsoSettingsReportSchema),
    ),
    ...standardErrorResponses,
  },
});
export const updateSsoSettingsRoute = createRoute({
  ...metadata,
  method: "patch",
  path: "/api/v1/admin/sso-settings",
  operationId: "ssoAdministration.updateSettings",
  summary: "Update sanitized SSO settings",
  request: { body: body(UpdateSsoSettingsRequestSchema) },
  responses: {
    200: jsonResponse(
      "Sanitized SSO settings",
      dataEnvelope(SsoSettingsReportSchema),
    ),
    ...standardErrorResponses,
  },
});
export const testSsoSettingsRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/admin/sso-settings/test",
  operationId: "ssoAdministration.testSettings",
  summary: "Test sanitized OIDC discovery and JWKS reachability",
  responses: {
    200: jsonResponse(
      "Sanitized SSO connection test",
      dataEnvelope(SsoConnectionTestReportSchema),
    ),
    ...standardErrorResponses,
  },
});
export const previewSecretRewrapRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/admin/secret-rotation/rewrap/preview",
  operationId: "ssoAdministration.previewSecretRewrap",
  summary: "Preview encrypted secret-envelope rewrap readiness",
  request: { body: body(SecretRewrapPreviewRequestSchema, false) },
  responses: {
    200: jsonResponse(
      "Secret rewrap preview",
      dataEnvelope(SecretRewrapReportSchema),
    ),
    ...standardErrorResponses,
  },
});
export const executeSecretRewrapRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/admin/secret-rotation/rewrap",
  operationId: "ssoAdministration.executeSecretRewrap",
  summary: "Rewrap encrypted secret envelopes with the active key",
  request: { body: body(SecretRewrapExecuteRequestSchema) },
  responses: {
    200: jsonResponse(
      "Secret rewrap report",
      dataEnvelope(SecretRewrapReportSchema),
    ),
    ...standardErrorResponses,
  },
});

export const ssoAdministrationRoutes = [
  getSsoSettingsRoute,
  updateSsoSettingsRoute,
  testSsoSettingsRoute,
  previewSecretRewrapRoute,
  executeSecretRewrapRoute,
] as const;
