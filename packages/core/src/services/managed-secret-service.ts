import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import type {
  CreateManagedSecretRequest,
  ManagedSecretPurpose,
  ManagedSecretReference,
  ManagedSecretScope,
} from "../domain/managed-secrets";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import { writeAuditLog } from "./audit-log";
import { parseManagedSecretRef } from "./secret-refs";
import { disabledSecretWriter, type SecretWriter } from "./secret-writer";
import type {
  SecretAvailability,
  SecretResolution,
  SecretResolver,
} from "./secret-resolver";

const managedSecretSettingPrefix = "managed_secret.v1:";
const managedSecretScheme = "romeo-secret";
const managedSecretSchemaVersion = "romeo.managed-secret.v1";
const maxManagedSecretBytes = 20_000;
const secretIdPattern = /^secret_[A-Za-z0-9_-]+$/u;

interface ManagedSecretSetting {
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

interface ManagedSecretEnvelope {
  alg: "A256GCM";
  ciphertext: string;
  createdAt: string;
  iv: string;
  tag: string;
  v: 1;
}

export interface ManagedSecretRewrapSummary {
  currentKeyConfigured: boolean;
  decryptableCount: number;
  eligibleCount: number;
  failedCount: number;
  failureCodes: string[];
  globalSecretCount: number;
  orgSecretCount: number;
  previousKeyConfigured: boolean;
  previousKeyDecryptableCount: number;
  rewrappedCount: number;
  secretValuesReturned: false;
  secretRefsReturned: false;
}

export class ManagedSecretService implements SecretResolver {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly env: RomeoEnv,
    private readonly secretWriter: SecretWriter = disabledSecretWriter,
  ) {}

  async create(input: {
    request: CreateManagedSecretRequest;
    subject: AuthSubject;
  }): Promise<ManagedSecretReference> {
    assertScope(input.subject, "admin:write");
    const scope = input.request.scope ?? "org";
    const orgId = normalizeTargetOrgId(
      input.subject,
      scope,
      input.request.orgId,
    );
    const purpose = input.request.purpose;
    const name = normalizeName(input.request.name);
    const value = normalizeSecretValue(input.request.value);
    const storageDriver = input.request.storageDriver ?? "local";
    const secretId = createId("secret");
    const now = new Date().toISOString();
    const secretRef =
      storageDriver === "local"
        ? await this.repository.transaction((repository) =>
            this.createLocalSecret(
              repository,
              {
                createdAt: now,
                createdBy: input.subject.id,
                name,
                orgId,
                purpose,
                scope,
                secretId,
                value,
                targetSecretRef: input.request.targetSecretRef,
              },
              input.subject,
              storageDriver,
            ),
          )
        : await this.createExternalSecret({
            purpose,
            secretId,
            targetSecretRef: input.request.targetSecretRef,
            value,
          });
    const secretRefScheme = parseManagedSecretRef(secretRef).scheme;
    if (storageDriver !== "local") {
      await this.auditCreate(this.repository, {
        name,
        orgId,
        purpose,
        scope,
        secretId,
        secretRefScheme,
        storageDriver,
        subject: input.subject,
        targetSecretRef: input.request.targetSecretRef,
      });
    }

    return {
      createdAt: now,
      nameConfigured: name !== undefined,
      ...(orgId === undefined ? {} : { orgId }),
      purpose,
      scope,
      secretRef,
      secretRefScheme:
        secretRefScheme === "vault" ? "vault" : managedSecretScheme,
      storageDriver,
      valueStored: true,
    };
  }

  async check(secretRef: string): Promise<SecretAvailability> {
    const parsed = parseManagedSecretRef(secretRef);
    if (parsed.scheme !== managedSecretScheme) {
      return {
        available: false,
        failureCode: "secret_scheme_unsupported",
        scheme: parsed.scheme,
      };
    }
    const result = await this.resolveValue(secretRef);
    return result.available
      ? { available: true, scheme: managedSecretScheme }
      : {
          available: false,
          ...(result.failureCode === undefined
            ? {}
            : { failureCode: result.failureCode }),
          scheme: managedSecretScheme,
        };
  }

  async resolveValue(secretRef: string): Promise<SecretResolution> {
    const parsed = parseManagedSecretRef(secretRef);
    if (parsed.scheme !== managedSecretScheme) {
      return {
        available: false,
        failureCode: "secret_scheme_unsupported",
        scheme: parsed.scheme,
      };
    }
    if (!managedSecretKeyConfigured(this.env)) {
      return {
        available: false,
        failureCode: "managed_secret_key_not_configured",
        scheme: managedSecretScheme,
      };
    }
    const secretId = parsed.path;
    if (!secretIdPattern.test(secretId)) {
      return {
        available: false,
        failureCode: "invalid_secret_ref",
        scheme: managedSecretScheme,
      };
    }
    const setting = await this.repository.getSystemSetting(
      settingKeyForId(secretId),
    );
    if (setting === undefined) {
      return {
        available: false,
        failureCode: "secret_not_found",
        scheme: managedSecretScheme,
      };
    }
    const stored = parseManagedSecretSetting(setting.value);
    if (stored === undefined || stored.secretId !== secretId) {
      return {
        available: false,
        failureCode: "managed_secret_invalid",
        scheme: managedSecretScheme,
      };
    }
    try {
      const value = decryptSecret({
        key: managedSecretKey(this.env),
        settingKey: setting.key,
        envelope: stored.envelope,
      });
      return value.length === 0
        ? {
            available: false,
            failureCode: "secret_empty",
            scheme: managedSecretScheme,
          }
        : { available: true, scheme: managedSecretScheme, value };
    } catch {
      return {
        available: false,
        failureCode: "managed_secret_decryption_failed",
        scheme: managedSecretScheme,
      };
    }
  }

  async rewrapLocalEnvelopes(input: {
    apply: boolean;
    includeGlobal: boolean;
    now: string;
    repository?: RomeoRepository;
    targetOrgId: string;
  }): Promise<ManagedSecretRewrapSummary> {
    const repository = input.repository ?? this.repository;
    const settings = await repository.listSystemSettings();
    const currentKey = managedSecretKeyConfigured(this.env)
      ? managedSecretKey(this.env)
      : undefined;
    const previousKey = managedSecretPreviousKeyConfigured(this.env)
      ? managedSecretKeyFromValue(
          this.env.MANAGED_SECRET_ENCRYPTION_KEY_PREVIOUS,
        )
      : undefined;
    let decryptableCount = 0;
    let eligibleCount = 0;
    let failedCount = 0;
    let globalSecretCount = 0;
    let orgSecretCount = 0;
    let previousKeyDecryptableCount = 0;
    let rewrappedCount = 0;
    const failureCodes = new Set<string>();

    for (const setting of settings) {
      if (!setting.key.startsWith(managedSecretSettingPrefix)) continue;
      const stored = parseManagedSecretSetting(setting.value);
      if (stored === undefined) {
        failureCodes.add("managed_secret_invalid");
        failedCount += 1;
        continue;
      }
      if (!managedSecretInScope(stored, input)) continue;
      eligibleCount += 1;
      if (stored.scope === "global") globalSecretCount += 1;
      else orgSecretCount += 1;

      if (currentKey === undefined) {
        failureCodes.add("managed_secret_current_key_not_configured");
        failedCount += 1;
        continue;
      }

      const plaintext = decryptManagedSecretWithKeys({
        currentKey,
        envelope: stored.envelope,
        previousKey,
        settingKey: setting.key,
      });
      if (plaintext === undefined) {
        failureCodes.add("managed_secret_decryption_failed");
        failedCount += 1;
        continue;
      }
      decryptableCount += 1;
      if (plaintext.source === "previous") previousKeyDecryptableCount += 1;
      if (!input.apply) continue;

      await repository.upsertSystemSetting({
        key: setting.key,
        updatedAt: input.now,
        value: {
          ...stored,
          envelope: encryptSecret({
            key: currentKey,
            plaintext: plaintext.value,
            settingKey: setting.key,
          }),
        } satisfies ManagedSecretSetting,
      });
      rewrappedCount += 1;
    }

    return {
      currentKeyConfigured: currentKey !== undefined,
      decryptableCount,
      eligibleCount,
      failedCount,
      failureCodes: [...failureCodes].sort(),
      globalSecretCount,
      orgSecretCount,
      previousKeyConfigured: previousKey !== undefined,
      previousKeyDecryptableCount,
      rewrappedCount,
      secretRefsReturned: false,
      secretValuesReturned: false,
    };
  }

  private async createLocalSecret(
    repository: RomeoRepository,
    input: {
      createdAt: string;
      createdBy: string;
      name: string | undefined;
      orgId: string | undefined;
      purpose: ManagedSecretPurpose;
      scope: ManagedSecretScope;
      secretId: string;
      targetSecretRef: string | undefined;
      value: string;
    },
    subject: AuthSubject,
    storageDriver: "local",
  ): Promise<string> {
    if (input.targetSecretRef !== undefined) {
      throw new ApiError(
        "invalid_managed_secret",
        "targetSecretRef is only supported for external secret storage.",
        400,
      );
    }
    const settingKey = settingKeyForId(input.secretId);
    const encrypted = encryptSecret({
      key: managedSecretKey(this.env),
      plaintext: input.value,
      settingKey,
    });
    await repository.upsertSystemSetting({
      key: settingKey,
      value: {
        createdAt: input.createdAt,
        createdBy: input.createdBy,
        envelope: encrypted,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.orgId === undefined ? {} : { orgId: input.orgId }),
        purpose: input.purpose,
        schemaVersion: managedSecretSchemaVersion,
        scope: input.scope,
        secretId: input.secretId,
      } satisfies ManagedSecretSetting,
      updatedAt: input.createdAt,
    });
    const secretRef = secretRefForId(input.secretId);
    await this.auditCreate(repository, {
      name: input.name,
      orgId: input.orgId,
      purpose: input.purpose,
      scope: input.scope,
      secretId: input.secretId,
      secretRefScheme: parseManagedSecretRef(secretRef).scheme,
      storageDriver,
      subject,
      targetSecretRef: input.targetSecretRef,
    });
    return secretRef;
  }

  private async createExternalSecret(input: {
    purpose: ManagedSecretPurpose;
    secretId: string;
    targetSecretRef: string | undefined;
    value: string;
  }): Promise<string> {
    const secretRef =
      input.targetSecretRef ??
      `vault://romeo/managed/${input.purpose}/${input.secretId}`;
    const parsed = parseManagedSecretRef(secretRef);
    if (parsed.scheme !== "vault") {
      throw new ApiError(
        "invalid_managed_secret",
        "Only vault:// targetSecretRef values are supported for external secret storage.",
        400,
      );
    }
    const write = await this.secretWriter.write({
      secretRef,
      value: input.value,
    });
    if (write.stored) return secretRef;
    throw new ApiError(
      "managed_secret_external_write_failed",
      "External secret storage failed.",
      managedSecretWriteStatus(write.failureCode),
      {
        failureCode: write.failureCode ?? "secret_writer_error",
        secretRefScheme: write.scheme,
      },
    );
  }

  private async auditCreate(
    repository: RomeoRepository,
    input: {
      name: string | undefined;
      orgId: string | undefined;
      purpose: ManagedSecretPurpose;
      scope: ManagedSecretScope;
      secretId: string;
      secretRefScheme: string;
      storageDriver: "local" | "vault";
      subject: AuthSubject;
      targetSecretRef: string | undefined;
    },
  ): Promise<void> {
    await writeAuditLog(repository, {
      subject: input.subject,
      action: "admin.managed_secret.create",
      resourceType: "managed_secret",
      resourceId: input.secretId,
      metadata: {
        nameConfigured: input.name !== undefined,
        ...(input.orgId === undefined ? {} : { orgId: input.orgId }),
        purpose: input.purpose,
        scope: input.scope,
        secretRefScheme: input.secretRefScheme,
        storageDriver: input.storageDriver,
        targetRefProvided: input.targetSecretRef !== undefined,
      },
    });
  }
}

export function managedSecretKeyConfigured(env: RomeoEnv): boolean {
  return managedSecretKeyValueConfigured(env.MANAGED_SECRET_ENCRYPTION_KEY);
}

export function managedSecretPreviousKeyConfigured(env: RomeoEnv): boolean {
  return managedSecretKeyValueConfigured(
    env.MANAGED_SECRET_ENCRYPTION_KEY_PREVIOUS,
  );
}

function managedSecretKeyValueConfigured(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.length >= 32 &&
    !trimmed.startsWith("dev-") &&
    !trimmed.includes("change-me")
  );
}

function normalizeTargetOrgId(
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

function normalizeName(value: string | undefined): string | undefined {
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

function normalizeSecretValue(value: string): string {
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

function managedSecretKey(env: RomeoEnv): Buffer {
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

function managedSecretKeyFromValue(value: string): Buffer {
  return createHash("sha256")
    .update("romeo managed secret vault v1", "utf8")
    .update(value.trim(), "utf8")
    .digest();
}

function encryptSecret(input: {
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

function decryptSecret(input: {
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

function decryptManagedSecretWithKeys(input: {
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

function managedSecretInScope(
  stored: ManagedSecretSetting,
  input: { includeGlobal: boolean; targetOrgId: string },
): boolean {
  if (stored.scope === "global") return input.includeGlobal;
  return stored.orgId === input.targetOrgId;
}

function parseManagedSecretSetting(
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

function parseEnvelope(value: unknown): ManagedSecretEnvelope | undefined {
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

function isManagedSecretPurpose(value: unknown): value is ManagedSecretPurpose {
  return (
    value === "auth_provider_client_secret" ||
    value === "data_connector_credential" ||
    value === "model_provider_credential" ||
    value === "tool_connector_credential"
  );
}

function managedSecretWriteStatus(
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

function assertGlobalAdmin(subject: AuthSubject): void {
  if (subject.adminRole === "global_admin") return;
  throw new ApiError(
    "global_admin_required",
    "Global admin role is required for this operation.",
    403,
  );
}

function secretRefForId(secretId: string): string {
  return `${managedSecretScheme}://${secretId}`;
}

function settingKeyForId(secretId: string): string {
  return `${managedSecretSettingPrefix}${secretId}`;
}

function managedSecretAad(settingKey: string): Buffer {
  return Buffer.from(settingKey, "utf8");
}
