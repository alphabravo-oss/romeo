import {
  createCipheriv,
  createHash,
  randomBytes,
  type CipherGCM,
} from "node:crypto";
import { describe, expect, it } from "vitest";

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
});

function legacyEnvelope(
  plaintext: string,
  keyPurpose: string,
): Record<string, unknown> {
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
