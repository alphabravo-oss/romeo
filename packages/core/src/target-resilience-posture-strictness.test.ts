import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AuthSubject } from "@romeo/auth";
import { readEnv } from "@romeo/config";
import { describe, expect, it } from "vitest";

import { MigrationDrillPostureService } from "./services/migration-drill-posture-service";
import { NetworkPartitionPostureService } from "./services/network-partition-posture-service";
import { ProviderOutagePostureService } from "./services/provider-outage-posture-service";
import { SecretRotationDrillPostureService } from "./services/secret-rotation-drill-posture-service";

const subject: AuthSubject = {
  id: "user_security_admin",
  type: "user",
  orgId: "org_default",
  workspaceIds: ["workspace_default"],
  groupIds: ["group_admins"],
  scopes: ["admin:read"],
  isAdmin: true,
};

describe("target resilience posture strictness", () => {
  it("returns GA-aligned failure codes without echoing evidence failure strings", async () => {
    const directory = mkdtempSync(join(tmpdir(), "romeo-target-posture-"));
    const rawFailure = "RAW_TARGET_RESILIENCE_FAILURE_SENTINEL";
    const cases = [
      {
        name: "provider-outage",
        report: (path: string) =>
          new ProviderOutagePostureService(
            readEnv({ PROVIDER_OUTAGE_EVIDENCE_PATH: path }),
          ).report(subject),
        evidence: providerOutageEvidence({
          checks: providerOutageChecks.slice(0, -1),
          failures: [rawFailure],
        }),
        failureCodes: [
          "provider_outage_missing_check:provider_log_redaction",
          "provider_outage_failure_codes_present",
        ],
        warnings: [
          "provider_outage_required_checks_missing",
          "provider_outage_failure_codes_present",
        ],
      },
      {
        name: "migration-drill",
        report: (path: string) =>
          new MigrationDrillPostureService(
            readEnv({ MIGRATION_DRILL_EVIDENCE_PATH: path }),
          ).report(subject),
        evidence: migrationDrillEvidence({
          failures: [rawFailure],
          validation: {
            ...migrationDrillEvidence().validation,
            schemaValidationPassed: false,
          },
        }),
        failureCodes: [
          "migration_drill_recovery_missing",
          "migration_drill_failure_codes_present",
        ],
        warnings: [
          "migration_drill_recovery_missing",
          "migration_drill_failure_codes_present",
        ],
      },
      {
        name: "network-partition",
        report: (path: string) =>
          new NetworkPartitionPostureService(
            readEnv({ NETWORK_PARTITION_EVIDENCE_PATH: path }),
          ).report(subject),
        evidence: networkPartitionEvidence({
          drill: {
            ...networkPartitionEvidence().drill,
            partitionDurationSeconds: 0,
          },
          failures: [rawFailure],
        }),
        failureCodes: [
          "network_partition_injection_missing",
          "network_partition_failure_codes_present",
        ],
        warnings: [
          "network_partition_injection_missing",
          "network_partition_failure_codes_present",
        ],
      },
      {
        name: "secret-rotation",
        report: (path: string) =>
          new SecretRotationDrillPostureService(
            readEnv({ SECRET_ROTATION_DRILL_EVIDENCE_PATH: path }),
          ).report(subject),
        evidence: secretRotationEvidence({
          dependencies: {
            ...secretRotationEvidence().dependencies,
            providerCredentialCount: 0,
          },
          failures: [rawFailure],
        }),
        failureCodes: [
          "secret_rotation_drill_dependency_review_missing",
          "secret_rotation_drill_failure_codes_present",
        ],
        warnings: [
          "secret_rotation_dependency_review_missing",
          "secret_rotation_drill_failure_codes_present",
        ],
      },
    ] as const;

    for (const testCase of cases) {
      const evidencePath = join(directory, `${testCase.name}.json`);
      writeFileSync(evidencePath, JSON.stringify(testCase.evidence), "utf8");
      const report = await testCase.report(evidencePath);
      const serialized = JSON.stringify(report);

      expect(report.status).toBe("attention_required");
      expect(report.evidence.status).toBe("failed");
      for (const code of testCase.failureCodes) {
        expect(report.evidence.failureCodes).toContain(code);
      }
      for (const warning of testCase.warnings) {
        expect(report.warnings).toContain(warning);
      }
      expect(serialized).not.toContain(rawFailure);
      expect(serialized).not.toContain(evidencePath);
      expect(serialized).not.toContain(directory);
    }
  });
});

const providerOutageChecks = [
  "provider_outage_injected",
  "provider_timeout_observed",
  "provider_circuit_open",
  "fallback_routing_verified",
  "kill_switch_verified",
  "operational_summary_readback",
  "provider_alerting_readback",
  "provider_recovery_verified",
  "provider_log_redaction",
];

function providerOutageEvidence(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "romeo.provider-outage-evidence.v1",
    status: "passed",
    mode: "live",
    deployment: "kubernetes",
    checks: providerOutageChecks,
    drill: {
      providerCount: 2,
      outageInjectedCount: 1,
      timeoutObservedCount: 1,
    },
    runtime: {
      circuitOpenCount: 1,
      fallbackRoutedCount: 1,
      killSwitchVerifiedCount: 1,
    },
    operationalSummary: {
      checked: true,
      degradedProviderCount: 1,
      circuitOpenProviderCount: 1,
      fallbackAvailable: true,
      killSwitchActiveCount: 1,
      alertCodeCount: 1,
    },
    alerting: {
      checked: true,
      status: "passed",
      providerAlertCount: 1,
      firingRequiredCount: 1,
    },
    recovery: { checked: true, recoveredProviderCount: 1 },
    redaction: {
      rawProviderPayloadsReturned: false,
      rawProviderResponsesReturned: false,
      rawProviderErrorsReturned: false,
      rawPromptsReturned: false,
      rawApiKeysReturned: false,
      rawAlertPayloadsReturned: false,
      rawEvidencePathsReturned: false,
      secretValuesReturned: false,
    },
    ...overrides,
  };
}

function migrationDrillEvidence(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "romeo.migration-drill-evidence.v1",
    status: "passed",
    mode: "live",
    deployment: "kubernetes",
    checks: [
      "failed_migration_injected",
      "migration_failure_detected",
      "migration_job_failed_closed",
      "app_cutover_blocked",
      "rollback_or_retry_verified",
      "schema_validation_after_recovery",
      "migration_log_redaction",
      "operator_runbook_reviewed",
    ],
    drill: {
      attemptedMigrationCount: 1,
      failedMigrationCount: 1,
      failureInjected: true,
      cutoverBlocked: true,
    },
    job: {
      migrationJobObserved: true,
      failedClosed: true,
      retryAttemptCount: 1,
      rollbackAttemptCount: 0,
    },
    validation: {
      rollbackOrRetryVerified: true,
      schemaValidationPassed: true,
      appReadinessPassed: true,
      postRecoveryMigrationCount: 1,
    },
    runbook: { reviewed: true, recoveryDocumented: true, reviewerCount: 1 },
    redaction: {
      databaseUrlsReturned: false,
      migrationSqlReturned: false,
      migrationLogsReturned: false,
      rawErrorStacksReturned: false,
      rawEvidencePathsReturned: false,
      secretValuesReturned: false,
    },
    ...overrides,
  };
}

function networkPartitionEvidence(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "romeo.network-partition-evidence.v1",
    status: "passed",
    mode: "live",
    deployment: "kubernetes",
    checks: [
      "network_partition_injected",
      "dependency_partition_verified",
      "api_fail_closed_or_degraded",
      "worker_backpressure_verified",
      "recovery_after_partition_verified",
      "alerting_readback",
      "network_policy_or_cni_context_recorded",
      "partition_log_redaction",
    ],
    drill: {
      partitionInjected: true,
      partitionedDependencyCount: 1,
      partitionedServiceCount: 1,
      partitionDurationSeconds: 60,
    },
    runtime: {
      apiDegraded: true,
      failClosedCount: 1,
      backpressureObserved: true,
      workerStormPrevented: true,
    },
    recovery: {
      checked: true,
      recoveredDependencyCount: 1,
      postRecoveryReadbackPassed: true,
    },
    alerting: {
      checked: true,
      status: "passed",
      partitionAlertCount: 1,
      firingRequiredCount: 1,
    },
    networkContext: {
      cniConfirmed: true,
      networkPolicyApplied: true,
      namespaceScoped: true,
      egressPolicyCount: 1,
    },
    redaction: {
      rawNetworkEndpointsReturned: false,
      rawPodIpsReturned: false,
      rawPacketCapturesReturned: false,
      rawLogLinesReturned: false,
      rawEvidencePathsReturned: false,
      secretValuesReturned: false,
    },
    ...overrides,
  };
}

function secretRotationEvidence(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "romeo.secret-rotation-drill-evidence.v1",
    status: "passed",
    mode: "live",
    deployment: "kubernetes",
    checks: [
      "session_secret_staged_dual_read",
      "webhook_signing_key_cutover",
      "local_mfa_envelope_rewrap_verified",
      "managed_secret_envelope_rewrap_verified",
      "old_secret_rejected_or_retired",
      "new_secret_accepted",
      "post_rotation_readiness_verified",
      "dependency_credentials_reviewed",
      "secret_rotation_alerting_readback",
      "secret_rotation_log_redaction",
    ],
    stagedCutover: {
      sessionSecretStaged: true,
      webhookSigningKeyCutover: true,
      apiOrServiceKeyContinuityVerified: true,
    },
    rewrap: {
      localMfaPreviewPassed: true,
      localMfaRewrappedCount: 1,
      managedSecretsPreviewPassed: true,
      managedSecretsRewrappedCount: 1,
      failureCount: 0,
    },
    acceptance: {
      oldSecretRetiredOrRejectedCount: 1,
      newSecretAcceptedCount: 1,
    },
    dependencies: {
      databaseCredentialsReviewed: true,
      objectStoreCredentialsReviewed: true,
      providerCredentialCount: 1,
      connectorCredentialCount: 1,
    },
    readiness: {
      checked: true,
      readinessPassed: true,
      postRotationLoginPassed: true,
      postRotationWebhookPassed: true,
    },
    alerting: {
      checked: true,
      status: "passed",
      rotationAlertCount: 1,
      firingRequiredCount: 1,
    },
    redaction: {
      keyMaterialReturned: false,
      rawApiKeysReturned: false,
      rawEvidencePathsReturned: false,
      rawLogLinesReturned: false,
      rawSecretRefsReturned: false,
      rawSecretValuesReturned: false,
      rawTokensReturned: false,
      webhookSigningSecretsReturned: false,
    },
    ...overrides,
  };
}
