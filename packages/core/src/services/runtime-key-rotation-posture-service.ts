import { AuthorizationError, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";

import type { RomeoRepository } from "../domain/repository";
import type { RuntimeKeyUsageCounts } from "../domain/runtime-key-usage";
import { writeAuditLog } from "./audit-log";
import { WebhookSigningKeyring } from "./webhook-signing-keyring";

export type RuntimeKeyRotationBlockerCode =
  | "active_key_not_configured"
  | "corrupt_records_present"
  | "legacy_unversioned_records_present"
  | "previous_key_invalid"
  | "previous_key_matches_active"
  | "previous_key_usage_present"
  | "unknown_key_version_records_present";

export interface RuntimeKeyRotationBlocker {
  action: string;
  code: RuntimeKeyRotationBlockerCode;
  count: number;
}

export interface RuntimeKeyRotationSurfacePosture {
  configuration: {
    activeKeyConfigured: boolean;
    previousKeyAccepted: boolean;
    previousKeyConfigured: boolean;
  };
  removalStatus: "blocked" | "not_configured" | "safe";
  safeToRemovePrevious: boolean;
  blockers: RuntimeKeyRotationBlocker[];
  usage: RuntimeKeyUsageCounts;
}

export interface RuntimeKeyRotationPostureReport {
  schema: "romeo.runtime-key-rotation-posture.v1";
  generatedAt: string;
  aggregationScope: "all_organizations";
  status: "attention_required" | "ready";
  webhookSigning: RuntimeKeyRotationSurfacePosture;
  redaction: {
    ciphertextReturned: false;
    deliveryIdsReturned: false;
    keyMaterialReturned: false;
    payloadsReturned: false;
    rawSignaturesReturned: false;
    secretValuesReturned: false;
  };
}

export class RuntimeKeyRotationPostureService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly env: RomeoEnv,
  ) {}

  async report(subject: AuthSubject): Promise<RuntimeKeyRotationPostureReport> {
    if (!subject.scopes.includes("admin:read")) {
      throw new AuthorizationError("Missing required scope: admin:read");
    }
    if (subject.adminRole !== "global_admin") {
      throw new AuthorizationError(
        "Global admin role is required to inspect platform runtime key usage.",
      );
    }

    return this.repository.transaction(async (repository) => {
      const webhook = webhookKeyringConfiguration(this.env);
      const webhookUsage = await repository.countWebhookSigningKeyUsage({
        ...(webhook.keyring === undefined
          ? {}
          : { activeVersion: webhook.keyring.activeVersion }),
        ...(webhook.keyring?.previousVersion === undefined
          ? {}
          : { previousVersion: webhook.keyring.previousVersion }),
      });

      const webhookSigning = surfacePosture({
        activeKeyConfigured: webhook.activeKeyConfigured,
        counts: webhookUsage,
        ...(webhook.keyring === undefined
          ? {}
          : {
              keyringPosture:
                webhook.keyring.rotationPostureFromUsage(webhookUsage),
            }),
        ...(webhook.previousFailure === undefined
          ? {}
          : { previousFailure: webhook.previousFailure }),
        previousKeyAccepted: webhook.keyring?.previousVersion !== undefined,
        previousKeyConfigured: webhook.previousKeyConfigured,
      });
      const report: RuntimeKeyRotationPostureReport = {
        schema: "romeo.runtime-key-rotation-posture.v1",
        generatedAt: new Date().toISOString(),
        aggregationScope: "all_organizations",
        status:
          webhookSigning.blockers.length === 0 ? "ready" : "attention_required",
        webhookSigning,
        redaction: {
          ciphertextReturned: false,
          deliveryIdsReturned: false,
          keyMaterialReturned: false,
          payloadsReturned: false,
          rawSignaturesReturned: false,
          secretValuesReturned: false,
        },
      };

      await writeAuditLog(repository, {
        subject,
        action: "admin.key_rotation.posture.read",
        resourceType: "runtime_key_rotation",
        resourceId: "platform",
        metadata: {
          aggregationScope: report.aggregationScope,
          schema: report.schema,
          status: report.status,
          webhookSigning: auditSurface(webhookSigning),
          keyMaterialReturned: false,
          secretValuesReturned: false,
        },
      });
      return report;
    });
  }
}

interface KeyringConfiguration<T> {
  activeKeyConfigured: boolean;
  keyring?: T;
  previousFailure?: "invalid" | "matches_active";
  previousKeyConfigured: boolean;
}

function webhookKeyringConfiguration(
  env: RomeoEnv,
): KeyringConfiguration<WebhookSigningKeyring> {
  const active = env.WEBHOOK_SIGNING_KEY.trim();
  const previous = env.WEBHOOK_SIGNING_KEY_PREVIOUS.trim();
  const activeKeyConfigured = active.length >= 16;
  const previousKeyConfigured = previous.length > 0;
  if (!activeKeyConfigured)
    return { activeKeyConfigured, previousKeyConfigured };
  if (!previousKeyConfigured) {
    return {
      activeKeyConfigured,
      keyring: new WebhookSigningKeyring({ active }),
      previousKeyConfigured,
    };
  }
  if (previous.length < 16) {
    return {
      activeKeyConfigured,
      keyring: new WebhookSigningKeyring({ active }),
      previousFailure: "invalid",
      previousKeyConfigured,
    };
  }
  try {
    return {
      activeKeyConfigured,
      keyring: new WebhookSigningKeyring({ active, previous }),
      previousKeyConfigured,
    };
  } catch {
    return {
      activeKeyConfigured,
      keyring: new WebhookSigningKeyring({ active }),
      previousFailure: "matches_active",
      previousKeyConfigured,
    };
  }
}

function surfacePosture(input: {
  activeKeyConfigured: boolean;
  counts: RuntimeKeyUsageCounts;
  keyringPosture?: { safeToRemovePrevious: boolean };
  previousFailure?: "invalid" | "matches_active";
  previousKeyAccepted: boolean;
  previousKeyConfigured: boolean;
}): RuntimeKeyRotationSurfacePosture {
  const blockers: RuntimeKeyRotationBlocker[] = [];
  if (!input.activeKeyConfigured && input.counts.total > 0) {
    blockers.push({
      code: "active_key_not_configured",
      count: input.counts.total,
      action: "Configure the active runtime key before using stored records.",
    });
  }
  if (input.previousFailure === "invalid") {
    blockers.push({
      code: "previous_key_invalid",
      count: 1,
      action: "Replace the invalid previous key with valid key material.",
    });
  } else if (input.previousFailure === "matches_active") {
    blockers.push({
      code: "previous_key_matches_active",
      count: 1,
      action: "Configure distinct active and previous runtime keys.",
    });
  }
  addUsageBlocker(
    blockers,
    "previous_key_usage_present",
    input.counts.previous,
    "Rewrap or redeliver every record still using the previous key.",
  );
  addUsageBlocker(
    blockers,
    "legacy_unversioned_records_present",
    input.counts.legacyUnversioned,
    "Migrate every legacy unversioned record to the active key version.",
  );
  addUsageBlocker(
    blockers,
    "unknown_key_version_records_present",
    input.counts.unknown,
    "Recover the historical key or quarantine every unknown-version record.",
  );
  addUsageBlocker(
    blockers,
    "corrupt_records_present",
    input.counts.corrupt,
    "Quarantine and repair every structurally corrupt record.",
  );

  const safeToRemovePrevious =
    input.previousKeyAccepted &&
    input.keyringPosture?.safeToRemovePrevious === true &&
    blockers.length === 0;
  return {
    configuration: {
      activeKeyConfigured: input.activeKeyConfigured,
      previousKeyAccepted: input.previousKeyAccepted,
      previousKeyConfigured: input.previousKeyConfigured,
    },
    removalStatus: !input.previousKeyConfigured
      ? "not_configured"
      : safeToRemovePrevious
        ? "safe"
        : "blocked",
    safeToRemovePrevious,
    blockers,
    usage: input.counts,
  };
}

function addUsageBlocker(
  blockers: RuntimeKeyRotationBlocker[],
  code: RuntimeKeyRotationBlockerCode,
  count: number,
  action: string,
): void {
  if (count > 0) blockers.push({ action, code, count });
}

function auditSurface(surface: RuntimeKeyRotationSurfacePosture) {
  return {
    activeKeyConfigured: surface.configuration.activeKeyConfigured,
    previousKeyAccepted: surface.configuration.previousKeyAccepted,
    previousKeyConfigured: surface.configuration.previousKeyConfigured,
    removalStatus: surface.removalStatus,
    safeToRemovePrevious: surface.safeToRemovePrevious,
    blockerCodes: surface.blockers.map((blocker) => blocker.code),
    usage: surface.usage,
  };
}
