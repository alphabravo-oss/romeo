import type { ToolConnector } from "../domain/entities";
import { ApiError } from "../errors";
import {
  normalizeOAuthScopes,
  normalizeOAuthTokenUrl,
  readOAuthClientAuthMethod,
  type OAuthClientAuthMethod,
} from "./tool-oauth-client-credentials";

export interface ToolConnectorAuthUpdate {
  apiKeyIn?: "header" | "query" | undefined;
  apiKeyName?: string | undefined;
  oauthClientAuthMethod?: OAuthClientAuthMethod | undefined;
  oauthScopes?: string[] | undefined;
  oauthTokenUrl?: string | undefined;
  type: "none" | "api_key" | "bearer" | "oauth2_client_credentials";
}

export function authMetadataForConnector(
  connector: ToolConnector,
  input: ToolConnectorAuthUpdate,
): Record<string, unknown> {
  if (input.type === "api_key") {
    if (
      input.oauthTokenUrl !== undefined ||
      input.oauthScopes !== undefined ||
      input.oauthClientAuthMethod !== undefined
    ) {
      throw new ApiError(
        "invalid_tool_auth_config",
        "OAuth metadata applies only to oauth2_client_credentials auth.",
        400,
      );
    }
    const hint = readApiKeyAuthHint(connector);
    const apiKeyIn = input.apiKeyIn ?? hint?.apiKeyIn ?? "header";
    const apiKeyName = input.apiKeyName ?? hint?.apiKeyName ?? "x-api-key";
    if (!isSafeApiKeyPlacement(apiKeyIn, apiKeyName)) {
      throw new ApiError(
        "invalid_tool_auth_config",
        "API key auth placement must use a safe header or query name.",
        400,
      );
    }
    return { apiKeyIn, apiKeyName };
  }
  if (input.apiKeyIn !== undefined || input.apiKeyName !== undefined) {
    throw new ApiError(
      "invalid_tool_auth_config",
      "API key placement applies only to api_key auth.",
      400,
    );
  }
  if (input.type === "oauth2_client_credentials") {
    const hint = readOAuthClientCredentialsAuthHint(connector);
    const tokenUrl = input.oauthTokenUrl ?? hint?.oauthTokenUrl;
    if (tokenUrl === undefined) {
      throw new ApiError(
        "invalid_tool_auth_config",
        "OAuth client credentials auth requires a safe token URL.",
        400,
      );
    }
    return {
      oauthTokenUrl: normalizeOAuthTokenUrl(tokenUrl),
      oauthScopes: normalizeOAuthScopes(
        input.oauthScopes ?? hint?.oauthScopes ?? [],
      ),
      oauthClientAuthMethod: readOAuthClientAuthMethod(
        input.oauthClientAuthMethod,
      ),
    };
  }
  if (
    input.oauthTokenUrl !== undefined ||
    input.oauthScopes !== undefined ||
    input.oauthClientAuthMethod !== undefined
  ) {
    throw new ApiError(
      "invalid_tool_auth_config",
      "OAuth metadata applies only to oauth2_client_credentials auth.",
      400,
    );
  }
  return {};
}

function readOAuthClientCredentialsAuthHint(
  connector: ToolConnector,
): { oauthScopes: string[]; oauthTokenUrl: string } | undefined {
  const hints = Array.isArray(connector.schema.authHints)
    ? connector.schema.authHints
    : [];
  for (const hint of hints) {
    if (!isRecord(hint) || hint.type !== "oauth2_client_credentials") continue;
    const tokenUrl = hint.oauthTokenUrl;
    if (typeof tokenUrl !== "string") continue;
    try {
      return {
        oauthTokenUrl: normalizeOAuthTokenUrl(tokenUrl),
        oauthScopes: normalizeOAuthScopes(hint.oauthScopes),
      };
    } catch {
      continue;
    }
  }
  return undefined;
}

function readApiKeyAuthHint(
  connector: ToolConnector,
): { apiKeyIn: "header" | "query"; apiKeyName: string } | undefined {
  const hints = Array.isArray(connector.schema.authHints)
    ? connector.schema.authHints
    : [];
  for (const hint of hints) {
    if (!isRecord(hint) || hint.type !== "api_key") continue;
    const apiKeyIn = hint.apiKeyIn;
    const apiKeyName = hint.apiKeyName;
    if (
      (apiKeyIn === "header" || apiKeyIn === "query") &&
      typeof apiKeyName === "string" &&
      isSafeApiKeyPlacement(apiKeyIn, apiKeyName)
    ) {
      return { apiKeyIn, apiKeyName };
    }
  }
  return undefined;
}

function isSafeApiKeyPlacement(
  apiKeyIn: "header" | "query",
  apiKeyName: string,
): boolean {
  return (
    (apiKeyIn === "header" || apiKeyIn === "query") &&
    /^[A-Za-z0-9_.-]{1,80}$/u.test(apiKeyName)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
