import { describe, expect, it } from "vitest";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { testEnv } from "../test-support/env";
import { OidcClient, oidcUserId } from "./oidc-client";
import type { ResolvedSsoOidcConfig } from "./sso-config";
import {
  ssoMembershipSource,
  syncExternalGroupMemberships,
  syncMappedWorkspaceMemberships,
} from "./sso-membership-reconciliation";

const issuer = "https://identity.example.com";
const orgId = "org_default";

describe("SSO membership reconciliation", () => {
  it("revokes OIDC-mapped groups and workspaces the IdP stops asserting on the next login", async () => {
    const repository = await repositoryWithGroups([
      "group_eng",
      "group_design",
      "group_ops",
    ]);
    const userId = oidcUserId(issuer, "oidc-user-1");
    const login = await oidcLogin(repository);

    await login(["eng", "design", "ops", "workspace:workspace_default"]);
    expect(await groupIds(repository, userId)).toEqual([
      "group_design",
      "group_eng",
      "group_ops",
    ]);
    expect(await workspaceGrantIds(repository, userId)).toEqual([
      "workspace_default",
    ]);

    const subject = await login(["design"]);

    expect(await groupIds(repository, userId)).toEqual(["group_design"]);
    expect(await workspaceGrantIds(repository, userId)).toEqual([]);
    expect(subject.groupIds).not.toContain("group_eng");
    const revocations = (await repository.listAuditLogs(orgId)).filter(
      (log) => log.action === "auth.sso.member.revoke",
    );
    expect(
      revocations.map((log) => [log.resourceType, log.resourceId]).sort(),
    ).toEqual([
      ["group", "group_eng"],
      ["group", "group_ops"],
      ["workspace", "workspace_default"],
    ]);
    expect(revocations[0]).toMatchObject({
      actorId: userId,
      metadata: { providerKind: "oidc", userId },
    });
  });

  it("keeps manual memberships and memberships granted by another provider", async () => {
    const repository = await repositoryWithGroups([
      "group_eng",
      "group_manual",
      "group_saml",
    ]);
    const userId = oidcUserId(issuer, "oidc-user-1");
    const login = await oidcLogin(repository);
    await login(["eng", "manual", "saml"]);
    // Already present before SSO asserted them, so their provenance is kept.
    await repository.deleteGroupMembership("group_manual", userId);
    await repository.deleteGroupMembership("group_saml", userId);
    await repository.createGroupMembership(membership("group_manual", userId));
    await repository.createGroupMembership(membership("group_saml", userId), {
      source: ssoMembershipSource({ kind: "saml", providerKey: "saml" }),
    });
    await login(["eng", "manual", "saml"]);

    await login([]);

    expect(await groupIds(repository, userId)).toEqual([
      "group_manual",
      "group_saml",
    ]);
  });

  it("does not revoke memberships when an assertion is additive only", async () => {
    const repository = await repositoryWithGroups(["group_eng"]);
    const source = { kind: "ldap", providerKey: "ldap" } as const;
    await syncExternalGroupMemberships(repository, {
      groupIds: ["group_eng"],
      orgId,
      source,
      userId: "user_dev_admin",
    });
    await syncMappedWorkspaceMemberships(repository, {
      orgId,
      source,
      userId: "user_dev_admin",
      workspaceIds: ["workspace_default"],
    });

    await syncExternalGroupMemberships(repository, {
      groupIds: [],
      orgId,
      revokeUnasserted: false,
      source,
      userId: "user_dev_admin",
    });
    await syncMappedWorkspaceMemberships(repository, {
      orgId,
      revokeUnasserted: false,
      source,
      userId: "user_dev_admin",
      workspaceIds: [],
    });

    expect(await groupIds(repository, "user_dev_admin")).toContain("group_eng");
    expect(await workspaceGrantIds(repository, "user_dev_admin")).toEqual([
      "workspace_default",
    ]);
  });

  it("keeps provenance out of membership and grant read models", async () => {
    const repository = await repositoryWithGroups(["group_eng"]);
    const source = { kind: "oauth2", providerKey: "github" } as const;
    await syncExternalGroupMemberships(repository, {
      groupIds: ["group_eng"],
      orgId,
      source,
      userId: "user_dev_admin",
    });
    await syncMappedWorkspaceMemberships(repository, {
      orgId,
      source,
      userId: "user_dev_admin",
      workspaceIds: ["workspace_default"],
    });

    const serialized = JSON.stringify([
      await repository.listGroupMemberships(orgId),
      await repository.listResourceGrants(orgId),
    ]);
    expect(serialized).not.toContain("sso:");
    expect(
      await repository.listGroupMembershipsBySource(
        orgId,
        "user_dev_admin",
        ssoMembershipSource(source),
      ),
    ).toHaveLength(1);
  });
});

async function repositoryWithGroups(
  ids: string[],
): Promise<InMemoryRomeoRepository> {
  const repository = new InMemoryRomeoRepository();
  for (const id of ids) {
    await repository.createGroup({
      id,
      orgId,
      name: id,
      slug: id,
      createdAt: new Date().toISOString(),
    });
  }
  return repository;
}

function membership(groupId: string, userId: string) {
  return { groupId, userId, orgId, createdAt: new Date().toISOString() };
}

async function groupIds(
  repository: InMemoryRomeoRepository,
  userId: string,
): Promise<string[]> {
  return (await repository.listGroupMemberships(orgId, undefined, userId))
    .map((item) => item.groupId)
    .filter((groupId) => groupId !== "group_admins")
    .sort();
}

async function workspaceGrantIds(
  repository: InMemoryRomeoRepository,
  userId: string,
): Promise<string[]> {
  return (await repository.listResourceGrants(orgId))
    .filter(
      (grant) =>
        grant.resourceType === "workspace" &&
        grant.principalType === "user" &&
        grant.principalId === userId,
    )
    .map((grant) => grant.resourceId)
    .sort();
}

async function oidcLogin(repository: InMemoryRomeoRepository) {
  const keys = await createRsaKeyPair("kid_1");
  const fetchImpl: typeof fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === `${issuer}/.well-known/openid-configuration`)
      return Response.json({ issuer, jwks_uri: `${issuer}/keys` });
    if (url === `${issuer}/keys`)
      return Response.json({ keys: [keys.publicJwk] });
    return new Response("not found", { status: 404 });
  };
  const client = new OidcClient(repository, testEnv(), { fetchImpl });
  const config: ResolvedSsoOidcConfig = {
    source: "database",
    enabled: true,
    issuerUrl: issuer,
    clientId: "romeo",
    groupClaim: "groups",
    adminGroups: [],
    groupMap: {
      design: "group_design",
      eng: "group_eng",
      manual: "group_manual",
      ops: "group_ops",
      saml: "group_saml",
    },
    workspaceGroupMap: {},
    workspaceGroupPrefix: "workspace:",
  };
  return async (groups: string[]) => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(keys.privateKey, {
      iss: issuer,
      sub: "oidc-user-1",
      aud: "romeo",
      exp: now + 300,
      iat: now,
      nonce: "nonce-1",
      email: "oidc-user-1@example.com",
      name: "OIDC User",
      groups,
    });
    return client.authenticateJwtWithConfig(token, {
      config,
      expectedNonce: "nonce-1",
      orgId,
    });
  };
}

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
  payload: Record<string, unknown>,
): Promise<string> {
  const header = { alg: "RS256", kid: "kid_1", typ: "JWT" };
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}

function base64Url(value: string | Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}
