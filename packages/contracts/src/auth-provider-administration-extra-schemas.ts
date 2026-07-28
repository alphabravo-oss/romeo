import { z } from "@hono/zod-openapi";

const identifier = z.string().trim().min(1).max(300);
const timestamp = z.iso.datetime();

export const AuthProviderIdSchema = z.enum([
  "local",
  "generic-oidc",
  "keycloak",
  "google",
  "github",
  "azure-ad",
  "okta",
  "auth0",
  "ldap",
  "active-directory",
  "saml",
]);

export const AuthProviderProtocolSchema = z.enum([
  "ldap",
  "local",
  "oauth2",
  "oidc",
  "saml",
]);

export const TestAuthProviderConnectionRequestSchema = z
  .strictObject({
    providerId: AuthProviderIdSchema,
    orgId: z.string().trim().min(1).max(200).optional(),
    oidc: z
      .strictObject({
        issuerUrl: z.union([z.string().url(), z.literal("")]).optional(),
        clientId: z.string().max(200).optional(),
      })
      .optional(),
    oauth2: z
      .strictObject({
        clientId: z.string().max(200).optional(),
        secretRef: z.string().min(1).max(500).optional(),
      })
      .optional(),
    ldap: z
      .strictObject({
        baseDn: z.string().min(1).max(500).optional(),
        bindDn: z.string().min(1).max(500).optional(),
        groupSearchBaseDn: z.string().min(1).max(500).optional(),
        groupSearchFilter: z.string().min(1).max(500).optional(),
        secretRef: z.string().min(1).max(500).optional(),
        startTls: z.boolean().optional(),
        url: z.string().min(1).max(500).optional(),
        userSearchFilter: z.string().min(1).max(500).optional(),
      })
      .optional(),
    saml: z
      .strictObject({
        entryPoint: z.string().max(500).optional(),
        idpCertificateRef: z.string().min(1).max(500).optional(),
        spEntityId: z.string().max(500).optional(),
      })
      .optional(),
  })
  .openapi("TestAuthProviderConnectionRequest");

export const AuthProviderConnectionTestReportSchema = z
  .strictObject({
    generatedAt: timestamp,
    providerId: AuthProviderIdSchema,
    catalogStatus: z.enum(["implemented", "planned"]),
    protocol: AuthProviderProtocolSchema,
    runtimePackage: z.string().nullable(),
    configurationSource: z.enum([
      "active_sso",
      "provider_settings",
      "transient_request",
    ]),
    status: z.enum(["disabled", "failed", "partial", "passed"]),
    enabled: z.boolean(),
    issuerHost: z.string().optional(),
    detectedProviderPreset: z.string().optional(),
    checks: z.array(
      z.strictObject({
        id: z.enum([
          "adapter",
          "api",
          "configuration",
          "discovery",
          "jwks",
          "ldap_bind",
          "ldap_search",
          "oauth2_endpoints",
          "saml_endpoints",
          "secret",
        ]),
        status: z.enum(["fail", "pass", "skip"]),
        code: z.string(),
      }),
    ),
    notes: z.array(z.string()),
  })
  .openapi("AuthProviderConnectionTestReport");

const ManagedSecretPurposeSchema = z.enum([
  "auth_provider_client_secret",
  "data_connector_credential",
  "model_provider_credential",
  "tool_connector_credential",
]);

export const CreateManagedSecretRequestSchema = z
  .strictObject({
    name: z.string().min(1).max(120).optional(),
    orgId: z.string().min(1).max(120).optional(),
    purpose: ManagedSecretPurposeSchema,
    scope: z.enum(["global", "org"]).optional(),
    storageDriver: z.enum(["local", "vault"]).optional(),
    targetSecretRef: z.string().min(1).max(500).optional(),
    value: z.string().min(1).max(20_000),
  })
  .openapi("CreateManagedSecretRequest");

export const ManagedSecretReferenceSchema = z
  .strictObject({
    createdAt: timestamp,
    nameConfigured: z.boolean(),
    orgId: identifier.optional(),
    purpose: ManagedSecretPurposeSchema,
    scope: z.enum(["global", "org"]),
    secretRef: z.string(),
    secretRefScheme: z.enum(["romeo-secret", "vault"]),
    storageDriver: z.enum(["local", "vault"]),
    valueStored: z.literal(true),
  })
  .openapi("ManagedSecretReference");

export const DeprovisionSsoOidcUserRequestSchema = z
  .strictObject({
    issuerUrl: z.string().url().optional(),
    oidcSubject: z.string().trim().min(1).max(200),
    confirmOidcSubject: z.string().trim().min(1).max(200),
  })
  .openapi("DeprovisionSsoOidcUserRequest");

export const SsoOidcDeprovisionResultSchema = z
  .strictObject({
    status: z.enum(["already_disabled", "disabled"]),
    issuerHost: z.string().optional(),
    user: z.strictObject({
      id: identifier,
      orgId: identifier,
      email: z.string().email(),
      name: z.string(),
      role: z.enum(["user", "org_admin", "global_admin"]).optional(),
      disabledAt: timestamp.optional(),
    }),
  })
  .openapi("SsoOidcDeprovisionResult");
