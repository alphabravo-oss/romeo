import { Octokit, OAuthApp, RequestError } from "octokit";

import { ApiError } from "../errors";

export interface DelegatedOAuthProviderExchangeInput {
  clientId: string;
  clientSecret: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  requestedScopes: string[];
  tokenUrl: string;
}

export interface DelegatedOAuthProviderToken {
  accessToken: string;
  accessTokenExpiresAt?: string;
  providerAccountId: string;
  providerAccountLogin?: string;
  refreshToken?: string;
  refreshTokenExpiresAt?: string;
  scopes: string[];
  tokenType: "bearer";
}

export type DelegatedOAuthProviderRefreshedToken = Omit<
  DelegatedOAuthProviderToken,
  "providerAccountId" | "providerAccountLogin"
>;

const providerTimeoutMs = 10_000;
const maxProviderResponseBytes = 64 * 1024;

export async function exchangeGitHubDelegatedOAuth(
  input: DelegatedOAuthProviderExchangeInput,
  fetchImpl: typeof fetch,
): Promise<DelegatedOAuthProviderToken> {
  const token = await exchangeCode(input, fetchImpl);
  const account = await fetchGitHubAccount(token.accessToken, fetchImpl);
  return {
    ...token,
    providerAccountId: account.id,
    ...(account.login === undefined
      ? {}
      : { providerAccountLogin: account.login }),
  };
}

export async function refreshGitHubDelegatedOAuth(
  input: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    requestedScopes: string[];
    tokenUrl: string;
  },
  fetchImpl: typeof fetch,
): Promise<DelegatedOAuthProviderRefreshedToken> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: input.clientId,
    client_secret: input.clientSecret,
    refresh_token: input.refreshToken,
  });
  const response = await fetchProvider(input.tokenUrl, fetchImpl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "Romeo",
    },
    body,
  });
  if (!response.ok) {
    throw new ApiError(
      "delegated_oauth_token_refresh_failed",
      "Delegated OAuth token refresh failed.",
      401,
      { provider: "github", status: response.status },
    );
  }
  return tokenFromPayload(await readProviderPayload(response), {
    requestedScopes: input.requestedScopes,
    missingTokenCode: "delegated_oauth_token_refresh_failed",
  });
}

export async function revokeGitHubDelegatedOAuth(
  input: {
    accessToken: string;
    clientId: string;
    clientSecret: string;
  },
  fetchImpl: typeof fetch,
): Promise<void> {
  const SdkOctokit = githubOctokitClass(fetchImpl);
  const app = new OAuthApp({
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    Octokit: SdkOctokit,
  });
  try {
    await app.deleteAuthorization({ token: input.accessToken });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      "delegated_oauth_provider_revoke_failed",
      "Delegated OAuth provider revocation failed.",
      502,
      {
        provider: "github",
        ...(error instanceof RequestError ? { status: error.status } : {}),
      },
    );
  }
}

async function exchangeCode(
  input: DelegatedOAuthProviderExchangeInput,
  fetchImpl: typeof fetch,
): Promise<DelegatedOAuthProviderRefreshedToken> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
  });
  const response = await fetchProvider(input.tokenUrl, fetchImpl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "Romeo",
    },
    body,
  });
  if (!response.ok) {
    throw new ApiError(
      "delegated_oauth_token_exchange_failed",
      "Delegated OAuth token exchange failed.",
      401,
      { provider: "github", status: response.status },
    );
  }
  const payload = await readProviderPayload(response);
  return tokenFromPayload(payload, {
    requestedScopes: input.requestedScopes,
    missingTokenCode: "delegated_oauth_token_exchange_failed",
  });
}

function tokenFromPayload(
  payload: Record<string, unknown>,
  options: { missingTokenCode: string; requestedScopes: string[] },
): DelegatedOAuthProviderRefreshedToken {
  const accessToken = stringField(payload, "access_token");
  if (accessToken === undefined || accessToken.length === 0) {
    throw new ApiError(
      options.missingTokenCode,
      "Delegated OAuth provider did not return an access token.",
      401,
    );
  }
  const tokenType =
    stringField(payload, "token_type")?.toLowerCase() ?? "bearer";
  if (tokenType !== "bearer") {
    throw new ApiError(
      "delegated_oauth_token_type_unsupported",
      "Delegated OAuth token exchange returned an unsupported token type.",
      401,
    );
  }

  const nowMs = Date.now();
  const token: Omit<
    DelegatedOAuthProviderToken,
    "providerAccountId" | "providerAccountLogin"
  > = {
    accessToken,
    tokenType: "bearer",
    scopes: grantedScopes(payload.scope, options.requestedScopes),
  };
  const refreshToken = stringField(payload, "refresh_token");
  if (refreshToken !== undefined && refreshToken.length > 0)
    token.refreshToken = refreshToken;
  const accessTokenExpiresAt = expiresAt(payload.expires_in, nowMs);
  if (accessTokenExpiresAt !== undefined)
    token.accessTokenExpiresAt = accessTokenExpiresAt;
  const refreshTokenExpiresAt = expiresAt(
    payload.refresh_token_expires_in,
    nowMs,
  );
  if (refreshTokenExpiresAt !== undefined)
    token.refreshTokenExpiresAt = refreshTokenExpiresAt;
  return token;
}

async function fetchGitHubAccount(
  accessToken: string,
  fetchImpl: typeof fetch,
): Promise<{ id: string; login?: string }> {
  const client = new (githubOctokitClass(fetchImpl))({ auth: accessToken });
  try {
    const { data } = await client.rest.users.getAuthenticated();
    return { id: String(data.id), login: data.login };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      "delegated_oauth_account_lookup_failed",
      "Delegated OAuth provider account lookup failed.",
      401,
      {
        provider: "github",
        ...(error instanceof RequestError ? { status: error.status } : {}),
      },
    );
  }
}

function githubOctokitClass(fetchImpl: typeof fetch) {
  return Octokit.defaults({
    request: {
      fetch: (input: string | URL | Request, init?: RequestInit) =>
        boundedSdkFetch(input, init, fetchImpl),
      retries: 0,
    },
    userAgent: "Romeo",
  });
}

async function boundedSdkFetch(
  input: string | URL | Request,
  init: RequestInit | undefined,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const response = await fetchProvider(input, fetchImpl, init ?? {});
  const payload = await response.arrayBuffer();
  if (payload.byteLength > maxProviderResponseBytes) {
    throw new ApiError(
      "delegated_oauth_provider_response_too_large",
      "Delegated OAuth provider response exceeded the size limit.",
      502,
    );
  }
  return new Response(
    response.status === 204 || response.status === 205 ? null : payload,
    {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    },
  );
}

async function fetchProvider(
  url: string | URL | Request,
  fetchImpl: typeof fetch,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), providerTimeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch {
    throw new ApiError(
      "delegated_oauth_provider_unreachable",
      "Delegated OAuth provider request failed.",
      502,
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function readProviderPayload(
  response: Response,
): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (new TextEncoder().encode(text).length > maxProviderResponseBytes) {
    throw new ApiError(
      "delegated_oauth_provider_response_too_large",
      "Delegated OAuth provider response exceeded the size limit.",
      502,
    );
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const parsed = JSON.parse(text) as unknown;
    if (isRecord(parsed)) return parsed;
  } else {
    return Object.fromEntries(new URLSearchParams(text).entries());
  }
  throw new ApiError(
    "delegated_oauth_provider_response_invalid",
    "Delegated OAuth provider returned an invalid response.",
    502,
  );
}

function grantedScopes(rawScope: unknown, requestedScopes: string[]): string[] {
  if (rawScope === undefined || rawScope === null || rawScope === "")
    return requestedScopes;
  if (typeof rawScope !== "string") {
    throw new ApiError(
      "delegated_oauth_scope_invalid",
      "Delegated OAuth provider returned invalid scopes.",
      401,
    );
  }
  const scopes = rawScope
    .split(/[,\s]+/u)
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
  const uniqueScopes: string[] = [];
  for (const scope of scopes) {
    if (!requestedScopes.includes(scope)) {
      throw new ApiError(
        "delegated_oauth_scope_unexpected",
        "Delegated OAuth provider returned an unexpected scope.",
        401,
      );
    }
    if (!uniqueScopes.includes(scope)) uniqueScopes.push(scope);
  }
  return uniqueScopes.length === 0 ? requestedScopes : uniqueScopes;
}

function expiresAt(rawSeconds: unknown, nowMs: number): string | undefined {
  if (rawSeconds === undefined || rawSeconds === null || rawSeconds === "")
    return undefined;
  const seconds =
    typeof rawSeconds === "number"
      ? rawSeconds
      : Number.parseInt(String(rawSeconds), 10);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return new Date(nowMs + seconds * 1000).toISOString();
}

function stringField(
  payload: Record<string, unknown>,
  fieldName: string,
): string | undefined {
  const value = payload[fieldName];
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
