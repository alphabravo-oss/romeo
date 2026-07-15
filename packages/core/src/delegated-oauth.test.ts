import { readEnv } from "@romeo/config";
import { describe, expect, it } from "vitest";

import { createRomeoApi } from "./api";
import type { DelegatedOAuthTokenEnvelope } from "./domain/delegated-oauth";
import { InMemoryRomeoRepository } from "./repositories/in-memory";

const sessionSecret = "delegated-oauth-test-session-secret";

describe("Delegated OAuth API", () => {
  it("lists provider posture and fails closed when GitHub OAuth is not configured", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: readEnv({
        APP_ORIGIN: "https://romeo.example",
        DELEGATED_OAUTH_GITHUB_SCOPES: "repo,read:user",
        SESSION_SECRET: sessionSecret,
      }),
    });

    const providersResponse = await api.request(
      "/api/v1/delegated-oauth/providers",
    );
    const providers = await providersResponse.json();
    const startResponse = await api.request("/api/v1/delegated-oauth/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerId: "github",
        workspaceId: "workspace_default",
        connectorType: "github",
        scopes: ["repo"],
      }),
    });
    const start = await startResponse.json();

    expect(providersResponse.status).toBe(200);
    expect(providers.data).toEqual([
      expect.objectContaining({
        id: "github",
        displayName: "GitHub",
        configured: false,
        connectorTypes: ["github"],
        defaultScopes: ["repo", "read:user"],
        authorizationHost: "github.com",
        tokenHost: "github.com",
        pkceRequired: true,
      }),
    ]);
    expect(startResponse.status).toBe(409);
    expect(start.error.code).toBe("delegated_oauth_provider_not_configured");
  });

  it("returns admin provider posture without tokens, secrets, or provider account identities", async () => {
    const repository = new InMemoryRomeoRepository();
    const createdAt = "2026-01-01T00:00:00.000Z";
    const activeExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const revokedAt = "2026-01-01T00:05:00.000Z";
    const api = createRomeoApi(repository, {
      env: readEnv({
        APP_ORIGIN: "https://romeo.example",
        DELEGATED_OAUTH_GITHUB_CLIENT_ID: "github-client-id",
        DELEGATED_OAUTH_GITHUB_CLIENT_SECRET: "github-client-secret",
        DELEGATED_OAUTH_GITHUB_SCOPES: "repo,read:user",
        DELEGATED_OAUTH_TOKEN_ENCRYPTION_KEY:
          "delegated-oauth-test-token-key-32",
        SESSION_SECRET: sessionSecret,
      }),
    });

    await repository.createDelegatedOAuthConnection({
      id: "delegated_oauth_connection_active",
      orgId: "org_default",
      workspaceId: "workspace_default",
      userId: "user_dev_admin",
      providerId: "github",
      connectorType: "github",
      providerAccountId: "raw_provider_account_12345",
      providerAccountLogin: "octocat-sensitive",
      scopes: ["repo"],
      status: "active",
      token: delegatedOAuthToken("active", createdAt),
      accessTokenExpiresAt: activeExpiresAt,
      createdAt,
      updatedAt: createdAt,
    });
    await repository.createDelegatedOAuthConnection({
      id: "delegated_oauth_connection_reauth",
      orgId: "org_default",
      workspaceId: "workspace_default",
      userId: "user_dev_admin",
      providerId: "github",
      connectorType: "github",
      providerAccountId: "raw_provider_account_67890",
      providerAccountLogin: "reauth-login-sensitive",
      scopes: ["repo"],
      status: "reauthorization_required",
      token: delegatedOAuthToken("reauth", createdAt),
      createdAt,
      updatedAt: createdAt,
    });
    await repository.createDelegatedOAuthConnection({
      id: "delegated_oauth_connection_revoked",
      orgId: "org_default",
      workspaceId: "workspace_default",
      userId: "user_dev_admin",
      providerId: "github",
      connectorType: "github",
      providerAccountId: "raw_provider_account_99999",
      providerAccountLogin: "revoked-login-sensitive",
      scopes: ["repo"],
      status: "revoked",
      token: delegatedOAuthToken("revoked", createdAt),
      revokedAt,
      createdAt,
      updatedAt: revokedAt,
    });

    const response = await api.request("/api/v1/admin/delegated-oauth/posture");
    const text = await response.text();
    const body = JSON.parse(text);

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      schema: "romeo.delegated-oauth-posture.v1",
      orgId: "org_default",
      status: "attention_required",
      redaction: {
        rawAccessTokensReturned: false,
        rawClientSecretsReturned: false,
        rawProviderAccountIdsReturned: false,
        rawProviderAccountLoginsReturned: false,
        rawProviderUrlsReturned: false,
        rawRefreshTokensReturned: false,
      },
    });
    expect(body.data.providers).toEqual([
      expect.objectContaining({
        id: "github",
        displayName: "GitHub",
        configured: true,
        connectorTypes: ["github"],
        defaultScopeCount: 2,
        authorizationHost: "github.com",
        tokenHost: "github.com",
        pkceRequired: true,
        connectionCounts: {
          active: 1,
          expiredAccessToken: 0,
          expiringAccessToken: 1,
          reauthorizationRequired: 1,
          revoked: 1,
          total: 3,
          unused: 1,
        },
      }),
    ]);
    expect(body.data.connectorTypes).toEqual([
      {
        connectorType: "github",
        connectionCounts: {
          active: 1,
          expiredAccessToken: 0,
          expiringAccessToken: 1,
          reauthorizationRequired: 1,
          revoked: 1,
          total: 3,
          unused: 1,
        },
      },
    ]);
    expect(body.data.warnings).toEqual([
      "delegated_oauth_access_token_expiring:github",
      "delegated_oauth_reauthorization_required:github",
      "delegated_oauth_revoked_connections_present:github",
    ]);
    expect(text).not.toContain("raw_provider_account_12345");
    expect(text).not.toContain("octocat-sensitive");
    expect(text).not.toContain("ciphertext-active");
    expect(text).not.toContain("github-client-secret");
  });

  it("starts a configured GitHub PKCE flow without returning verifier or signed state payload", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: readEnv({
        APP_ORIGIN: "https://romeo.example",
        DELEGATED_OAUTH_GITHUB_CLIENT_ID: "github-client-id",
        DELEGATED_OAUTH_GITHUB_CLIENT_SECRET: "github-client-secret",
        DELEGATED_OAUTH_GITHUB_SCOPES: "repo,read:user",
        DELEGATED_OAUTH_TOKEN_ENCRYPTION_KEY:
          "delegated-oauth-test-token-key-32",
        SESSION_SECRET: sessionSecret,
      }),
    });

    const response = await api.request("/api/v1/delegated-oauth/start", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-proto": "https",
      },
      body: JSON.stringify({
        providerId: "github",
        workspaceId: "workspace_default",
        connectorType: "github",
        scopes: ["repo"],
        returnTo: "/settings/connectors",
      }),
    });
    const text = await response.text();
    const body = JSON.parse(text);
    const authorizationUrl = new URL(body.data.authorizationUrl);
    const setCookie = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(200);
    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(
      "https://github.com/login/oauth/authorize",
    );
    expect(authorizationUrl.searchParams.get("response_type")).toBe("code");
    expect(authorizationUrl.searchParams.get("client_id")).toBe(
      "github-client-id",
    );
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      "https://romeo.example/api/v1/delegated-oauth/callback",
    );
    expect(authorizationUrl.searchParams.get("scope")).toBe("repo");
    expect(authorizationUrl.searchParams.get("state")).toEqual(
      expect.any(String),
    );
    expect(authorizationUrl.searchParams.get("nonce")).toEqual(
      expect.any(String),
    );
    expect(authorizationUrl.searchParams.get("code_challenge")).toEqual(
      expect.any(String),
    );
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe(
      "S256",
    );
    expect(body.data).toMatchObject({
      connectorType: "github",
      scopes: ["repo"],
      workspaceId: "workspace_default",
      provider: expect.objectContaining({ id: "github", configured: true }),
    });
    expect(body.data.stateCookie).toBeUndefined();
    expect(text).not.toContain("codeVerifier");
    expect(setCookie).toContain("romeo_delegated_oauth=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Path=/api/v1/delegated-oauth/callback");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Secure");
  });

  it("rejects provider callbacks without app authentication when state is missing", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: readEnv({
        APP_ORIGIN: "https://romeo.example",
        DEV_SEEDED_LOGIN: "false",
        SESSION_SECRET: sessionSecret,
      }),
    });

    const response = await api.request(
      "/api/v1/delegated-oauth/callback?code=authorization-code&state=state-1",
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("delegated_oauth_state_missing");
  });

  it("completes a GitHub callback, stores safe connection metadata, and revokes it", async () => {
    const repository = new InMemoryRomeoRepository();
    const fetchCalls: Array<{
      body?: BodyInit | null;
      headers?: HeadersInit;
      url: string;
    }> = [];
    const api = createRomeoApi(repository, {
      env: readEnv({
        APP_ORIGIN: "https://romeo.example",
        DELEGATED_OAUTH_GITHUB_CLIENT_ID: "github-client-id",
        DELEGATED_OAUTH_GITHUB_CLIENT_SECRET: "github-client-secret",
        DELEGATED_OAUTH_GITHUB_SCOPES: "repo,read:user",
        DELEGATED_OAUTH_TOKEN_ENCRYPTION_KEY:
          "delegated-oauth-test-token-key-32",
        SESSION_SECRET: sessionSecret,
      }),
      delegatedOAuthFetch: async (input, init) => {
        const call: (typeof fetchCalls)[number] = { url: String(input) };
        if (init?.body !== undefined) call.body = init.body;
        if (init?.headers !== undefined) call.headers = init.headers;
        fetchCalls.push(call);
        if (String(input) === "https://github.com/login/oauth/access_token") {
          expect(String(init?.body)).toContain("client_id=github-client-id");
          expect(String(init?.body)).toContain(
            "client_secret=github-client-secret",
          );
          expect(String(init?.body)).toContain("code=authorization-code");
          return new Response(
            JSON.stringify({
              access_token: "gho_secret_access_token",
              token_type: "bearer",
              scope: "repo,read:user",
              expires_in: 3600,
            }),
            { headers: { "content-type": "application/json" } },
          );
        }
        if (String(input) === "https://api.github.com/user") {
          expect((init?.headers as Record<string, string>)?.authorization).toBe(
            "Bearer gho_secret_access_token",
          );
          return new Response(JSON.stringify({ id: 12345, login: "octocat" }), {
            headers: { "content-type": "application/json" },
          });
        }
        if (
          String(input) ===
          "https://api.github.com/applications/github-client-id/grant"
        ) {
          expect(init?.method).toBe("DELETE");
          expect((init?.headers as Record<string, string>)?.authorization).toBe(
            `Basic ${Buffer.from(
              "github-client-id:github-client-secret",
            ).toString("base64")}`,
          );
          expect(String(init?.body)).toBe(
            JSON.stringify({ access_token: "gho_secret_access_token" }),
          );
          return new Response(null, { status: 204 });
        }
        return new Response("not found", { status: 404 });
      },
    });

    const startResponse = await api.request("/api/v1/delegated-oauth/start", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-proto": "https",
      },
      body: JSON.stringify({
        providerId: "github",
        workspaceId: "workspace_default",
        connectorType: "github",
        scopes: ["repo", "read:user"],
        returnTo: "/settings/connectors",
      }),
    });
    const start = await startResponse.json();
    const state = new URL(start.data.authorizationUrl).searchParams.get(
      "state",
    );
    const setCookie = startResponse.headers.get("set-cookie") ?? "";

    expect(startResponse.status).toBe(200);
    expect(state).toEqual(expect.any(String));
    expect(setCookie).toContain("romeo_delegated_oauth=");

    const callbackResponse = await api.request(
      `/api/v1/delegated-oauth/callback?code=authorization-code&state=${encodeURIComponent(
        state ?? "",
      )}`,
      {
        headers: {
          cookie: setCookie,
          "x-forwarded-proto": "https",
        },
      },
    );

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.get("location")).toBe(
      "/settings/connectors",
    );
    expect(fetchCalls.map((call) => call.url)).toEqual([
      "https://github.com/login/oauth/access_token",
      "https://api.github.com/user",
    ]);

    const replayResponse = await api.request(
      `/api/v1/delegated-oauth/callback?code=authorization-code-replay&state=${encodeURIComponent(
        state ?? "",
      )}`,
      {
        headers: {
          cookie: setCookie,
          "x-forwarded-proto": "https",
        },
      },
    );
    const replay = await replayResponse.json();

    expect(replayResponse.status).toBe(409);
    expect(replay.error.code).toBe("delegated_oauth_state_replayed");
    expect(fetchCalls.map((call) => call.url)).toEqual([
      "https://github.com/login/oauth/access_token",
      "https://api.github.com/user",
    ]);

    const connectionsResponse = await api.request(
      "/api/v1/delegated-oauth/connections?workspaceId=workspace_default",
    );
    const connections = await connectionsResponse.json();

    expect(connectionsResponse.status).toBe(200);
    expect(connections.data).toEqual([
      expect.objectContaining({
        workspaceId: "workspace_default",
        userId: "user_dev_admin",
        providerId: "github",
        connectorType: "github",
        providerAccountHash: expect.any(String),
        providerAccountLoginConfigured: true,
        providerAccountLoginHash: expect.any(String),
        scopes: ["repo", "read:user"],
        status: "active",
      }),
    ]);
    const connectionJson = JSON.stringify(connections.data);
    expect(connectionJson).not.toContain("12345");
    expect(connectionJson).not.toContain("octocat");
    expect(connectionJson).not.toContain("gho_secret");
    expect(connectionJson).not.toContain("token");

    const connectionId = connections.data[0].id as string;
    const revokeResponse = await api.request(
      `/api/v1/delegated-oauth/connections/${connectionId}/revoke`,
      { method: "POST" },
    );
    const revoked = await revokeResponse.json();

    expect(revokeResponse.status).toBe(200);
    expect(revoked.data.status).toBe("revoked");
    expect(revoked.data.revokedAt).toEqual(expect.any(String));
    expect(revoked.data.providerRevocationStatus).toBe("succeeded");
    expect(JSON.stringify(revoked.data)).not.toContain("12345");
    expect(JSON.stringify(revoked.data)).not.toContain("octocat");
    expect(fetchCalls.map((call) => call.url)).toEqual([
      "https://github.com/login/oauth/access_token",
      "https://api.github.com/user",
      "https://api.github.com/applications/github-client-id/grant",
    ]);

    const auditLogs = await repository.listAuditLogs("org_default");
    const auditJson = JSON.stringify(auditLogs);
    expect(auditLogs.map((log) => log.action)).toEqual(
      expect.arrayContaining([
        "delegated_oauth.connect",
        "delegated_oauth.revoke",
      ]),
    );
    expect(auditJson).not.toContain("gho_secret_access_token");
    expect(auditJson).not.toContain("github-client-secret");
    expect(auditJson).toContain('"providerRevocationStatus":"succeeded"');
  });
});

function delegatedOAuthToken(
  marker: string,
  createdAt: string,
): DelegatedOAuthTokenEnvelope {
  return {
    v: 1,
    alg: "A256GCM",
    ciphertext: `ciphertext-${marker}`,
    iv: `iv-${marker}`,
    tag: `tag-${marker}`,
    createdAt,
  };
}
