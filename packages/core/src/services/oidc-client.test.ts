import { testEnv } from "../test-support/env";
import { describe, expect, it, vi } from "vitest";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { createOidcRuntimeCache, OidcClient } from "./oidc-client";
import type { ResolvedSsoOidcConfig } from "./sso-config";

const issuer = "https://identity.example.com";

function config(clientId: string): ResolvedSsoOidcConfig {
  return {
    source: "database",
    enabled: true,
    issuerUrl: issuer,
    clientId,
    groupClaim: "groups",
    adminGroups: [],
    groupMap: {},
    workspaceGroupMap: {},
    workspaceGroupPrefix: "",
  };
}

function discoveryResponse(): Response {
  return Response.json({
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/keys`,
  });
}

describe("OidcClient configuration cache", () => {
  it("single-flights discovery across repository-scoped client instances", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      await gate;
      return discoveryResponse();
    });
    const runtimeCache = createOidcRuntimeCache();
    const clients = [
      new OidcClient(new InMemoryRomeoRepository(), testEnv(), {
        fetchImpl,
        runtimeCache,
      }),
      new OidcClient(new InMemoryRomeoRepository(), testEnv(), {
        fetchImpl,
        runtimeCache,
      }),
    ];
    const configurations = clients.map((client) =>
      client.configuredWithConfig("org-a", config("app-a")),
    );
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    release?.();

    await expect(Promise.all(configurations)).resolves.toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("rejects discovery metadata for a different issuer", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({
        issuer: "https://attacker.example.net",
        jwks_uri: `${issuer}/keys`,
      }),
    );
    const client = new OidcClient(new InMemoryRomeoRepository(), testEnv(), {
      fetchImpl,
    });

    await expect(
      client.configuredWithConfig("org-a", config("app-a")),
    ).rejects.toThrow(
      "discovered metadata issuer does not match the expected issuer",
    );
  });

  it("rejects a cross-origin JWKS URI unless its exact origin is allowed", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: "https://keys.example.net/jwks",
      }),
    );
    const blocked = new OidcClient(new InMemoryRomeoRepository(), testEnv(), {
      fetchImpl,
    });
    await expect(
      blocked.configuredWithConfig("org-a", config("app-a")),
    ).rejects.toThrow("oidc_endpoint_origin_blocked");

    const allowed = new OidcClient(
      new InMemoryRomeoRepository(),
      testEnv({ OIDC_ENDPOINT_ALLOWED_ORIGINS: "https://keys.example.net" }),
      { fetchImpl },
    );
    await expect(
      allowed.configuredWithConfig("org-a", config("app-a")),
    ).resolves.toMatchObject({ orgId: "org-a" });
  });

  it("does not share an issuer configuration across tenant client IDs", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => discoveryResponse());
    const client = new OidcClient(new InMemoryRomeoRepository(), testEnv(), {
      fetchImpl,
    });

    const first = await client.configuredWithConfig("org-a", config("app-a"));
    const second = await client.configuredWithConfig("org-b", config("app-b"));

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(first.openidClientConfiguration.clientMetadata().client_id).toBe(
      "app-a",
    );
    expect(second.openidClientConfiguration.clientMetadata().client_id).toBe(
      "app-b",
    );
  });

  it("evicts a rejected discovery promise so a later request can recover", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(discoveryResponse());
    const client = new OidcClient(new InMemoryRomeoRepository(), testEnv(), {
      fetchImpl,
    });

    await expect(
      client.configuredWithConfig("org-a", config("app-a")),
    ).rejects.toThrow("unexpected HTTP response status code");
    await expect(
      client.configuredWithConfig("org-a", config("app-a")),
    ).resolves.toMatchObject({ orgId: "org-a" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("expires discovery entries instead of retaining configuration forever", async () => {
    let now = 1_000;
    const fetchImpl = vi.fn<typeof fetch>(async () => discoveryResponse());
    const client = new OidcClient(new InMemoryRomeoRepository(), testEnv(), {
      cacheTtlMs: 100,
      fetchImpl,
      now: () => now,
    });

    await client.configuredWithConfig("org-a", config("app-a"));
    now += 99;
    await client.configuredWithConfig("org-a", config("app-a"));
    now += 2;
    await client.configuredWithConfig("org-a", config("app-a"));

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("caps caller-provided cache TTLs at the deployment maximum", async () => {
    let now = 1_000;
    const fetchImpl = vi.fn<typeof fetch>(async () => discoveryResponse());
    const client = new OidcClient(new InMemoryRomeoRepository(), testEnv(), {
      cacheTtlMs: Number.MAX_SAFE_INTEGER,
      fetchImpl,
      now: () => now,
    });

    await client.configuredWithConfig("org-a", config("app-a"));
    now += 60 * 60 * 1000 + 1;
    await client.configuredWithConfig("org-a", config("app-a"));

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("expires JWKS cache entries and fetches current keys again", async () => {
    const key = await createRsaKeyPair("cache-key");
    let now = Date.now();
    let jwksFetches = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = input instanceof URL ? input.toString() : String(input);
      if (url === `${issuer}/keys`) {
        jwksFetches += 1;
        return Response.json({ keys: [key.publicJwk] });
      }
      return discoveryResponse();
    });
    const client = new OidcClient(new InMemoryRomeoRepository(), testEnv(), {
      cacheTtlMs: 100,
      fetchImpl,
      now: () => now,
    });
    const token = await signJwt(key.privateKey, "cache-key", {
      iss: issuer,
      sub: "cache-user",
      aud: "app-a",
      exp: Math.floor(Date.now() / 1000) + 3600,
      email: "cache-user@example.com",
      name: "Cache User",
      groups: [],
    });

    await client.authenticateJwtWithConfig(token, {
      config: config("app-a"),
      orgId: "org_default",
    });
    now += 101;
    await client.authenticateJwtWithConfig(token, {
      config: config("app-a"),
      orgId: "org_default",
    });

    expect(jwksFetches).toBe(2);
  });

  it("refreshes JWKS once for an unknown kid and rate limits repeated misses", async () => {
    const oldKey = await createRsaKeyPair("old-kid");
    const newKey = await createRsaKeyPair("new-kid");
    const unknownKey = await createRsaKeyPair("unknown-kid");
    let jwksFetches = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url === `${issuer}/keys`) {
        jwksFetches += 1;
        return Response.json({
          keys: [jwksFetches === 1 ? oldKey.publicJwk : newKey.publicJwk],
        });
      }
      return discoveryResponse();
    });
    const client = new OidcClient(new InMemoryRomeoRepository(), testEnv(), {
      fetchImpl,
      jwksRefreshCooldownMs: 60_000,
    });
    const claims = (sub: string) => ({
      iss: issuer,
      sub,
      aud: "app-a",
      exp: Math.floor(Date.now() / 1000) + 3600,
      email: `${sub}@example.com`,
      name: sub,
      groups: [],
    });

    await client.authenticateJwtWithConfig(
      await signJwt(oldKey.privateKey, "old-kid", claims("old-user")),
      { config: config("app-a"), orgId: "org_default" },
    );
    await client.authenticateJwtWithConfig(
      await signJwt(newKey.privateKey, "new-kid", claims("new-user")),
      { config: config("app-a"), orgId: "org_default" },
    );
    await expect(
      client.authenticateJwtWithConfig(
        await signJwt(
          unknownKey.privateKey,
          "unknown-kid",
          claims("unknown-user"),
        ),
        { config: config("app-a"), orgId: "org_default" },
      ),
    ).rejects.toThrow("OIDC signing key was not found");

    expect(jwksFetches).toBe(2);
  });
});

async function createRsaKeyPair(
  kid: string,
): Promise<{ privateKey: CryptoKey; publicJwk: JsonWebKey }> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const publicJwk = (await crypto.subtle.exportKey(
    "jwk",
    pair.publicKey,
  )) as JsonWebKey & { kid?: string };
  publicJwk.kid = kid;
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";
  return { privateKey: pair.privateKey, publicJwk };
}

async function signJwt(
  privateKey: CryptoKey,
  kid: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const input = `${encode({ alg: "RS256", kid, typ: "JWT" })}.${encode(payload)}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      privateKey,
      new TextEncoder().encode(input),
    ),
  );
  return `${input}.${Buffer.from(signature).toString("base64url")}`;
}

function encode(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
