import { assertScope, isGlobalAdmin, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";

import type { LocalMfaFactor } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { writeAuditLog } from "./audit-log";
import {
  LocalMfaSecretVault,
  localMfaSecretKeyConfigured,
} from "./local-mfa-secret-vault";
import type {
  ManagedSecretRewrapSummary,
  ManagedSecretService,
} from "./managed-secret-service";

export interface SecretRewrapRequest {
  includeDisabledMfaFactors?: boolean | undefined;
  includeGlobalManagedSecrets?: boolean | undefined;
  targetOrgId?: string | undefined;
}

export interface SecretRewrapExecuteRequest extends SecretRewrapRequest {
  confirmRewrap: "rewrap-secret-envelopes";
}

export interface SecretRewrapReport {
  schema: "romeo.secret-rotation-rewrap.v1";
  generatedAt: string;
  mode: "apply" | "preview";
  orgId: string;
  status: "blocked" | "completed" | "partial" | "ready";
  scope: {
    includeDisabledMfaFactors: boolean;
    includeGlobalManagedSecrets: boolean;
    targetOrgId: string;
  };
  localMfa: LocalMfaRewrapSummary;
  managedSecrets: ManagedSecretRewrapSummary;
  warnings: string[];
  redaction: {
    factorIdsReturned: false;
    keyMaterialReturned: false;
    rawSecretValuesReturned: false;
    secretRefsReturned: false;
    totpSecretsReturned: false;
    userEmailsReturned: false;
  };
}

export interface LocalMfaRewrapSummary {
  activeFactorCount: number;
  currentKeyConfigured: boolean;
  decryptableCount: number;
  disabledFactorCount: number;
  eligibleCount: number;
  failedCount: number;
  failureCodes: string[];
  pendingFactorCount: number;
  previousKeyConfigured: boolean;
  previousKeyDecryptableCount: number;
  rewrappedCount: number;
  totpSecretsReturned: false;
}

interface NormalizedSecretRewrapRequest {
  includeDisabledMfaFactors: boolean;
  includeGlobalManagedSecrets: boolean;
  targetOrgId: string;
}

export class SecretRotationService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly env: RomeoEnv,
    private readonly managedSecrets: ManagedSecretService,
  ) {}

  async preview(input: {
    request?: SecretRewrapRequest | undefined;
    subject: AuthSubject;
  }): Promise<SecretRewrapReport> {
    assertScope(input.subject, "admin:read");
    return this.report({
      apply: false,
      request: input.request ?? {},
      subject: input.subject,
    });
  }

  async execute(input: {
    request: SecretRewrapExecuteRequest;
    subject: AuthSubject;
  }): Promise<SecretRewrapReport> {
    assertScope(input.subject, "admin:write");
    if (input.request.confirmRewrap !== "rewrap-secret-envelopes") {
      throw new ApiError(
        "secret_rewrap_confirmation_required",
        "Secret rewrap requires explicit confirmation.",
        400,
      );
    }
    return this.repository.transaction(async (repository) => {
      const report = await this.report({
        apply: true,
        repository,
        request: input.request,
        subject: input.subject,
      });
      await writeAuditLog(repository, {
        subject: input.subject,
        action: "admin.secret_rotation.rewrap",
        resourceType: "secret_rotation",
        resourceId: report.scope.targetOrgId,
        metadata: {
          schema: report.schema,
          mode: report.mode,
          status: report.status,
          scope: report.scope,
          localMfa: auditSummary(report.localMfa),
          managedSecrets: auditSummary(report.managedSecrets),
          warningCount: report.warnings.length,
          rawSecretValuesReturned: false,
          secretRefsReturned: false,
          keyMaterialReturned: false,
          totpSecretsReturned: false,
        },
      });
      return report;
    });
  }

  private async report(input: {
    apply: boolean;
    repository?: RomeoRepository;
    request: SecretRewrapRequest;
    subject: AuthSubject;
  }): Promise<SecretRewrapReport> {
    const now = new Date().toISOString();
    const request = normalizeRequest(input.subject, input.request);
    const rewrapLocalMfa = () =>
      this.rewrapLocalMfa({
        apply: input.apply,
        includeDisabled: request.includeDisabledMfaFactors,
        now,
        ...(input.repository === undefined
          ? {}
          : { repository: input.repository }),
        targetOrgId: request.targetOrgId,
      });
    const rewrapManagedSecrets = () =>
      this.managedSecrets.rewrapLocalEnvelopes({
        apply: input.apply,
        includeGlobal: request.includeGlobalManagedSecrets,
        now,
        ...(input.repository === undefined
          ? {}
          : { repository: input.repository }),
        targetOrgId: request.targetOrgId,
      });
    const [localMfa, managedSecrets] = input.apply
      ? [await rewrapLocalMfa(), await rewrapManagedSecrets()]
      : await Promise.all([rewrapLocalMfa(), rewrapManagedSecrets()]);
    const warnings = secretRewrapWarnings(localMfa, managedSecrets);
    return {
      schema: "romeo.secret-rotation-rewrap.v1",
      generatedAt: now,
      mode: input.apply ? "apply" : "preview",
      orgId: input.subject.orgId,
      status: secretRewrapStatus(input.apply, localMfa, managedSecrets),
      scope: request,
      localMfa,
      managedSecrets,
      warnings,
      redaction: {
        factorIdsReturned: false,
        keyMaterialReturned: false,
        rawSecretValuesReturned: false,
        secretRefsReturned: false,
        totpSecretsReturned: false,
        userEmailsReturned: false,
      },
    };
  }

  private async rewrapLocalMfa(input: {
    apply: boolean;
    includeDisabled: boolean;
    now: string;
    repository?: RomeoRepository;
    targetOrgId: string;
  }): Promise<LocalMfaRewrapSummary> {
    const repository = input.repository ?? this.repository;
    const factors = await repository.listLocalMfaFactorsForOrg(
      input.targetOrgId,
    );
    const currentVault = localMfaSecretKeyConfigured(
      this.env.LOCAL_AUTH_SECRET_ENCRYPTION_KEY,
    )
      ? new LocalMfaSecretVault(this.env.LOCAL_AUTH_SECRET_ENCRYPTION_KEY)
      : undefined;
    const previousVault = localMfaSecretKeyConfigured(
      this.env.LOCAL_AUTH_SECRET_ENCRYPTION_KEY_PREVIOUS,
    )
      ? new LocalMfaSecretVault(
          this.env.LOCAL_AUTH_SECRET_ENCRYPTION_KEY_PREVIOUS,
        )
      : undefined;
    let decryptableCount = 0;
    let failedCount = 0;
    let previousKeyDecryptableCount = 0;
    let rewrappedCount = 0;
    const failureCodes = new Set<string>();
    const eligibleFactors = factors.filter(
      (factor) => input.includeDisabled || factor.status !== "disabled",
    );

    for (const factor of eligibleFactors) {
      if (currentVault === undefined) {
        failedCount += 1;
        failureCodes.add("local_mfa_current_key_not_configured");
        continue;
      }
      const plaintext = decryptLocalMfaFactor({
        currentVault,
        factor,
        previousVault,
      });
      if (plaintext === undefined) {
        failedCount += 1;
        failureCodes.add("local_mfa_decryption_failed");
        continue;
      }
      decryptableCount += 1;
      if (plaintext.source === "previous") previousKeyDecryptableCount += 1;
      if (!input.apply) continue;

      await repository.updateLocalMfaFactor({
        ...factor,
        secretEncrypted: currentVault.encrypt(plaintext.value),
        updatedAt: input.now,
      });
      rewrappedCount += 1;
    }

    return {
      activeFactorCount: factors.filter((factor) => factor.status === "active")
        .length,
      currentKeyConfigured: currentVault !== undefined,
      decryptableCount,
      disabledFactorCount: factors.filter(
        (factor) => factor.status === "disabled",
      ).length,
      eligibleCount: eligibleFactors.length,
      failedCount,
      failureCodes: [...failureCodes].sort(),
      pendingFactorCount: factors.filter(
        (factor) => factor.status === "pending",
      ).length,
      previousKeyConfigured: previousVault !== undefined,
      previousKeyDecryptableCount,
      rewrappedCount,
      totpSecretsReturned: false,
    };
  }
}

function normalizeRequest(
  subject: AuthSubject,
  request: SecretRewrapRequest,
): NormalizedSecretRewrapRequest {
  const targetOrgId = request.targetOrgId?.trim() || subject.orgId;
  if (targetOrgId !== subject.orgId && !isGlobalAdmin(subject)) {
    throw new ApiError(
      "global_admin_required",
      "Global admin role is required to rewrap another organization's envelopes.",
      403,
    );
  }
  const includeGlobalManagedSecrets =
    request.includeGlobalManagedSecrets === true;
  if (includeGlobalManagedSecrets && !isGlobalAdmin(subject)) {
    throw new ApiError(
      "global_admin_required",
      "Global admin role is required to rewrap global managed-secret envelopes.",
      403,
    );
  }
  return {
    includeDisabledMfaFactors: request.includeDisabledMfaFactors === true,
    includeGlobalManagedSecrets,
    targetOrgId,
  };
}

function decryptLocalMfaFactor(input: {
  currentVault: LocalMfaSecretVault;
  factor: LocalMfaFactor;
  previousVault: LocalMfaSecretVault | undefined;
}): { source: "current" | "previous"; value: string } | undefined {
  try {
    return {
      source: "current",
      value: input.currentVault.decrypt(input.factor.secretEncrypted),
    };
  } catch {
    if (input.previousVault === undefined) return undefined;
  }
  try {
    return {
      source: "previous",
      value: input.previousVault.decrypt(input.factor.secretEncrypted),
    };
  } catch {
    return undefined;
  }
}

function secretRewrapStatus(
  apply: boolean,
  localMfa: LocalMfaRewrapSummary,
  managedSecrets: ManagedSecretRewrapSummary,
): SecretRewrapReport["status"] {
  const failedCount = localMfa.failedCount + managedSecrets.failedCount;
  const eligibleCount = localMfa.eligibleCount + managedSecrets.eligibleCount;
  const rewrappedCount =
    localMfa.rewrappedCount + managedSecrets.rewrappedCount;
  if (failedCount > 0 && (!apply || rewrappedCount === 0)) return "blocked";
  if (failedCount > 0) return "partial";
  if (apply && eligibleCount > 0) return "completed";
  return "ready";
}

function secretRewrapWarnings(
  localMfa: LocalMfaRewrapSummary,
  managedSecrets: ManagedSecretRewrapSummary,
): string[] {
  const warnings: string[] = [];
  if (localMfa.eligibleCount > 0 && !localMfa.currentKeyConfigured) {
    warnings.push("local_mfa_current_key_not_configured");
  }
  if (
    managedSecrets.eligibleCount > 0 &&
    !managedSecrets.currentKeyConfigured
  ) {
    warnings.push("managed_secret_current_key_not_configured");
  }
  if (localMfa.failedCount > 0) warnings.push("local_mfa_rewrap_failures");
  if (managedSecrets.failedCount > 0) {
    warnings.push("managed_secret_rewrap_failures");
  }
  return warnings;
}

function auditSummary(
  summary: LocalMfaRewrapSummary | ManagedSecretRewrapSummary,
): Record<string, boolean | number | string[]> {
  return {
    currentKeyConfigured: summary.currentKeyConfigured,
    decryptableCount: summary.decryptableCount,
    eligibleCount: summary.eligibleCount,
    failedCount: summary.failedCount,
    failureCodes: summary.failureCodes,
    previousKeyConfigured: summary.previousKeyConfigured,
    previousKeyDecryptableCount: summary.previousKeyDecryptableCount,
    rewrappedCount: summary.rewrappedCount,
  };
}
