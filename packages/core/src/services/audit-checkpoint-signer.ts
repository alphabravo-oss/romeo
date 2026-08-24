import { createHmac, timingSafeEqual } from "node:crypto";

import { sha256 } from "../domain/audit-integrity";

export interface AuditCheckpointSigner {
  readonly activeAlgorithm: "hmac-sha256";
  readonly activeKeyVersion: string;
  hasKeyVersion(keyVersion: string): boolean | Promise<boolean>;
  sign(payload: string): string | Promise<string>;
  verify(input: {
    algorithm: "hmac-sha256";
    keyVersion: string;
    payload: string;
    signature: string;
  }): boolean | Promise<boolean>;
}

export class VersionedHmacAuditCheckpointSigner implements AuditCheckpointSigner {
  readonly activeAlgorithm = "hmac-sha256" as const;
  readonly activeKeyVersion: string;
  private readonly keys = new Map<string, Uint8Array>();

  constructor(input: {
    activeKeyVersion: string;
    keys: Readonly<Record<string, string | Uint8Array>>;
  }) {
    this.activeKeyVersion = input.activeKeyVersion;
    for (const [version, source] of Object.entries(input.keys)) {
      if (version.trim().length === 0)
        throw new TypeError("Audit signing key versions cannot be empty.");
      const bytes =
        typeof source === "string" ? Buffer.from(source, "utf8") : source;
      if (bytes.byteLength < 32)
        throw new TypeError(
          "Audit signing keys must contain at least 32 bytes.",
        );
      this.keys.set(version, deriveAuditSigningKey(bytes));
    }
    if (!this.keys.has(this.activeKeyVersion))
      throw new TypeError(
        "The active audit signing key version is unavailable.",
      );
  }

  static fromSecrets(input: {
    current: string;
    previous?: string;
  }): VersionedHmacAuditCheckpointSigner {
    const currentVersion = signingKeyVersion(input.current);
    const keys: Record<string, Uint8Array> = {
      [currentVersion]: Buffer.from(sha256(input.current), "hex"),
    };
    if (input.previous !== undefined && input.previous.length > 0)
      keys[signingKeyVersion(input.previous)] = Buffer.from(
        sha256(input.previous),
        "hex",
      );
    return new VersionedHmacAuditCheckpointSigner({
      activeKeyVersion: currentVersion,
      keys,
    });
  }

  sign(payload: string): string {
    const key = this.keys.get(this.activeKeyVersion)!;
    return createHmac("sha256", key).update(payload).digest("hex");
  }

  hasKeyVersion(keyVersion: string): boolean {
    return this.keys.has(keyVersion);
  }

  verify(input: {
    algorithm: "hmac-sha256";
    keyVersion: string;
    payload: string;
    signature: string;
  }): boolean {
    if (input.algorithm !== this.activeAlgorithm) return false;
    const key = this.keys.get(input.keyVersion);
    if (key === undefined || !/^[a-f\d]{64}$/u.test(input.signature))
      return false;
    const expected = createHmac("sha256", key).update(input.payload).digest();
    const received = Buffer.from(input.signature, "hex");
    return (
      received.length === expected.length && timingSafeEqual(received, expected)
    );
  }
}

function deriveAuditSigningKey(secret: Uint8Array): Uint8Array {
  return createHmac("sha256", secret)
    .update("romeo.audit-checkpoint-signing.v1")
    .digest();
}

function signingKeyVersion(secret: string): string {
  return `hmac-sha256:${sha256(secret).slice(0, 16)}`;
}
