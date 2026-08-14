import { testEnv } from "../test-support/env";
import { describe, expect, it, vi } from "vitest";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { OidcClient } from "./oidc-client";
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
