import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import type { DelegatedOAuthTokenEnvelope } from "../domain/delegated-oauth";
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
  private readonly key: Buffer;

  constructor(secret: string) {
    const trimmed = secret.trim();
    if (trimmed.length < 32) {
      throw new ApiError(
        "delegated_oauth_token_key_not_configured",
        "Delegated OAuth token encryption key must be configured before completing OAuth callbacks.",
        409,
      );
    }
    this.key = createHash("sha256")
      .update("romeo delegated oauth token vault v1", "utf8")
      .update(trimmed, "utf8")
      .digest();
  }

  encrypt(
    token: DelegatedOAuthStoredToken,
    context: DelegatedOAuthTokenContext,
  ): DelegatedOAuthTokenEnvelope {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(delegatedOAuthTokenAad(context));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(token), "utf8"),
      cipher.final(),
    ]);
    const envelope: DelegatedOAuthTokenEnvelope = {
      v: 2,
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
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(envelope.iv, "base64url"),
    );
    if (envelope.v === 2) decipher.setAAD(delegatedOAuthTokenAad(context));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
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
