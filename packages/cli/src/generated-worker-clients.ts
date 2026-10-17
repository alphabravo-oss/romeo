import {
  billingEnforceLifecycle,
  billingReconcileEntitlements,
  governanceEnforceRetention,
  voicesSyncCatalog,
} from "@romeo/api-client/generated/sdk";

import type {
  BillingEntitlementReconciliationWorkerClient,
  BillingLifecycleEnforcementWorkerClient,
} from "./billing-worker";
import type { CommandContext } from "./commands";
import type {
  RetentionEnforcementWorkerClient,
  RetentionEnforcementWorkerResult,
} from "./retention-worker";
import type { VoiceCatalogSyncWorkerClient } from "./voice-worker";

export function retentionWorkerClient(
  context: CommandContext,
): RetentionEnforcementWorkerClient {
  const client = context.generatedClient;
  return {
    governance: {
      enforceRetention: () =>
        governanceEnforceRetention({ client, throwOnError: true })
          .then(dataEnvelope)
          .then(normalizeRetentionResult),
    },
  };
}

export function billingEntitlementWorkerClient(
  context: CommandContext,
): BillingEntitlementReconciliationWorkerClient {
  const client = context.generatedClient;
  return {
    admin: {
      reconcileBillingEntitlements: () =>
        billingReconcileEntitlements({ client, throwOnError: true }).then(
          dataEnvelope,
        ),
    },
  };
}

export function billingLifecycleWorkerClient(
  context: CommandContext,
): BillingLifecycleEnforcementWorkerClient {
  const client = context.generatedClient;
  return {
    admin: {
      enforceBillingLifecycle: () =>
        billingEnforceLifecycle({ client, throwOnError: true }).then(
          dataEnvelope,
        ),
    },
  };
}

export function voiceWorkerClient(
  context: CommandContext,
): VoiceCatalogSyncWorkerClient {
  const client = context.generatedClient;
  return {
    voice: {
      sync: () =>
        voicesSyncCatalog({ client, throwOnError: true }).then(dataEnvelope),
    },
  };
}

function normalizeRetentionResult(input: {
  deletedAuditLogCount: number;
  deletedBrowserAutomationArtifactCount?: number | undefined;
}): RetentionEnforcementWorkerResult {
  return {
    ...input,
    deletedBrowserAutomationArtifactCount:
      input.deletedBrowserAutomationArtifactCount,
  };
}

function dataEnvelope<T>(response: { data: { data: T } }): T {
  return response.data.data;
}
