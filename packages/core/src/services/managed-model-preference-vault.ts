import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import { ApiError } from "../errors";

type StoredEnvelope =
  | { alg: "none"; value: string; v: 1 }
  | {
      alg: "A256GCM";
      ciphertext: string;
      iv: string;
      tag: string;
      v: 1;
    };

export interface ManagedModelPreferenceVaultOptions {
  encryptionKey?: string | undefined;
  previousEncryptionKey?: string | undefined;
}

export class ManagedModelPreferenceVault {
  private readonly currentKey: Buffer | undefined;
  private readonly previousKey: Buffer | undefined;

  constructor(options: ManagedModelPreferenceVaultOptions = {}) {
    this.currentKey = deriveKey(options.encryptionKey);
    this.previousKey = deriveKey(options.previousEncryptionKey);
  }

  encode(value: string, context: string): string {
    if (!this.currentKey) return JSON.stringify({ alg: "none", v: 1, value });
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.currentKey, iv);
    cipher.setAAD(Buffer.from(context, "utf8"));
    const ciphertext = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    return JSON.stringify({
      alg: "A256GCM",
      ciphertext: ciphertext.toString("base64url"),
      iv: iv.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
      v: 1,
    } satisfies StoredEnvelope);
  }

  decode(encoded: string, context: string): string {
    const envelope = parseEnvelope(encoded);
    if (envelope.alg === "none") return envelope.value;
    for (const key of [this.currentKey, this.previousKey]) {
      if (!key) continue;
      try {
        const decipher = createDecipheriv(
          "aes-256-gcm",
          key,
          Buffer.from(envelope.iv, "base64url"),
        );
        decipher.setAAD(Buffer.from(context, "utf8"));
        decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
        return Buffer.concat([
          decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
          decipher.final(),
        ]).toString("utf8");
      } catch {
        // Try the previous key during a rolling rotation.
      }
    }
    throw new ApiError(
      "managed_model_preferences_decryption_failed",
      "Managed-model custom instructions could not be decrypted.",
      500,
    );
  }
}

function deriveKey(value: string | undefined): Buffer | undefined {
  const normalized = value?.trim() ?? "";
  return normalized.length < 32
    ? undefined
    : createHash("sha256")
        .update("romeo managed model preferences v1", "utf8")
        .update(normalized, "utf8")
        .digest();
}

function parseEnvelope(encoded: string): StoredEnvelope {
  let value: Partial<StoredEnvelope>;
  try {
    value = JSON.parse(encoded) as Partial<StoredEnvelope>;
  } catch {
    throw invalidEnvelope();
  }
  if (value.v !== 1) throw invalidEnvelope();
  if (value.alg === "none" && typeof value.value === "string")
    return value as StoredEnvelope;
  if (
    value.alg === "A256GCM" &&
    typeof value.ciphertext === "string" &&
    typeof value.iv === "string" &&
    typeof value.tag === "string"
  )
    return value as StoredEnvelope;
  throw invalidEnvelope();
}

function invalidEnvelope(): ApiError {
  return new ApiError(
    "managed_model_preferences_envelope_invalid",
    "Managed-model custom instructions have an invalid storage envelope.",
    500,
  );
}
