import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import type { DelegatedOAuthTokenEnvelope } from "../domain/delegated-oauth";
import {
  accumulateRuntimeKeyUsage,
  classifyDelegatedOAuthTokenEnvelope,
  emptyRuntimeKeyUsageCounts,
  type RuntimeKeyUsageCounts,
} from "../domain/runtime-key-usage";
import { ApiError } from "../errors";

export interface DelegatedOAuthStoredToken {
  accessToken: string;
  expiresAt?: string;
  obtainedAt: string;
  refreshToken?: string;
  refreshTokenExpiresAt?: string;
  scopes: string[];
  tokenType: "bearer";
}

export interface DelegatedOAuthTokenContext {
  connectionId: string;
  connectorType: string;
  orgId: string;
  providerId: string;
  userId: string;
  workspaceId: string;
}

export class DelegatedOAuthTokenVault {
  private readonly active: VaultKey;
  private readonly previous?: VaultKey;

  constructor(
    secretOrKeyring: string | { active: string; previous?: string | undefined },
  ) {
    const activeSecret =
      typeof secretOrKeyring === "string"
        ? secretOrKeyring
        : secretOrKeyring.active;
    const previousSecret =
      typeof secretOrKeyring === "string"
        ? undefined
        : secretOrKeyring.previous?.trim() || undefined;
    this.active = vaultKey(activeSecret);
    if (previousSecret !== undefined) {
      this.previous = vaultKey(previousSecret);
      if (this.previous.version === this.active.version)
        throw new ApiError(
          "delegated_oauth_token_key_rotation_invalid",
          "Delegated OAuth active and previous encryption keys must differ.",
          500,
        );
    }
  }

  encrypt(
    token: DelegatedOAuthStoredToken,
    context: DelegatedOAuthTokenContext,
  ): DelegatedOAuthTokenEnvelope {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.active.key, iv);
    cipher.setAAD(delegatedOAuthTokenAad(context));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(token), "utf8"),
      cipher.final(),
    ]);
    const envelope: DelegatedOAuthTokenEnvelope = {
      v: 3,
      keyVersion: this.active.version,
      alg: "A256GCM",
      iv: iv.toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
      createdAt: new Date().toISOString(),
    };
    return envelope;
  }

  decrypt(
    envelope: DelegatedOAuthTokenEnvelope,
    context: DelegatedOAuthTokenContext,
  ): DelegatedOAuthStoredToken {
    const candidates = this.decryptionKeys(envelope);
    let plaintext: string | undefined;
    for (const candidate of candidates) {
      try {
        plaintext = decryptEnvelope(candidate.key, envelope, context);
        break;
      } catch {
        // A legacy envelope does not identify its key, so try the bounded
        // active/previous keyring without leaking which key failed.
      }
    }
    if (plaintext === undefined)
      throw new ApiError(
        "delegated_oauth_token_decryption_failed",
        "Delegated OAuth token envelope could not be decrypted by the configured keyring.",
        500,
      );
    const token = JSON.parse(plaintext) as unknown;
    if (!isStoredToken(token)) {
      throw new ApiError(
        "delegated_oauth_token_invalid",
        "Delegated OAuth token payload is invalid.",
        500,
      );
    }
    return token;
  }

  get activeKeyVersion(): string {
    return this.active.version;
  }

  get previousKeyVersion(): string | undefined {
    return this.previous?.version;
  }

  needsRewrap(envelope: DelegatedOAuthTokenEnvelope): boolean {
    return envelope.v !== 3 || envelope.keyVersion !== this.active.version;
  }

  rotationPosture(envelopes: DelegatedOAuthTokenEnvelope[]): {
    active: number;
    corrupt: number;
    legacyUnversioned: number;
    previous: number;
    safeToRemovePrevious: boolean;
    unknown: number;
  } {
    const counts = emptyRuntimeKeyUsageCounts();
    for (const envelope of envelopes) {
      accumulateRuntimeKeyUsage(
        counts,
        classifyDelegatedOAuthTokenEnvelope(envelope, {
          activeVersion: this.active.version,
          ...(this.previous === undefined
            ? {}
            : { previousVersion: this.previous.version }),
        }),
      );
    }
    return this.rotationPostureFromUsage(counts);
  }

  rotationPostureFromUsage(counts: RuntimeKeyUsageCounts): {
    active: number;
    corrupt: number;
    legacyUnversioned: number;
    previous: number;
    safeToRemovePrevious: boolean;
    total: number;
    unknown: number;
  } {
    return {
      ...counts,
      safeToRemovePrevious:
        counts.previous === 0 &&
        counts.legacyUnversioned === 0 &&
        counts.unknown === 0 &&
        counts.corrupt === 0,
    };
  }

  private decryptionKeys(envelope: DelegatedOAuthTokenEnvelope): VaultKey[] {
    if (envelope.v !== 3)
      return [
        this.active,
        ...(this.previous === undefined ? [] : [this.previous]),
      ];
    if (envelope.keyVersion === this.active.version) return [this.active];
    if (envelope.keyVersion === this.previous?.version) return [this.previous];
    return [];
  }
}

interface VaultKey {
  key: Buffer;
  version: string;
}

function vaultKey(secret: string): VaultKey {
  const trimmed = secret.trim();
  if (trimmed.length < 32) {
    throw new ApiError(
      "delegated_oauth_token_key_not_configured",
      "Delegated OAuth token encryption key must be configured before completing OAuth callbacks.",
      409,
    );
  }
  const key = createHash("sha256")
    .update("romeo delegated oauth token vault v1", "utf8")
    .update(trimmed, "utf8")
    .digest();
  return {
    key,
    version: createHash("sha256")
      .update("romeo delegated oauth key version v1", "utf8")
      .update(key)
      .digest("hex")
      .slice(0, 16),
  };
}

function decryptEnvelope(
  key: Buffer,
  envelope: DelegatedOAuthTokenEnvelope,
  context: DelegatedOAuthTokenContext,
): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(envelope.iv, "base64url"),
  );
  if (envelope.v >= 2) decipher.setAAD(delegatedOAuthTokenAad(context));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function delegatedOAuthTokenContext(connection: {
  connectorType: string;
  id: string;
  orgId: string;
  providerId: string;
  userId: string;
  workspaceId: string;
}): DelegatedOAuthTokenContext {
  return {
    connectionId: connection.id,
    connectorType: connection.connectorType,
    orgId: connection.orgId,
    providerId: connection.providerId,
    userId: connection.userId,
    workspaceId: connection.workspaceId,
  };
}

function delegatedOAuthTokenAad(context: DelegatedOAuthTokenContext): Buffer {
  return Buffer.from(
    JSON.stringify([
      "romeo.delegated-oauth-token",
      context.orgId,
      context.workspaceId,
      context.userId,
      context.connectionId,
      context.providerId,
      context.connectorType,
    ]),
    "utf8",
  );
}

function isStoredToken(value: unknown): value is DelegatedOAuthStoredToken {
  const candidate = value as Partial<DelegatedOAuthStoredToken>;
  return (
    typeof value === "object" &&
    value !== null &&
    typeof candidate.accessToken === "string" &&
    candidate.accessToken.length > 0 &&
    candidate.tokenType === "bearer" &&
    Array.isArray(candidate.scopes) &&
    candidate.scopes.every((scope) => typeof scope === "string") &&
    typeof candidate.obtainedAt === "string" &&
    (candidate.refreshToken === undefined ||
      typeof candidate.refreshToken === "string") &&
    (candidate.expiresAt === undefined ||
      typeof candidate.expiresAt === "string") &&
    (candidate.refreshTokenExpiresAt === undefined ||
      typeof candidate.refreshTokenExpiresAt === "string")
  );
}
