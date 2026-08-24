import * as oauth from "oauth4webapi";

import type { ToolConnector } from "../domain/entities";
import { ApiError } from "../errors";
import type { WebsiteConnectorHostLookup } from "./data-connector-network-policy";
import type { DnsPinnedFetch } from "./dns-pinned-fetch";
import type { SecretResolver } from "./secret-resolver";
import { SecretBearingEgressClient } from "./secret-bearing-egress";

const maxTokenResponseBytes = 16 * 1024;
const scopePattern = /^[A-Za-z0-9_:./-]{1,120}$/u;

export type OAuthClientAuthMethod =
  | "client_secret_basic"
  | "client_secret_post";

export interface OAuthClientCredentialsTokenInput {
  connector: ToolConnector;
  fetchImpl: typeof fetch;
  hostLookup?: WebsiteConnectorHostLookup;
  maxBytes: number;
  pinnedFetchImpl?: DnsPinnedFetch;
  secretResolver: SecretResolver;
  timeoutMs: number;
}

export async function resolveOAuthClientCredentialsAccessToken(
  input: OAuthClientCredentialsTokenInput,
): Promise<string> {
  const tokenUrl = readOAuthTokenUrl(input.connector);
  assertOAuthTokenHostAllowed(input.connector, tokenUrl);
  const credentials = await readOAuthClientCredentials(
    input.connector,
    input.secretResolver,
  );
  const scopes = normalizeOAuthScopes(input.connector.authConfig.oauthScopes);
  const authMethod = readOAuthClientAuthMethod(
    input.connector.authConfig.oauthClientAuthMethod,
  );
  const authorizationServer: oauth.AuthorizationServer = {
    issuer: tokenUrl.origin,
    token_endpoint: tokenUrl.toString(),
  };
  const client: oauth.Client = {
    client_id: credentials.clientId,
    token_endpoint_auth_method: authMethod,
  };
  const clientAuthentication =
    authMethod === "client_secret_post"
      ? oauth.ClientSecretPost(credentials.clientSecret)
      : oauth.ClientSecretBasic(credentials.clientSecret);
  const tokenFetch = new SecretBearingEgressClient({
    allowedUrls: [tokenUrl.toString()],
    fetchImpl: input.fetchImpl,
    ...(input.hostLookup === undefined ? {} : { hostLookup: input.hostLookup }),
    maxResponseBytes: Math.min(input.maxBytes, maxTokenResponseBytes),
    ...(input.pinnedFetchImpl === undefined
      ? {}
      : { pinnedFetchImpl: input.pinnedFetchImpl }),
    timeoutMs: input.timeoutMs,
  }).fetch;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await oauth.clientCredentialsGrantRequest(
      authorizationServer,
      client,
      clientAuthentication,
      scopes.length === 0 ? {} : { scope: scopes.join(" ") },
      {
        [oauth.customFetch]: tokenFetch,
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      throw new ApiError(
        "tool_operation_oauth_token_request_failed",
        "OAuth token request failed.",
        502,
        { status: response.status },
      );
    }
    const token = await oauth.processClientCredentialsResponse(
      authorizationServer,
      client,
      response,
    );
    if (
      typeof token.access_token !== "string" ||
      token.access_token.length === 0
    ) {
      throw new ApiError(
        "tool_operation_oauth_token_invalid",
        "OAuth token response is missing an access token.",
        502,
      );
    }
    return token.access_token;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError(
        "tool_operation_oauth_timeout",
        "OAuth token request timed out.",
        504,
      );
    }
    throw new ApiError(
      "tool_operation_oauth_token_request_failed",
      "OAuth token request failed.",
      502,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function normalizeOAuthTokenUrl(value: string): string {
  const url = parseOAuthTokenUrl(value);
  return url.toString();
}

export function normalizeOAuthScopes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const scopes: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !scopePattern.test(item)) continue;
    if (!scopes.includes(item)) scopes.push(item);
    if (scopes.length >= 20) break;
  }
  return scopes;
}

export function readOAuthClientAuthMethod(
  value: unknown,
): OAuthClientAuthMethod {
  return value === "client_secret_post"
    ? "client_secret_post"
    : "client_secret_basic";
}

function readOAuthTokenUrl(connector: ToolConnector): URL {
  const value = connector.authConfig.oauthTokenUrl;
  if (typeof value !== "string")
    throw new ApiError(
      "tool_operation_oauth_token_url_missing",
      "OAuth token URL is not configured.",
      409,
    );
  return parseOAuthTokenUrl(value);
}

function parseOAuthTokenUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ApiError(
      "invalid_tool_oauth_config",
      "OAuth token URL must be a safe absolute URL.",
      400,
    );
  }
  if (
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw new ApiError(
      "invalid_tool_oauth_config",
      "OAuth token URL must not include credentials, query, or fragment.",
      400,
    );
  }
  if (parsed.protocol === "https:") return parsed;
  throw new ApiError(
    "invalid_tool_oauth_config",
    "OAuth token URL must use HTTPS.",
    400,
  );
}

function assertOAuthTokenHostAllowed(
  connector: ToolConnector,
  tokenUrl: URL,
): void {
  const host = tokenUrl.hostname.toLowerCase();
  if (
    connector.networkPolicy.mode !== "allow_hosts" ||
    !connector.networkPolicy.allowedHosts.includes(host)
  ) {
    throw new ApiError(
      "tool_operation_oauth_host_not_allowed",
      "OAuth token host is not allowed by connector network policy.",
      409,
      { host },
    );
  }
}

async function readOAuthClientCredentials(
  connector: ToolConnector,
  secretResolver: SecretResolver,
): Promise<{ clientId: string; clientSecret: string }> {
  const secretRef =
    typeof connector.authConfig.secretRef === "string"
      ? connector.authConfig.secretRef
      : undefined;
  if (secretRef === undefined)
    throw new ApiError(
      "tool_operation_auth_not_configured",
      "Tool operation auth is not configured.",
      409,
    );
  if (secretResolver.resolveValue === undefined) {
    throw new ApiError(
      "secret_value_resolution_unavailable",
      "Secret value resolution is unavailable for tool operation dispatch.",
      409,
    );
  }
  const resolution = await secretResolver.resolveValue(secretRef);
  if (!resolution.available || resolution.value === undefined) {
    throw new ApiError(
      "tool_operation_secret_unavailable",
      "Tool operation secret is unavailable.",
      409,
      {
        failureCode: resolution.failureCode,
        scheme: resolution.scheme,
      },
    );
  }
  return parseOAuthSecret(resolution.value);
}

function parseOAuthSecret(value: string): {
  clientId: string;
  clientSecret: string;
} {
  let payload: unknown;
  try {
    payload = JSON.parse(value);
  } catch {
    throw new ApiError(
      "tool_operation_oauth_secret_invalid",
      "OAuth client credential secret must be a JSON object.",
      409,
    );
  }
  if (!isRecord(payload))
    throw new ApiError(
      "tool_operation_oauth_secret_invalid",
      "OAuth client credential secret must be a JSON object.",
      409,
    );
  const clientId = payload.clientId;
  const clientSecret = payload.clientSecret;
  if (
    typeof clientId !== "string" ||
    clientId.length === 0 ||
    typeof clientSecret !== "string" ||
    clientSecret.length === 0
  ) {
    throw new ApiError(
      "tool_operation_oauth_secret_invalid",
      "OAuth client credential secret is missing required fields.",
      409,
    );
  }
  return { clientId, clientSecret };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
