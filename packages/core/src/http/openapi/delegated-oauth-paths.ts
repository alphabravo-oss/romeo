import { errorResponse, jsonContent, success } from "./helpers";

const delegatedOAuthProviderSchema = {
  type: "object",
  required: [
    "authorizationHost",
    "configured",
    "connectorTypes",
    "defaultScopes",
    "displayName",
    "id",
    "pkceRequired",
    "tokenHost",
  ],
  properties: {
    authorizationHost: { type: "string" },
    configured: { type: "boolean" },
    connectorTypes: {
      type: "array",
      items: {
        type: "string",
        enum: [
          "local_import",
          "github",
          "s3",
          "website",
          "rss",
          "confluence",
          "jira",
          "notion",
          "linear",
          "slack",
        ],
      },
    },
    defaultScopes: { type: "array", items: { type: "string" } },
    displayName: { type: "string" },
    id: { type: "string", enum: ["github"] },
    pkceRequired: { type: "boolean" },
    tokenHost: { type: "string" },
  },
} as const;

const startInputSchema = {
  type: "object",
  required: ["providerId", "workspaceId", "connectorType"],
  properties: {
    providerId: { type: "string", enum: ["github"] },
    workspaceId: { type: "string" },
    connectorType: {
      type: "string",
      enum: [
        "local_import",
        "github",
        "s3",
        "website",
        "rss",
        "confluence",
        "jira",
        "notion",
        "linear",
        "slack",
      ],
    },
    scopes: {
      type: "array",
      maxItems: 20,
      items: { type: "string", maxLength: 120 },
    },
    returnTo: { type: "string", maxLength: 500 },
  },
} as const;

const startResultSchema = {
  type: "object",
  required: [
    "authorizationUrl",
    "connectorType",
    "expiresAt",
    "provider",
    "scopes",
    "workspaceId",
  ],
  properties: {
    authorizationUrl: { type: "string", format: "uri" },
    connectorType: { type: "string", enum: ["github"] },
    expiresAt: { type: "string", format: "date-time" },
    provider: delegatedOAuthProviderSchema,
    scopes: { type: "array", items: { type: "string" } },
    workspaceId: { type: "string" },
  },
} as const;

const delegatedOAuthConnectionSchema = {
  type: "object",
  required: [
    "id",
    "workspaceId",
    "userId",
    "providerId",
    "connectorType",
    "providerAccountHash",
    "providerAccountLoginConfigured",
    "scopes",
    "status",
    "createdAt",
    "updatedAt",
  ],
  properties: {
    id: { type: "string" },
    workspaceId: { type: "string" },
    userId: { type: "string" },
    providerId: { type: "string", enum: ["github"] },
    connectorType: { type: "string", enum: ["github"] },
    providerAccountHash: { type: "string" },
    providerAccountLoginConfigured: { type: "boolean" },
    providerAccountLoginHash: { type: "string" },
    providerRevocationErrorCode: { type: "string" },
    providerRevocationStatus: {
      type: "string",
      enum: ["failed", "skipped", "succeeded"],
    },
    scopes: { type: "array", items: { type: "string" } },
    status: {
      type: "string",
      enum: ["active", "reauthorization_required", "revoked"],
    },
    accessTokenExpiresAt: { type: "string", format: "date-time" },
    refreshTokenExpiresAt: { type: "string", format: "date-time" },
    lastUsedAt: { type: "string", format: "date-time" },
    revokedAt: { type: "string", format: "date-time" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;

const delegatedOAuthConnectionPostureCountsSchema = {
  type: "object",
  required: [
    "active",
    "expiredAccessToken",
    "expiringAccessToken",
    "reauthorizationRequired",
    "revoked",
    "total",
    "unused",
  ],
  properties: {
    active: { type: "integer", minimum: 0 },
    expiredAccessToken: { type: "integer", minimum: 0 },
    expiringAccessToken: { type: "integer", minimum: 0 },
    reauthorizationRequired: { type: "integer", minimum: 0 },
    revoked: { type: "integer", minimum: 0 },
    total: { type: "integer", minimum: 0 },
    unused: { type: "integer", minimum: 0 },
  },
} as const;

const delegatedOAuthProviderPostureSchema = {
  type: "object",
  required: [
    "authorizationHost",
    "configured",
    "connectorTypes",
    "connectionCounts",
    "defaultScopeCount",
    "displayName",
    "id",
    "pkceRequired",
    "tokenHost",
  ],
  properties: {
    authorizationHost: { type: "string" },
    configured: { type: "boolean" },
    connectorTypes: {
      type: "array",
      items: {
        type: "string",
        enum: [
          "local_import",
          "github",
          "s3",
          "website",
          "rss",
          "confluence",
          "jira",
          "notion",
          "linear",
          "slack",
        ],
      },
    },
    connectionCounts: delegatedOAuthConnectionPostureCountsSchema,
    defaultScopeCount: { type: "integer", minimum: 0 },
    displayName: { type: "string" },
    id: { type: "string", enum: ["github"] },
    pkceRequired: { type: "boolean", enum: [true] },
    tokenHost: { type: "string" },
  },
} as const;

const delegatedOAuthConnectorTypePostureSchema = {
  type: "object",
  required: ["connectorType", "connectionCounts"],
  properties: {
    connectorType: {
      type: "string",
      enum: [
        "local_import",
        "github",
        "s3",
        "website",
        "rss",
        "confluence",
        "jira",
        "notion",
        "linear",
        "slack",
      ],
    },
    connectionCounts: delegatedOAuthConnectionPostureCountsSchema,
  },
} as const;

const delegatedOAuthPostureSchema = {
  type: "object",
  required: [
    "connectorTypes",
    "generatedAt",
    "orgId",
    "providers",
    "redaction",
    "schema",
    "status",
    "warnings",
  ],
  properties: {
    connectorTypes: {
      type: "array",
      items: delegatedOAuthConnectorTypePostureSchema,
    },
    generatedAt: { type: "string", format: "date-time" },
    orgId: { type: "string" },
    providers: {
      type: "array",
      items: delegatedOAuthProviderPostureSchema,
    },
    redaction: {
      type: "object",
      required: [
        "rawAccessTokensReturned",
        "rawClientSecretsReturned",
        "rawProviderAccountIdsReturned",
        "rawProviderAccountLoginsReturned",
        "rawProviderUrlsReturned",
        "rawRefreshTokensReturned",
      ],
      properties: {
        rawAccessTokensReturned: { type: "boolean", enum: [false] },
        rawClientSecretsReturned: { type: "boolean", enum: [false] },
        rawProviderAccountIdsReturned: { type: "boolean", enum: [false] },
        rawProviderAccountLoginsReturned: { type: "boolean", enum: [false] },
        rawProviderUrlsReturned: { type: "boolean", enum: [false] },
        rawRefreshTokensReturned: { type: "boolean", enum: [false] },
      },
    },
    schema: { type: "string", enum: ["romeo.delegated-oauth-posture.v1"] },
    status: { type: "string", enum: ["attention_required", "healthy"] },
    warnings: { type: "array", items: { type: "string" } },
  },
} as const;

export const delegatedOAuthPaths = {
  "/admin/delegated-oauth/posture": {
    get: {
      summary:
        "Get sanitized delegated OAuth provider and connection health posture",
      responses: {
        200: success("Delegated OAuth posture", delegatedOAuthPostureSchema),
        403: errorResponse,
      },
    },
  },
  "/delegated-oauth/providers": {
    get: {
      summary: "List delegated OAuth providers available for connectors",
      responses: {
        200: success("Delegated OAuth providers", {
          type: "array",
          items: delegatedOAuthProviderSchema,
        }),
        403: errorResponse,
      },
    },
  },
  "/delegated-oauth/start": {
    post: {
      summary: "Start a delegated OAuth connector authorization flow",
      requestBody: { required: true, content: jsonContent(startInputSchema) },
      responses: {
        200: success(
          "Delegated OAuth authorization redirect URL",
          startResultSchema,
        ),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
  },
  "/delegated-oauth/connections": {
    get: {
      summary: "List delegated OAuth connector account links",
      parameters: [
        {
          name: "workspaceId",
          in: "query",
          required: false,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: success("Delegated OAuth connections", {
          type: "array",
          items: delegatedOAuthConnectionSchema,
        }),
        403: errorResponse,
      },
    },
  },
  "/delegated-oauth/connections/{connectionId}/revoke": {
    post: {
      summary: "Revoke a delegated OAuth connector account link",
      parameters: [
        {
          name: "connectionId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: success(
          "Revoked delegated OAuth connection",
          delegatedOAuthConnectionSchema,
        ),
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/delegated-oauth/callback": {
    get: {
      summary: "Receive delegated OAuth provider callback",
      parameters: [
        {
          name: "code",
          in: "query",
          required: false,
          schema: { type: "string" },
        },
        {
          name: "state",
          in: "query",
          required: false,
          schema: { type: "string" },
        },
        {
          name: "error",
          in: "query",
          required: false,
          schema: { type: "string" },
        },
      ],
      responses: {
        302: {
          description: "Redirects to the requested in-app return path",
        },
        400: errorResponse,
        409: errorResponse,
      },
    },
  },
} as const;
