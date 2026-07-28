import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
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
import {
  decryptManagedSecretWithKeys,
  decryptSecret,
  encryptSecret,
  managedSecretInScope,
  managedSecretKey,
  managedSecretKeyConfigured,
  managedSecretKeyFromValue,
  managedSecretPreviousKeyConfigured,
  managedSecretSchemaVersion,
  managedSecretScheme,
  managedSecretSettingPrefix,
  managedSecretWriteStatus,
  normalizeName,
  normalizeSecretValue,
  normalizeTargetOrgId,
  parseManagedSecretSetting,
  secretIdPattern,
  secretRefForId,
  settingKeyForId,
  type ManagedSecretSetting,
} from "./managed-secret-storage";
import { parseManagedSecretRef } from "./secret-refs";
import { disabledSecretWriter, type SecretWriter } from "./secret-writer";
import type {
  SecretAvailability,
  SecretResolution,
  SecretResolver,
} from "./secret-resolver";

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

export {
  managedSecretKeyConfigured,
  managedSecretPreviousKeyConfigured,
} from "./managed-secret-storage";
