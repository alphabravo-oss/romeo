import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";
import {
  AuthProviderConnectionTestReportSchema,
  AuthProviderIdSchema,
  AuthProviderProtocolSchema,
  CreateManagedSecretRequestSchema,
  DeprovisionSsoOidcUserRequestSchema,
  ManagedSecretReferenceSchema,
  SsoOidcDeprovisionResultSchema,
  TestAuthProviderConnectionRequestSchema,
} from "./auth-provider-administration-extra-schemas";

export {
  AuthProviderConnectionTestReportSchema,
  AuthProviderIdSchema,
  CreateManagedSecretRequestSchema,
  DeprovisionSsoOidcUserRequestSchema,
  ManagedSecretReferenceSchema,
  SsoOidcDeprovisionResultSchema,
  TestAuthProviderConnectionRequestSchema,
} from "./auth-provider-administration-extra-schemas";

const identifier = z.string().trim().min(1).max(300);
const timestamp = z.iso.datetime();
const count = z.number().int().nonnegative();
const nullableString = (maximum: number) =>
  z.string().min(1).max(maximum).nullable().optional();
const stringMap = (keyMaximum: number, valueMaximum: number) =>
  z
    .record(
      z.string().min(1).max(keyMaximum),
      z.string().min(1).max(valueMaximum),
    )
    .nullable()
    .optional();
const body = <T extends z.ZodType>(schema: T) => ({
  required: true as const,
  content: { "application/json": { schema } },
});

export const AuthProviderCatalogEntrySchema = z
  .strictObject({
    id: AuthProviderIdSchema,
    name: z.string(),
    protocol: AuthProviderProtocolSchema,
    configurationScopes: z.array(z.enum(["global", "org"])),
    runtimePackage: z.string().nullable(),
    status: z.enum(["implemented", "planned"]),
    supportsJitProvisioning: z.boolean(),
    supportsLocalFallback: z.boolean(),
    supportsMfaDelegation: z.boolean(),
    notes: z.array(z.string()),
  })
  .openapi("AuthProviderCatalogEntry");

const AuthProviderOidcConnectionSummarySchema = z
  .strictObject({
    issuerConfigured: z.boolean(),
    issuerHost: z.string().optional(),
    clientIdConfigured: z.boolean(),
    groupClaim: z.string(),
    adminGroupCount: count,
    groupMappingCount: count,
    workspaceGroupMappingCount: count,
    workspaceGroupPrefixConfigured: z.boolean(),
  })
  .openapi("AuthProviderOidcConnectionSummary");
const AuthProviderOAuth2ConnectionSummarySchema = z
  .strictObject({
    adminTeamCount: count,
    clientIdConfigured: z.boolean(),
    groupMappingCount: count,
    requiredOrganizationCount: count,
    requiredTeamCount: count,
    scopeCount: count,
    workspaceTeamMappingCount: count,
    workspaceTeamPrefixConfigured: z.boolean(),
  })
  .openapi("AuthProviderOAuth2ConnectionSummary");
const AuthProviderLdapConnectionSummarySchema = z
  .strictObject({
    adminGroupCount: count,
    baseDnConfigured: z.boolean(),
    bindDnConfigured: z.boolean(),
    groupMappingCount: count,
    groupSearchConfigured: z.boolean(),
    requiredGroupCount: count,
    startTls: z.boolean(),
    urlConfigured: z.boolean(),
    urlHost: z.string().optional(),
    userSearchFilterConfigured: z.boolean(),
    workspaceGroupMappingCount: count,
    workspaceGroupPrefixConfigured: z.boolean(),
  })
  .openapi("AuthProviderLdapConnectionSummary");
const AuthProviderSamlConnectionSummarySchema = z
  .strictObject({
    acceptedClockSkewMs: count,
    adminGroupCount: count,
    emailAttribute: z.string(),
    entryPointConfigured: z.boolean(),
    entryPointHost: z.string().optional(),
    groupMappingCount: count,
    groupsAttribute: z.string(),
    idpIssuerConfigured: z.boolean(),
    maxAssertionAgeMs: count,
    nameAttribute: z.string(),
    requiredGroupCount: count,
    signedAssertionRequired: z.literal(true),
    signedResponseRequired: z.boolean(),
    spEntityIdConfigured: z.boolean(),
    subjectAttribute: z.string(),
    workspaceGroupMappingCount: count,
    workspaceGroupPrefixConfigured: z.boolean(),
  })
  .openapi("AuthProviderSamlConnectionSummary");
const connectionSummaries = {
  ldap: AuthProviderLdapConnectionSummarySchema.optional(),
  oidc: AuthProviderOidcConnectionSummarySchema.optional(),
  oauth2: AuthProviderOAuth2ConnectionSummarySchema.optional(),
  saml: AuthProviderSamlConnectionSummarySchema.optional(),
};
const baseSetting = {
  providerId: AuthProviderIdSchema,
  disabledReason: z.string().optional(),
  ...connectionSummaries,
  secretRefConfigured: z.boolean(),
  secretRefScheme: z.string().optional(),
};

export const AuthProviderSettingSummarySchema = z
  .strictObject({
    ...baseSetting,
    enabled: z.boolean(),
    displayName: z.string(),
    loginOrder: z.number().int(),
    allowedEmailDomains: z.array(z.string()),
    orgOverridesAllowed: z.boolean(),
    source: z.enum(["default", "global", "org"]),
  })
  .openapi("AuthProviderSettingSummary");
export const AuthProviderOrgOverrideSummarySchema = z
  .strictObject({
    ...baseSetting,
    enabled: z.boolean().optional(),
    displayName: z.string().optional(),
    loginOrder: z.number().int().optional(),
    allowedEmailDomains: z.array(z.string()).optional(),
    source: z.literal("org"),
  })
  .openapi("AuthProviderOrgOverrideSummary");
export const EffectiveAuthProviderSettingSchema =
  AuthProviderSettingSummarySchema.extend({
    catalogStatus: z.enum(["implemented", "planned"]),
    protocol: AuthProviderProtocolSchema,
    runtimePackage: z.string().nullable(),
  }).openapi("EffectiveAuthProviderSetting");

export const AuthProviderSettingsReportSchema = z
  .strictObject({
    generatedAt: timestamp,
    global: z.strictObject({
      providers: z.array(AuthProviderSettingSummarySchema),
    }),
    orgOverride: z.strictObject({
      orgId: identifier,
      providers: z.array(AuthProviderOrgOverrideSummarySchema),
    }),
    effective: z.strictObject({
      orgId: identifier,
      providers: z.array(EffectiveAuthProviderSettingSchema),
    }),
    notes: z.array(z.string()),
  })
  .openapi("AuthProviderSettingsReport");

const AuthProviderOidcConnectionPatchSchema = z
  .strictObject({
    issuerUrl: z
      .union([z.string().url(), z.literal("")])
      .nullable()
      .optional(),
    clientId: z.string().max(200).nullable().optional(),
    groupClaim: z.string().min(1).max(100).nullable().optional(),
    adminGroups: z
      .array(z.string().min(1).max(200))
      .max(100)
      .nullable()
      .optional(),
    groupMap: stringMap(200, 200),
    workspaceGroupMap: stringMap(200, 200),
    workspaceGroupPrefix: z.string().max(200).nullable().optional(),
  })
  .openapi("AuthProviderOidcConnectionPatch");
const AuthProviderOAuth2ConnectionPatchSchema = z
  .strictObject({
    adminTeams: z
      .array(z.string().min(1).max(200))
      .max(100)
      .nullable()
      .optional(),
    clientId: z.string().max(200).nullable().optional(),
    groupMap: stringMap(240, 200),
    requiredOrganizations: z
      .array(z.string().min(1).max(100))
      .max(100)
      .nullable()
      .optional(),
    requiredTeams: z
      .array(z.string().min(1).max(200))
      .max(100)
      .nullable()
      .optional(),
    scopes: z.array(z.string().min(1).max(100)).max(20).nullable().optional(),
    workspaceTeamMap: stringMap(240, 200),
    workspaceTeamPrefix: z.string().max(200).nullable().optional(),
  })
  .openapi("AuthProviderOAuth2ConnectionPatch");
const AuthProviderLdapConnectionPatchSchema = z
  .strictObject({
    adminGroups: z
      .array(z.string().min(1).max(240))
      .max(100)
      .nullable()
      .optional(),
    baseDn: nullableString(500),
    bindDn: nullableString(500),
    emailAttribute: nullableString(80),
    groupMap: stringMap(240, 200),
    groupNameAttribute: nullableString(80),
    groupSearchBaseDn: nullableString(500),
    groupSearchFilter: nullableString(500),
    nameAttribute: nullableString(80),
    requiredGroups: z
      .array(z.string().min(1).max(240))
      .max(100)
      .nullable()
      .optional(),
    startTls: z.boolean().nullable().optional(),
    url: nullableString(500),
    userIdAttribute: nullableString(80),
    userSearchFilter: nullableString(500),
    workspaceGroupMap: stringMap(240, 200),
    workspaceGroupPrefix: z.string().max(200).nullable().optional(),
  })
  .openapi("AuthProviderLdapConnectionPatch");
const AuthProviderSamlConnectionPatchSchema = z
  .strictObject({
    acceptedClockSkewMs: z
      .number()
      .int()
      .min(0)
      .max(300_000)
      .nullable()
      .optional(),
    adminGroups: z
      .array(z.string().min(1).max(240))
      .max(100)
      .nullable()
      .optional(),
    emailAttribute: nullableString(200),
    entryPoint: nullableString(500),
    groupMap: stringMap(240, 200),
    groupsAttribute: nullableString(200),
    idpIssuer: nullableString(500),
    maxAssertionAgeMs: z
      .number()
      .int()
      .min(0)
      .max(3_600_000)
      .nullable()
      .optional(),
    nameAttribute: nullableString(200),
    requiredGroups: z
      .array(z.string().min(1).max(240))
      .max(100)
      .nullable()
      .optional(),
    spEntityId: nullableString(500),
    subjectAttribute: nullableString(200),
    wantAuthnResponseSigned: z.boolean().nullable().optional(),
    workspaceGroupMap: stringMap(240, 200),
    workspaceGroupPrefix: z.string().max(200).nullable().optional(),
  })
  .openapi("AuthProviderSamlConnectionPatch");
const sharedPatch = {
  providerId: AuthProviderIdSchema,
  clear: z.boolean().optional(),
  displayName: z.string().min(1).max(100).nullable().optional(),
  loginOrder: z.number().int().min(0).max(1000).nullable().optional(),
  allowedEmailDomains: z
    .array(z.string().min(1).max(253))
    .max(100)
    .nullable()
    .optional(),
  disabledReason: z.string().min(1).max(200).nullable().optional(),
  ldap: AuthProviderLdapConnectionPatchSchema.nullable().optional(),
  oauth2: AuthProviderOAuth2ConnectionPatchSchema.nullable().optional(),
  oidc: AuthProviderOidcConnectionPatchSchema.nullable().optional(),
  saml: AuthProviderSamlConnectionPatchSchema.nullable().optional(),
  secretRef: z.string().min(1).max(500).nullable().optional(),
};
const AuthProviderGlobalPatchSchema = z
  .strictObject({
    ...sharedPatch,
    enabled: z.boolean().optional(),
    orgOverridesAllowed: z.boolean().optional(),
  })
  .openapi("AuthProviderGlobalPatch");
const AuthProviderOrgOverridePatchSchema = z
  .strictObject({
    ...sharedPatch,
    enabled: z.boolean().nullable().optional(),
  })
  .openapi("AuthProviderOrgOverridePatch");

export const UpdateAuthProviderSettingsRequestSchema = z
  .strictObject({
    confirmDisableLocalFallback: z.boolean().optional(),
    global: z
      .strictObject({
        providers: z.array(AuthProviderGlobalPatchSchema).min(1).max(50),
      })
      .optional(),
    orgOverride: z
      .strictObject({
        orgId: z.string().min(1).max(120).optional(),
        providers: z.array(AuthProviderOrgOverridePatchSchema).min(1).max(50),
      })
      .optional(),
  })
  .openapi("UpdateAuthProviderSettingsRequest");

const metadata = {
  tags: ["Authentication provider administration"],
  security: authenticationSecurity,
};
export const listAuthProviderCatalogRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/admin/auth-providers/catalog",
  operationId: "authProviderAdministration.listCatalog",
  summary: "List enterprise authentication provider catalog entries",
  responses: {
    200: jsonResponse(
      "Authentication provider catalog",
      dataEnvelope(z.array(AuthProviderCatalogEntrySchema)),
    ),
    ...standardErrorResponses,
  },
});
export const getAuthProviderSettingsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/admin/auth-providers/settings",
  operationId: "authProviderAdministration.getSettings",
  summary: "Get sanitized authentication provider settings",
  responses: {
    200: jsonResponse(
      "Authentication provider settings",
      dataEnvelope(AuthProviderSettingsReportSchema),
    ),
    ...standardErrorResponses,
  },
});
export const updateAuthProviderSettingsRoute = createRoute({
  ...metadata,
  method: "patch",
  path: "/api/v1/admin/auth-providers/settings",
  operationId: "authProviderAdministration.updateSettings",
  summary: "Update global or organization authentication provider settings",
  request: { body: body(UpdateAuthProviderSettingsRequestSchema) },
  responses: {
    200: jsonResponse(
      "Authentication provider settings",
      dataEnvelope(AuthProviderSettingsReportSchema),
    ),
    ...standardErrorResponses,
  },
});
export const testAuthProviderConnectionRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/admin/auth-providers/settings/test",
  operationId: "authProviderAdministration.testConnection",
  summary: "Test an authentication provider without exposing secrets",
  request: { body: body(TestAuthProviderConnectionRequestSchema) },
  responses: {
    200: jsonResponse(
      "Authentication provider connection test",
      dataEnvelope(AuthProviderConnectionTestReportSchema),
    ),
    ...standardErrorResponses,
  },
});
export const createManagedSecretRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/admin/secrets",
  operationId: "authProviderAdministration.createManagedSecret",
  summary: "Store a managed secret and return its one-time reference",
  request: { body: body(CreateManagedSecretRequestSchema) },
  responses: {
    201: jsonResponse(
      "Managed secret reference",
      dataEnvelope(ManagedSecretReferenceSchema),
    ),
    ...standardErrorResponses,
  },
});
export const deprovisionSsoOidcUserRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/admin/sso/oidc/deprovision",
  operationId: "authProviderAdministration.deprovisionOidcUser",
  summary: "Disable a user mapped from an OIDC issuer and subject",
  request: { body: body(DeprovisionSsoOidcUserRequestSchema) },
  responses: {
    200: jsonResponse(
      "OIDC deprovisioning result",
      dataEnvelope(SsoOidcDeprovisionResultSchema),
    ),
    ...standardErrorResponses,
  },
});

export const authProviderAdministrationRoutes = [
  listAuthProviderCatalogRoute,
  getAuthProviderSettingsRoute,
  updateAuthProviderSettingsRoute,
  testAuthProviderConnectionRoute,
  createManagedSecretRoute,
  deprovisionSsoOidcUserRoute,
] as const;
