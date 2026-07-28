import * as oauth from "oauth4webapi";

import type { ToolOperationDispatchRequestClaimResult } from "./api-types";
import type {
  RunToolDispatchWorkerInput,
  ToolDispatchPayloadAuth,
} from "./tool-dispatch-worker";
import { assertResolvedHostAllowed, safeHost } from "./tool-dispatch-network";

export async function applyPayloadAuth(
  input: RunToolDispatchWorkerInput,
  claim: ToolOperationDispatchRequestClaimResult,
  url: URL,
  headers: Record<string, string>,
  auth: ToolDispatchPayloadAuth | undefined,
): Promise<void> {
  if (auth === undefined) return;
  if (auth.type === "bearer") {
    const secret = await resolveWorkerSecret(input, auth.secretRef);
    headers.authorization = `Bearer ${secret}`;
    return;
  }
  if (auth.type === "api_key") {
    const secret = await resolveWorkerSecret(input, auth.secretRef);
    const name = safeApiKeyName(auth.apiKeyName ?? "x-api-key");
    if ((auth.apiKeyIn ?? "header") === "query") {
      url.searchParams.set(name, secret);
      return;
    }
    headers[name] = secret;
    return;
  }
  if (auth.type === "oauth2_client_credentials") {
    const accessToken = await resolveOAuthClientCredentialsAccessToken(
      input,
      claim,
      auth.secretRef,
    );
    headers.authorization = `Bearer ${accessToken}`;
    return;
  }
  throw new Error("worker_auth_unsupported");
}

async function resolveOAuthClientCredentialsAccessToken(
  input: RunToolDispatchWorkerInput,
  claim: ToolOperationDispatchRequestClaimResult,
  secretRef: string,
): Promise<string> {
  const tokenUrl = oauthTokenUrl(claim);
  await assertResolvedHostAllowed(input, tokenUrl.hostname);
  const credentials = parseOAuthClientCredentials(
    await resolveWorkerSecret(input, secretRef),
  );
  const scopes = oauthScopes(claim.authPolicy?.oauthScopes);
  const authMethod =
    claim.authPolicy?.oauthClientAuthMethod === "client_secret_post"
      ? "client_secret_post"
      : "client_secret_basic";
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await oauth.clientCredentialsGrantRequest(
      authorizationServer,
      client,
      clientAuthentication,
      scopes.length === 0 ? {} : { scope: scopes.join(" ") },
      {
        [oauth.customFetch]: boundedOAuthFetch(
          input.fetchImpl,
          Math.min(input.maxBytes, 16 * 1024),
        ),
        signal: controller.signal,
      },
    );
    if (!response.ok) throw new Error("worker_oauth_token_request_failed");
    const token = await oauth.processClientCredentialsResponse(
      authorizationServer,
      client,
      response,
    );
    if (
      typeof token.access_token !== "string" ||
      token.access_token.length === 0
    )
      throw new Error("worker_oauth_token_invalid");
    return token.access_token;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("worker_oauth_timeout");
    if (error instanceof Error && error.message.startsWith("worker_oauth_"))
      throw error;
    throw new Error("worker_oauth_token_request_failed");
  } finally {
    clearTimeout(timeout);
  }
}

function oauthTokenUrl(claim: ToolOperationDispatchRequestClaimResult): URL {
  if (
    claim.authPolicy?.type !== "oauth2_client_credentials" ||
    claim.authPolicy.oauthTokenUrl === undefined
  ) {
    throw new Error("worker_auth_invalid");
  }
  let parsed: URL;
  try {
    parsed = new URL(claim.authPolicy.oauthTokenUrl);
  } catch {
    throw new Error("worker_auth_invalid");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0 ||
    !safeHost(parsed.hostname, false)
  ) {
    throw new Error("worker_auth_invalid");
  }
  return parsed;
}

function parseOAuthClientCredentials(value: string): {
  clientId: string;
  clientSecret: string;
} {
  let payload: unknown;
  try {
    payload = JSON.parse(value);
  } catch {
    throw new Error("worker_oauth_secret_invalid");
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload))
    throw new Error("worker_oauth_secret_invalid");
  const record = payload as Record<string, unknown>;
  if (
    typeof record.clientId !== "string" ||
    record.clientId.length === 0 ||
    typeof record.clientSecret !== "string" ||
    record.clientSecret.length === 0
  ) {
    throw new Error("worker_oauth_secret_invalid");
  }
  return { clientId: record.clientId, clientSecret: record.clientSecret };
}

function oauthScopes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const scopes: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !/^[A-Za-z0-9_:./-]{1,120}$/u.test(item))
      continue;
    if (!scopes.includes(item)) scopes.push(item);
    if (scopes.length >= 20) break;
  }
  return scopes;
}

function boundedOAuthFetch(
  fetchImpl: typeof fetch,
  maxBytes: number,
): typeof fetch {
  return async (resource, init) => {
    const response = await fetchImpl(resource, { ...init, redirect: "error" });
    const text = await readBoundedResponseText(response, maxBytes);
    return new Response(text, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

async function readBoundedResponseText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bodyBytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bodyBytes += next.value.byteLength;
      if (bodyBytes > maxBytes) {
        await reader.cancel();
        throw new Error("worker_oauth_response_too_large");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(concatBytes(chunks));
}

async function resolveWorkerSecret(
  input: RunToolDispatchWorkerInput,
  secretRef: string,
): Promise<string> {
  const resolution = await input.secretResolver?.resolveValue(secretRef);
  if (resolution?.available === true && resolution.value !== undefined) {
    return resolution.value;
  }
  throw new Error("worker_secret_unavailable");
}

function safeApiKeyName(value: string): string {
  if (/^[A-Za-z0-9_.-]{1,80}$/u.test(value)) return value;
  throw new Error("worker_auth_invalid");
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    chunks.reduce((total, chunk) => total + chunk.byteLength, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
