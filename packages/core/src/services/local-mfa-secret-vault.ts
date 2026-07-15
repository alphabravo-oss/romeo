import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import { ApiError } from "../errors";

interface LocalMfaSecretEnvelope {
  v: 1;
  alg: "A256GCM";
  iv: string;
  ciphertext: string;
  tag: string;
  createdAt: string;
}

export class LocalMfaSecretVault {
  private readonly key: Buffer;

  constructor(secret: string) {
    const trimmed = secret.trim();
    if (trimmed.length < 32) {
      throw new ApiError(
        "local_mfa_secret_key_not_configured",
        "Local MFA secret encryption key must be configured before enrolling TOTP factors.",
        409,
      );
    }
    this.key = createHash("sha256")
      .update("romeo local mfa secret vault v1", "utf8")
      .update(trimmed, "utf8")
      .digest();
  }

  encrypt(secret: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(secret, "utf8"),
      cipher.final(),
    ]);
    return JSON.stringify({
      v: 1,
      alg: "A256GCM",
      iv: iv.toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
      createdAt: new Date().toISOString(),
    } satisfies LocalMfaSecretEnvelope);
  }

  decrypt(envelopeJson: string): string {
    const envelope = parseEnvelope(envelopeJson);
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(envelope.iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }
}

export function localMfaSecretKeyConfigured(secret: string): boolean {
  const trimmed = secret.trim();
  return (
    trimmed.length >= 32 &&
    !trimmed.startsWith("dev-") &&
    !trimmed.includes("change-me")
  );
}

function parseEnvelope(envelopeJson: string): LocalMfaSecretEnvelope {
  const value = JSON.parse(envelopeJson) as Partial<LocalMfaSecretEnvelope>;
  if (
    value.v !== 1 ||
    value.alg !== "A256GCM" ||
    typeof value.iv !== "string" ||
    typeof value.ciphertext !== "string" ||
    typeof value.tag !== "string" ||
    typeof value.createdAt !== "string"
  ) {
    throw new ApiError(
      "local_mfa_secret_invalid",
      "Local MFA secret envelope is invalid.",
      500,
    );
  }
  return value as LocalMfaSecretEnvelope;
}
