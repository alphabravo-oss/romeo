import type { AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import type {
  ManagedSecretPurpose,
  ManagedSecretScope,
} from "../domain/managed-secrets";
import { ApiError } from "../errors";

export const managedSecretSettingPrefix = "managed_secret.v1:";
export const managedSecretScheme = "romeo-secret";
export const managedSecretSchemaVersion = "romeo.managed-secret.v1";
export const maxManagedSecretBytes = 20_000;
export const secretIdPattern = /^secret_[A-Za-z0-9_-]+$/u;

export interface ManagedSecretSetting {
  createdAt: string;
  createdBy: string;
  envelope: ManagedSecretEnvelope;
  name?: string;
  orgId?: string;
  purpose: ManagedSecretPurpose;
  schemaVersion: typeof managedSecretSchemaVersion;
  scope: ManagedSecretScope;
  secretId: string;
}

export interface ManagedSecretEnvelope {
  alg: "A256GCM";
  ciphertext: string;
  createdAt: string;
  iv: string;
  tag: string;
  v: 1;
}

export function managedSecretKeyConfigured(env: RomeoEnv): boolean {
  return managedSecretKeyValueConfigured(env.MANAGED_SECRET_ENCRYPTION_KEY);
}

export function managedSecretPreviousKeyConfigured(env: RomeoEnv): boolean {
  return managedSecretKeyValueConfigured(
    env.MANAGED_SECRET_ENCRYPTION_KEY_PREVIOUS,
  );
}

export function managedSecretKeyValueConfigured(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.length >= 32 &&
    !trimmed.startsWith("dev-") &&
    !trimmed.includes("change-me")
  );
}

export function normalizeTargetOrgId(
  subject: AuthSubject,
  scope: ManagedSecretScope,
  orgId: string | undefined,
): string | undefined {
  const normalizedOrgId = orgId?.trim();
  if (normalizedOrgId !== undefined && normalizedOrgId.length === 0) {
    throw new ApiError(
      "invalid_managed_secret",
      "Organization ID cannot be empty.",
      400,
    );
  }
  if (scope === "global") {
    assertGlobalAdmin(subject);
    return undefined;
  }
  const targetOrgId = normalizedOrgId ?? subject.orgId;
  if (targetOrgId !== subject.orgId) assertGlobalAdmin(subject);
  return targetOrgId;
}

export function normalizeName(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized.length === 0) return undefined;
  if (normalized.length > 120) {
    throw new ApiError(
      "invalid_managed_secret",
      "Managed secret names must be at most 120 characters.",
      400,
    );
  }
  return normalized;
}

export function normalizeSecretValue(value: string): string {
  if (value.trim().length === 0) {
    throw new ApiError(
      "invalid_managed_secret",
      "Managed secret value cannot be empty.",
      400,
    );
  }
  if (Buffer.byteLength(value, "utf8") > maxManagedSecretBytes) {
    throw new ApiError(
      "invalid_managed_secret",
      "Managed secret value is too large.",
      400,
      { maxBytes: maxManagedSecretBytes },
    );
  }
  return value;
}

export function managedSecretKey(env: RomeoEnv): Buffer {
  if (!managedSecretKeyConfigured(env)) {
    throw new ApiError(
      "managed_secret_key_not_configured",
      "Managed secret encryption key must be configured before storing secrets.",
      409,
    );
  }
  return createHash("sha256")
    .update("romeo managed secret vault v1", "utf8")
    .update(env.MANAGED_SECRET_ENCRYPTION_KEY.trim(), "utf8")
    .digest();
}

export function managedSecretKeyFromValue(value: string): Buffer {
  return createHash("sha256")
    .update("romeo managed secret vault v1", "utf8")
    .update(value.trim(), "utf8")
    .digest();
}

export function encryptSecret(input: {
  key: Buffer;
  plaintext: string;
  settingKey: string;
}): ManagedSecretEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", input.key, iv);
  cipher.setAAD(managedSecretAad(input.settingKey));
  const ciphertext = Buffer.concat([
    cipher.update(input.plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    alg: "A256GCM",
    ciphertext: ciphertext.toString("base64url"),
    createdAt: new Date().toISOString(),
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    v: 1,
  };
}

export function decryptSecret(input: {
  key: Buffer;
  settingKey: string;
  envelope: ManagedSecretEnvelope;
}): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    input.key,
    Buffer.from(input.envelope.iv, "base64url"),
  );
  decipher.setAAD(managedSecretAad(input.settingKey));
  decipher.setAuthTag(Buffer.from(input.envelope.tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(input.envelope.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function decryptManagedSecretWithKeys(input: {
  currentKey: Buffer;
  envelope: ManagedSecretEnvelope;
  previousKey: Buffer | undefined;
  settingKey: string;
}): { source: "current" | "previous"; value: string } | undefined {
  try {
    return {
      source: "current",
      value: decryptSecret({
        key: input.currentKey,
        settingKey: input.settingKey,
        envelope: input.envelope,
      }),
    };
  } catch {
    if (input.previousKey === undefined) return undefined;
  }
  try {
    return {
      source: "previous",
      value: decryptSecret({
        key: input.previousKey,
        settingKey: input.settingKey,
        envelope: input.envelope,
      }),
    };
  } catch {
    return undefined;
  }
}

export function managedSecretInScope(
  stored: ManagedSecretSetting,
  input: { includeGlobal: boolean; targetOrgId: string },
): boolean {
  if (stored.scope === "global") return input.includeGlobal;
  return stored.orgId === input.targetOrgId;
}

export function parseManagedSecretSetting(
  value: Record<string, unknown>,
): ManagedSecretSetting | undefined {
  if (
    value.schemaVersion !== managedSecretSchemaVersion ||
    typeof value.secretId !== "string" ||
    !secretIdPattern.test(value.secretId) ||
    (value.scope !== "global" && value.scope !== "org") ||
    !isManagedSecretPurpose(value.purpose) ||
    typeof value.createdAt !== "string" ||
    typeof value.createdBy !== "string"
  ) {
    return undefined;
  }
  const envelope = parseEnvelope(value.envelope);
  if (envelope === undefined) return undefined;
  return {
    createdAt: value.createdAt,
    createdBy: value.createdBy,
    envelope,
    ...(typeof value.name === "string" ? { name: value.name } : {}),
    ...(typeof value.orgId === "string" ? { orgId: value.orgId } : {}),
    purpose: value.purpose,
    schemaVersion: managedSecretSchemaVersion,
    scope: value.scope,
    secretId: value.secretId,
  };
}

export function parseEnvelope(
  value: unknown,
): ManagedSecretEnvelope | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    record.v !== 1 ||
    record.alg !== "A256GCM" ||
    typeof record.iv !== "string" ||
    typeof record.ciphertext !== "string" ||
    typeof record.tag !== "string" ||
    typeof record.createdAt !== "string"
  ) {
    return undefined;
  }
  return {
    alg: "A256GCM",
    ciphertext: record.ciphertext,
    createdAt: record.createdAt,
    iv: record.iv,
    tag: record.tag,
    v: 1,
  };
}

export function isManagedSecretPurpose(
  value: unknown,
): value is ManagedSecretPurpose {
  return (
    value === "auth_provider_client_secret" ||
    value === "data_connector_credential" ||
    value === "model_provider_credential" ||
    value === "tool_connector_credential"
  );
}

export function managedSecretWriteStatus(
  failureCode: string | undefined,
): 400 | 403 | 409 | 502 {
  if (failureCode === "invalid_secret_ref") return 400;
  if (
    failureCode === "secret_writer_disabled" ||
    failureCode === "secret_writer_misconfigured"
  ) {
    return 409;
  }
  if (failureCode === "secret_access_denied") return 403;
  return 502;
}

export function assertGlobalAdmin(subject: AuthSubject): void {
  if (subject.adminRole === "global_admin") return;
  throw new ApiError(
    "global_admin_required",
    "Global admin role is required for this operation.",
    403,
  );
}

export function secretRefForId(secretId: string): string {
  return `${managedSecretScheme}://${secretId}`;
}

export function settingKeyForId(secretId: string): string {
  return `${managedSecretSettingPrefix}${secretId}`;
}

export function managedSecretAad(settingKey: string): Buffer {
  return Buffer.from(settingKey, "utf8");
}
