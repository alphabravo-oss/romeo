import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";
import { DataConnectorTypeSchema } from "./data-connectors";

const id = z.string().trim().min(1).max(300);
const timestamp = z.iso.datetime();
const nonNegativeInteger = z.number().int().nonnegative();

export const DelegatedOAuthProviderSchema = z
  .strictObject({
    authorizationHost: z.string(),
    configured: z.boolean(),
    connectorTypes: z.array(DataConnectorTypeSchema),
    defaultScopes: z.array(z.string()),
    displayName: z.string(),
    id: z.literal("github"),
    pkceRequired: z.boolean(),
    tokenHost: z.string(),
  })
  .openapi("DelegatedOAuthProvider");

export const DelegatedOAuthConnectionSchema = z
  .strictObject({
    id,
    workspaceId: id,
    userId: id,
    providerId: z.literal("github"),
    connectorType: DataConnectorTypeSchema,
    providerAccountHash: z.string(),
    providerAccountLoginConfigured: z.boolean(),
    providerAccountLoginHash: z.string().optional(),
    providerRevocationErrorCode: z.string().optional(),
    providerRevocationStatus: z
      .enum(["failed", "skipped", "succeeded"])
      .optional(),
    scopes: z.array(z.string()),
    status: z.enum(["active", "reauthorization_required", "revoked"]),
    accessTokenExpiresAt: timestamp.optional(),
    refreshTokenExpiresAt: timestamp.optional(),
    lastUsedAt: timestamp.optional(),
    revokedAt: timestamp.optional(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .openapi("DelegatedOAuthConnection");

export const StartDelegatedOAuthSchema = z
  .strictObject({
    providerId: z.literal("github"),
    workspaceId: id,
    connectorType: DataConnectorTypeSchema,
    scopes: z.array(z.string().min(1).max(120)).max(20).optional(),
    returnTo: z.string().max(500).optional(),
  })
  .openapi("StartDelegatedOAuthRequest");

export const DelegatedOAuthStartResultSchema = z
  .strictObject({
    authorizationUrl: z.url(),
    connectorType: DataConnectorTypeSchema,
    expiresAt: timestamp,
    provider: DelegatedOAuthProviderSchema,
    scopes: z.array(z.string()),
    workspaceId: id,
  })
  .openapi("DelegatedOAuthStartResult");

const DelegatedOAuthConnectionPostureCountsSchema = z
  .strictObject({
    active: nonNegativeInteger,
    expiredAccessToken: nonNegativeInteger,
    expiringAccessToken: nonNegativeInteger,
    reauthorizationRequired: nonNegativeInteger,
    revoked: nonNegativeInteger,
    total: nonNegativeInteger,
    unused: nonNegativeInteger,
  })
  .openapi("DelegatedOAuthConnectionPostureCounts");

const DelegatedOAuthConnectorTypePostureSchema = z
  .strictObject({
    connectorType: DataConnectorTypeSchema,
    connectionCounts: DelegatedOAuthConnectionPostureCountsSchema,
  })
  .openapi("DelegatedOAuthConnectorTypePosture");

const DelegatedOAuthProviderPostureSchema = z
  .strictObject({
    authorizationHost: z.string(),
    configured: z.boolean(),
    connectorTypes: z.array(DataConnectorTypeSchema),
    connectionCounts: DelegatedOAuthConnectionPostureCountsSchema,
    defaultScopeCount: nonNegativeInteger,
    displayName: z.string(),
    id: z.literal("github"),
    pkceRequired: z.literal(true),
    tokenHost: z.string(),
  })
  .openapi("DelegatedOAuthProviderPosture");

export const DelegatedOAuthPostureSchema = z
  .strictObject({
    connectorTypes: z.array(DelegatedOAuthConnectorTypePostureSchema),
    generatedAt: timestamp,
    orgId: id,
    providers: z.array(DelegatedOAuthProviderPostureSchema),
    redaction: z.strictObject({
      rawAccessTokensReturned: z.literal(false),
      rawClientSecretsReturned: z.literal(false),
      rawProviderAccountIdsReturned: z.literal(false),
      rawProviderAccountLoginsReturned: z.literal(false),
      rawProviderUrlsReturned: z.literal(false),
      rawRefreshTokensReturned: z.literal(false),
    }),
    schema: z.literal("romeo.delegated-oauth-posture.v1"),
    status: z.enum(["attention_required", "healthy"]),
    warnings: z.array(z.string()),
  })
  .openapi("DelegatedOAuthPostureReport");

const metadata = {
  tags: ["Delegated OAuth"],
  security: authenticationSecurity,
};
const errors = standardErrorResponses;

export const listDelegatedOAuthProvidersRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/delegated-oauth/providers",
  operationId: "delegatedOAuth.listProviders",
  summary: "List delegated OAuth providers available for connectors",
  responses: {
    200: jsonResponse(
      "Delegated OAuth providers",
      dataEnvelope(z.array(DelegatedOAuthProviderSchema)),
    ),
    ...errors,
  },
});

export const getDelegatedOAuthPostureRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/admin/delegated-oauth/posture",
  operationId: "delegatedOAuth.getPosture",
  summary: "Get sanitized delegated OAuth operational posture",
  responses: {
    200: jsonResponse(
      "Delegated OAuth posture",
      dataEnvelope(DelegatedOAuthPostureSchema),
    ),
    ...errors,
  },
});

export const startDelegatedOAuthRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/delegated-oauth/start",
  operationId: "delegatedOAuth.start",
  summary: "Start a delegated OAuth connector authorization flow",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: StartDelegatedOAuthSchema } },
    },
  },
  responses: {
    200: jsonResponse(
      "Delegated OAuth authorization redirect URL",
      dataEnvelope(DelegatedOAuthStartResultSchema),
    ),
    ...errors,
  },
});

export const listDelegatedOAuthConnectionsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/delegated-oauth/connections",
  operationId: "delegatedOAuth.listConnections",
  summary: "List delegated OAuth connector account links",
  request: {
    query: z.strictObject({ workspaceId: id.optional() }),
  },
  responses: {
    200: jsonResponse(
      "Delegated OAuth connections",
      dataEnvelope(z.array(DelegatedOAuthConnectionSchema)),
    ),
    ...errors,
  },
});

export const revokeDelegatedOAuthConnectionRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/delegated-oauth/connections/{connectionId}/revoke",
  operationId: "delegatedOAuth.revokeConnection",
  summary: "Revoke a delegated OAuth connector account link",
  request: { params: z.strictObject({ connectionId: id }) },
  responses: {
    200: jsonResponse(
      "Revoked delegated OAuth connection",
      dataEnvelope(DelegatedOAuthConnectionSchema),
    ),
    ...errors,
  },
});

export const completeDelegatedOAuthRoute = createRoute({
  method: "get",
  path: "/api/v1/delegated-oauth/callback",
  operationId: "delegatedOAuth.complete",
  tags: ["Delegated OAuth"],
  security: [],
  summary: "Receive delegated OAuth provider callback",
  request: {
    query: z.strictObject({
      code: z.string().optional(),
      state: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  responses: {
    302: { description: "Redirects to the requested in-app return path" },
    400: errors[400],
    409: errors[409],
    500: errors[500],
  },
});

export const delegatedOAuthRoutes = [
  listDelegatedOAuthProvidersRoute,
  getDelegatedOAuthPostureRoute,
  startDelegatedOAuthRoute,
  listDelegatedOAuthConnectionsRoute,
  revokeDelegatedOAuthConnectionRoute,
  completeDelegatedOAuthRoute,
] as const;
