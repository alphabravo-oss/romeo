import {
  createCipheriv,
  createHash,
  randomBytes,
  type CipherGCM,
} from "node:crypto";
import { describe, expect, it } from "vitest";

import type { DelegatedOAuthTokenEnvelope } from "../domain/delegated-oauth";
import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { testEnv } from "../test-support/env";
import { DelegatedOAuthConfiguration } from "./delegated-oauth-configuration";
import { DelegatedOAuthTokenRuntime } from "./delegated-oauth-token-runtime";
import {
  delegatedOAuthTokenContext,
  DelegatedOAuthTokenVault,
  type DelegatedOAuthStoredToken,
  type DelegatedOAuthTokenContext,
} from "./delegated-oauth-token-vault";
import {
  LocalMfaSecretVault,
  type LocalMfaSecretContext,
} from "./local-mfa-secret-vault";

const encryptionKey = "test-record-bound-envelope-key-32-bytes";

describe("record-bound secret envelopes", () => {
  it("binds local MFA v2 ciphertext to every factor identity field", () => {
    const vault = new LocalMfaSecretVault(encryptionKey);
    const context: LocalMfaSecretContext = {
      factorId: "mfa_factor_primary",
      factorType: "totp",
      orgId: "org_a",
      userId: "user_a",
    };
    const encrypted = vault.encrypt("JBSWY3DPEHPK3PXP", context);

    expect(JSON.parse(encrypted)).toMatchObject({ v: 2, alg: "A256GCM" });
    expect(vault.decrypt(encrypted, context)).toBe("JBSWY3DPEHPK3PXP");

    const swappedContexts: LocalMfaSecretContext[] = [
      { ...context, orgId: "org_b" },
      { ...context, userId: "user_b" },
      { ...context, factorId: "mfa_factor_secondary" },
      { ...context, factorType: "recovery_codes" },
    ];
    for (const swappedContext of swappedContexts) {
      expect(() => vault.decrypt(encrypted, swappedContext)).toThrow(/.+/u);
    }

    const tampered = JSON.parse(encrypted) as { ciphertext: string };
    tampered.ciphertext = tamperEncoded(tampered.ciphertext);
    expect(() => vault.decrypt(JSON.stringify(tampered), context)).toThrow(
      /.+/u,
    );
  });

  it("reads legacy local MFA v1 ciphertext and rewraps it as bound v2", () => {
    const vault = new LocalMfaSecretVault(encryptionKey);
    const context: LocalMfaSecretContext = {
      factorId: "mfa_factor_legacy",
      factorType: "totp",
      orgId: "org_a",
      userId: "user_a",
    };
    const legacy = legacyEnvelope(
      "JBSWY3DPEHPK3PXP",
      "romeo local mfa secret vault v1",
    );

    const plaintext = vault.decrypt(JSON.stringify(legacy), context);
    const migrated = vault.encrypt(plaintext, context);

    expect(plaintext).toBe("JBSWY3DPEHPK3PXP");
    expect(JSON.parse(migrated)).toMatchObject({ v: 2 });
    expect(vault.decrypt(migrated, context)).toBe(plaintext);
  });

  it("binds delegated OAuth v2 ciphertext to every connection identity field", () => {
    const vault = new DelegatedOAuthTokenVault(encryptionKey);
    const context: DelegatedOAuthTokenContext = {
      connectionId: "delegated_connection_primary",
      connectorType: "github",
      orgId: "org_a",
      providerId: "github",
      userId: "user_a",
      workspaceId: "workspace_a",
    };
    const token = delegatedToken();
    const encrypted = vault.encrypt(token, context);

    expect(encrypted).toMatchObject({ v: 2, alg: "A256GCM" });
    expect(vault.decrypt(encrypted, context)).toEqual(token);

    const swappedContexts: DelegatedOAuthTokenContext[] = [
      { ...context, orgId: "org_b" },
      { ...context, workspaceId: "workspace_b" },
      { ...context, userId: "user_b" },
      { ...context, connectionId: "delegated_connection_secondary" },
      { ...context, providerId: "provider_b" },
      { ...context, connectorType: "connector_b" },
    ];
    for (const swappedContext of swappedContexts) {
      expect(() => vault.decrypt(encrypted, swappedContext)).toThrow(/.+/u);
    }

    expect(() =>
      vault.decrypt(
        { ...encrypted, tag: tamperEncoded(encrypted.tag) },
        context,
      ),
    ).toThrow(/.+/u);
  });

  it("reads legacy delegated OAuth v1 ciphertext and rewraps it as bound v2", () => {
    const vault = new DelegatedOAuthTokenVault(encryptionKey);
    const context: DelegatedOAuthTokenContext = {
      connectionId: "delegated_connection_legacy",
      connectorType: "github",
      orgId: "org_a",
      providerId: "github",
      userId: "user_a",
      workspaceId: "workspace_a",
    };
    const token = delegatedToken();
    const legacy = legacyEnvelope(
      JSON.stringify(token),
      "romeo delegated oauth token vault v1",
    );

    const plaintext = vault.decrypt(legacy, context);
    const migrated = vault.encrypt(plaintext, context);

    expect(plaintext).toEqual(token);
    expect(migrated).toMatchObject({ v: 2 });
    expect(vault.decrypt(migrated, context)).toEqual(token);
  });

  it("opportunistically migrates a used delegated OAuth v1 token", async () => {
    const repository = new InMemoryRomeoRepository();
    const env = testEnv({
      DELEGATED_OAUTH_TOKEN_ENCRYPTION_KEY: encryptionKey,
    });
    const token = delegatedToken();
    const connection = await repository.createDelegatedOAuthConnection({
      id: "delegated_connection_runtime_legacy",
      connectorType: "github",
      createdAt: "2026-08-13T12:00:00.000Z",
      orgId: "org_a",
      providerAccountId: "provider_account_a",
      providerId: "github",
      scopes: ["repo"],
      status: "active",
      token: legacyEnvelope(
        JSON.stringify(token),
        "romeo delegated oauth token vault v1",
      ),
      updatedAt: "2026-08-13T12:00:00.000Z",
      userId: "user_a",
      workspaceId: "workspace_a",
    });
    const runtime = new DelegatedOAuthTokenRuntime(
      repository,
      env,
      new DelegatedOAuthConfiguration(env),
    );

    expect((await runtime.getUsableToken(connection)).token).toEqual(token);

    const migrated = await repository.getDelegatedOAuthConnection(
      connection.id,
    );
    if (migrated === undefined) throw new Error("Migrated connection missing.");
    expect(migrated.token.v).toBe(2);
    expect(
      new DelegatedOAuthTokenVault(encryptionKey).decrypt(
        migrated.token,
        delegatedOAuthTokenContext(migrated),
      ),
    ).toEqual(token);
  });
});

function delegatedToken(): DelegatedOAuthStoredToken {
  return {
    accessToken: "delegated-access-token",
    obtainedAt: "2026-08-13T12:00:00.000Z",
    refreshToken: "delegated-refresh-token",
    scopes: ["repo"],
    tokenType: "bearer",
  };
}

function legacyEnvelope(
  plaintext: string,
  keyPurpose: string,
): DelegatedOAuthTokenEnvelope {
  const key = createHash("sha256")
    .update(keyPurpose, "utf8")
    .update(encryptionKey, "utf8")
    .digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv) as CipherGCM;
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    v: 1,
    alg: "A256GCM",
    ciphertext: ciphertext.toString("base64url"),
    createdAt: "2026-08-13T12:00:00.000Z",
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
  };
}

function tamperEncoded(value: string): string {
  return `${value.startsWith("A") ? "B" : "A"}${value.slice(1)}`;
}
