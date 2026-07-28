import { createRoute, z } from "@hono/zod-openapi";

import { dataEnvelope, jsonResponse, standardErrorResponses } from "./common";

const tags = ["Federated authentication"];
const oidcProviderId = z.enum([
  "generic-oidc",
  "keycloak",
  "google",
  "azure-ad",
  "okta",
  "auth0",
]);
const oauth2ProviderId = z.literal("github");
const samlProviderId = z.literal("saml");
const returnTo = z.string().min(1).max(500).optional();
const orgId = z.string().min(1).max(120).optional();

export const OidcLoginStartQuerySchema = z.strictObject({
  orgId,
  providerId: oidcProviderId.optional(),
  returnTo,
});
export const OAuth2LoginStartQuerySchema = z.strictObject({
  orgId,
  providerId: oauth2ProviderId,
  returnTo,
});
export const SamlLoginStartQuerySchema = z.strictObject({
  orgId,
  providerId: samlProviderId.optional(),
  returnTo,
});
export const OidcLoginStartSchema = z
  .strictObject({
    authorizationUrl: z.string().url(),
    expiresAt: z.string().datetime(),
    orgId: z.string().min(1),
    providerId: oidcProviderId.optional(),
  })
  .openapi("OidcLoginStart");
export const OAuth2LoginStartSchema = z
  .strictObject({
    authorizationUrl: z.string().url(),
    expiresAt: z.string().datetime(),
    providerId: oauth2ProviderId,
  })
  .openapi("OAuth2LoginStart");
export const SamlLoginStartSchema = z
  .strictObject({
    authorizationUrl: z.string().url(),
    expiresAt: z.string().datetime(),
    providerId: samlProviderId,
  })
  .openapi("SamlLoginStart");
export const AuthorizationCallbackQuerySchema = z.strictObject({
  code: z.string().min(1).max(10_000).optional(),
  error: z.string().min(1).max(1_000).optional(),
  state: z.string().min(1).max(10_000).optional(),
});
export const SamlCallbackRequestSchema = z
  .object({
    SAMLResponse: z.string().min(1).max(200_000),
    RelayState: z.string().max(4_000).optional(),
  })
  .passthrough()
  .openapi("SamlCallbackRequest");
export const SamlMetadataQuerySchema = z.strictObject({
  orgId,
  providerId: samlProviderId.optional(),
});

const redirectResponse = {
  description:
    "Sets the local session cookie and redirects to the signed return path",
} as const;
const metadataResponse = {
  description: "SAML service-provider metadata XML",
  content: {
    "application/samlmetadata+xml": { schema: z.string() },
  },
} as const;

export const startOidcLoginRoute = createRoute({
  method: "get",
  path: "/api/v1/auth/oidc/start",
  operationId: "federatedAuth.startOidcLogin",
  tags,
  summary: "Start browser OIDC login with PKCE",
  security: [],
  request: { query: OidcLoginStartQuerySchema },
  responses: {
    200: jsonResponse(
      "OIDC authorization URL",
      dataEnvelope(OidcLoginStartSchema),
    ),
    ...standardErrorResponses,
  },
});
export const completeOidcLoginRoute = createRoute({
  method: "get",
  path: "/api/v1/auth/oidc/callback",
  operationId: "federatedAuth.completeOidcLogin",
  tags,
  summary: "Complete browser OIDC login with PKCE",
  security: [],
  request: { query: AuthorizationCallbackQuerySchema },
  responses: { 302: redirectResponse, ...standardErrorResponses },
});
export const startOAuth2LoginRoute = createRoute({
  method: "get",
  path: "/api/v1/auth/oauth2/start",
  operationId: "federatedAuth.startOAuth2Login",
  tags,
  summary: "Start browser OAuth2 login with PKCE",
  security: [],
  request: { query: OAuth2LoginStartQuerySchema },
  responses: {
    200: jsonResponse(
      "OAuth2 authorization URL",
      dataEnvelope(OAuth2LoginStartSchema),
    ),
    ...standardErrorResponses,
  },
});
export const completeOAuth2LoginRoute = createRoute({
  method: "get",
  path: "/api/v1/auth/oauth2/callback",
  operationId: "federatedAuth.completeOAuth2Login",
  tags,
  summary: "Complete browser OAuth2 login with PKCE",
  security: [],
  request: { query: AuthorizationCallbackQuerySchema },
  responses: { 302: redirectResponse, ...standardErrorResponses },
});
export const startSamlLoginRoute = createRoute({
  method: "get",
  path: "/api/v1/auth/saml/start",
  operationId: "federatedAuth.startSamlLogin",
  tags,
  summary: "Start browser SAML login",
  security: [],
  request: { query: SamlLoginStartQuerySchema },
  responses: {
    200: jsonResponse(
      "SAML authorization URL",
      dataEnvelope(SamlLoginStartSchema),
    ),
    ...standardErrorResponses,
  },
});
export const completeSamlLoginRoute = createRoute({
  method: "post",
  path: "/api/v1/auth/saml/callback",
  operationId: "federatedAuth.completeSamlLogin",
  tags,
  summary: "Complete browser SAML login through HTTP-POST ACS",
  security: [],
  request: {
    body: {
      required: true,
      content: {
        "application/x-www-form-urlencoded": {
          schema: SamlCallbackRequestSchema,
        },
        "multipart/form-data": { schema: SamlCallbackRequestSchema },
      },
    },
  },
  responses: { 302: redirectResponse, ...standardErrorResponses },
});
export const getSamlMetadataRoute = createRoute({
  method: "get",
  path: "/api/v1/auth/saml/metadata",
  operationId: "federatedAuth.getSamlMetadata",
  tags,
  summary: "Return SAML service-provider metadata XML",
  security: [],
  request: { query: SamlMetadataQuerySchema },
  responses: { 200: metadataResponse, ...standardErrorResponses },
});

export const federatedAuthRoutes = [
  startOidcLoginRoute,
  completeOidcLoginRoute,
  startOAuth2LoginRoute,
  completeOAuth2LoginRoute,
  startSamlLoginRoute,
  completeSamlLoginRoute,
  getSamlMetadataRoute,
] as const;
