import { describe, expect, it, vi } from "vitest";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { testEnv } from "../test-support/env";
import { OidcClient } from "./oidc-client";
import { unverifiedJwtIsIdToken } from "./oidc-token-hints";

const issuer = "https://identity.example.com";
const otherIssuer = "https://other-identity.example.com";

async function createRsaKeyPair(kid: string) {
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
  Object.assign(publicJwk, { kid, alg: "RS256", use: "sig" });
  return { privateKey: pair.privateKey, publicJwk };
}

function encode(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

async function signJwt(
  privateKey: CryptoKey,
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { typ: "JWT" },
): Promise<string> {
  const input = `${encode({ alg: "RS256", kid: "bearer-key", ...header })}.${encode(payload)}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(input),
  );
  return `${input}.${Buffer.from(new Uint8Array(signature)).toString("base64url")}`;
}

async function multiTenantClient() {
  const key = await createRsaKeyPair("bearer-key");
  const fetchImpl = vi.fn<typeof fetch>(async (input) => {
    const url = input instanceof URL ? input.toString() : String(input);
    if (url === `${issuer}/keys`)
      return Response.json({ keys: [key.publicJwk] });
    return Response.json({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/keys`,
    });
  });
  const repository = new InMemoryRomeoRepository();
  const now = new Date().toISOString();
  for (const [orgId, issuerUrl, clientId] of [
    ["org_default", issuer, "app-a"],
    ["org_other", otherIssuer, "app-a"],
  ] as const) {
    await repository.upsertSsoOidcSettings({
      orgId,
      enabled: true,
      issuerUrl,
      clientId,
      groupClaim: "groups",
      adminGroups: [],
      groupMap: {},
      workspaceGroupMap: {},
      workspaceGroupPrefix: "",
      createdBy: "user_dev_admin",
      updatedBy: "user_dev_admin",
      createdAt: now,
      updatedAt: now,
    });
  }
  const client = new OidcClient(
    repository,
    testEnv({ TENANCY_MODE: "multi" }),
    { fetchImpl },
  );
  const claims = {
    iss: issuer,
    sub: "bearer-user",
    aud: "app-a",
    exp: Math.floor(Date.now() / 1000) + 3600,
    email: "bearer-user@example.com",
    name: "Bearer User",
    groups: [],
  };
  return { claims, client, fetchImpl, key, repository };
}

describe("OIDC bearer tokens", () => {
  it("selects the tenant by issuer without scanning every organization", async () => {
    const { claims, client, key, repository } = await multiTenantClient();
    const listAll = vi.spyOn(repository, "listAllOrganizations");
    const getSettings = vi.spyOn(repository, "getSsoOidcSettings");

    const subject = await client.authenticateJwt(
      await signJwt(key.privateKey, claims),
    );

    expect(subject.orgId).toBe("org_default");
    expect(listAll).not.toHaveBeenCalled();
    // Only the selected tenant's settings are read to verify the token.
    expect(
      getSettings.mock.calls.every(([orgId]) => orgId === "org_default"),
    ).toBe(true);
  });

  it("rejects an unknown issuer before any discovery or signature work", async () => {
    const { claims, client, fetchImpl, key } = await multiTenantClient();
    await expect(
      client.authenticateJwt(
        await signJwt(key.privateKey, {
          ...claims,
          iss: "https://unknown.example.com",
        }),
      ),
    ).rejects.toThrow("OIDC organization could not be resolved.");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects ID tokens presented as bearer access tokens", async () => {
    const { claims, client, fetchImpl, key } = await multiTenantClient();
    for (const extra of [
      { nonce: "login-nonce" },
      { at_hash: "x4H0ZdzA0Oyq_vMjVlpmsw" },
      { c_hash: "LDktKdoQak3Pk0cnXxCltA" },
      { token_use: "id" },
      { typ: "ID" },
    ]) {
      await expect(
        client.authenticateJwt(
          await signJwt(key.privateKey, { ...claims, ...extra }),
        ),
      ).rejects.toThrow("OIDC ID tokens are not accepted");
    }
    expect(fetchImpl).not.toHaveBeenCalled();

    // RFC 9068 access tokens are typed explicitly and remain accepted.
    const subject = await client.authenticateJwt(
      await signJwt(
        key.privateKey,
        { ...claims, nonce: "ignored" },
        { typ: "at+jwt" },
      ),
    );
    expect(subject.orgId).toBe("org_default");
  });

  it("classifies ID-token markers from unverified hints", () => {
    const token = (payload: Record<string, unknown>, typ = "JWT") =>
      `${encode({ alg: "RS256", typ })}.${encode(payload)}.sig`;
    expect(unverifiedJwtIsIdToken(token({ sub: "a" }))).toBe(false);
    expect(unverifiedJwtIsIdToken(token({ nonce: "n" }))).toBe(true);
    expect(
      unverifiedJwtIsIdToken(token({ nonce: "n" }, "application/at+jwt")),
    ).toBe(false);
    expect(unverifiedJwtIsIdToken("not-a-jwt")).toBe(false);
  });
});
