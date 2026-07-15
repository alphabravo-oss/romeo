import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(
  process.cwd(),
  argValue("--output") ?? "dist/ci/ga-evidence-contract-smoke.json",
);
const tempRoot = mkdtempSync(join(tmpdir(), "romeo-ga-evidence-contract-"));

try {
  const checks = [];
  runCase(checks, "valid synthetic GA evidence satisfies checklist", {
    assert: (checklist) => {
      if (checklist.status !== "passed") {
        throw new Error(
          `Expected synthetic evidence to pass, got ${checklist.status}.`,
        );
      }
    },
  });
  runCase(
    checks,
    "valid synthetic GA evidence satisfies full-product enterprise checklist",
    {
      checklistArgs: ["--profile", "full-product-enterprise"],
      mutate: (evidence) => {
        Object.assign(evidence, fullProductEnterpriseEvidence());
      },
      assert: (checklist) => {
        if (checklist.status !== "passed") {
          throw new Error(
            `Expected full-product enterprise evidence to pass, got ${checklist.status}.`,
          );
        }
        if (checklist.target?.profile !== "full-product-enterprise") {
          throw new Error("Full-product enterprise profile was not recorded.");
        }
        if (checklist.target?.fullProductEnterpriseRequired !== true) {
          throw new Error("Full-product enterprise flag was not recorded.");
        }
        const missingFlags = fullProductEnterpriseTargetFlags().filter(
          (flag) => checklist.target?.[flag] !== true,
        );
        if (missingFlags.length > 0) {
          throw new Error(
            `Full-product enterprise target flags were not enabled: ${missingFlags.join(
              ", ",
            )}.`,
          );
        }
        const gateIds = new Set(checklist.gates.map((gate) => gate.id));
        const missingGates = fullProductEnterpriseGateIds().filter(
          (id) => !gateIds.has(id),
        );
        if (missingGates.length > 0) {
          throw new Error(
            `Full-product enterprise gates were missing: ${missingGates.join(
              ", ",
            )}.`,
          );
        }
      },
    },
  );
  runExceptionRedactionCase(checks);
  runCase(
    checks,
    "valid synthetic GA evidence satisfies Qdrant DR required checklist",
    {
      checklistArgs: ["--require-qdrant-dr"],
      assert: (checklist) => {
        if (checklist.status !== "passed") {
          throw new Error(
            `Expected Qdrant DR required evidence to pass, got ${checklist.status}.`,
          );
        }
      },
    },
  );
  runCase(
    checks,
    "valid synthetic GA evidence satisfies Qdrant live required checklist",
    {
      checklistArgs: ["--require-qdrant-live"],
      assert: (checklist) => {
        if (checklist.status !== "passed") {
          throw new Error(
            `Expected Qdrant live required evidence to pass, got ${checklist.status}.`,
          );
        }
      },
    },
  );
  runCase(
    checks,
    "valid synthetic GA evidence satisfies target-quality vector comparison required checklist",
    {
      checklistArgs: ["--require-target-quality-vector-comparison"],
      assert: (checklist) => {
        if (checklist.status !== "passed") {
          throw new Error(
            `Expected target-quality vector comparison required evidence to pass, got ${checklist.status}.`,
          );
        }
      },
    },
  );
  runCase(
    checks,
    "valid synthetic GA evidence satisfies KEDA required checklist",
    {
      checklistArgs: ["--require-keda"],
      assert: (checklist) => {
        if (checklist.status !== "passed") {
          throw new Error(
            `Expected KEDA required evidence to pass, got ${checklist.status}.`,
          );
        }
      },
    },
  );
  runCase(
    checks,
    "valid synthetic GA evidence satisfies data connector live required checklist",
    {
      checklistArgs: ["--require-data-connector-live"],
      mutate: (evidence) => {
        evidence["dist/ci/data-connector-live-evidence.json"] =
          validDataConnectorLiveEvidence();
      },
      assert: (checklist) => {
        if (checklist.status !== "passed") {
          throw new Error(
            `Expected data connector live required evidence to pass, got ${checklist.status}.`,
          );
        }
      },
    },
  );
  runCase(
    checks,
    "valid synthetic GA evidence satisfies identity live required checklist",
    {
      checklistArgs: ["--require-identity-live"],
      mutate: (evidence) => {
        evidence["dist/ci/identity-live-evidence.json"] =
          validIdentityLiveEvidence();
      },
      assert: (checklist) => {
        if (checklist.status !== "passed") {
          throw new Error(
            `Expected identity live required evidence to pass, got ${checklist.status}.`,
          );
        }
      },
    },
  );
  runCase(checks, "Identity live evidence requires redaction proof", {
    checklistArgs: ["--require-identity-live"],
    mutate: (evidence) => {
      const live = validIdentityLiveEvidence();
      live.redaction.rawIdpResponsesReturned = true;
      evidence["dist/ci/identity-live-evidence.json"] = live;
    },
    gateId: "phase23.identity_live",
    failure: "identity_live_redaction_missing",
  });
  runCase(
    checks,
    "valid synthetic GA evidence satisfies analytics authz live required checklist",
    {
      checklistArgs: ["--require-analytics-authz-live"],
      mutate: (evidence) => {
        evidence["dist/ci/analytics-authz-live-evidence.json"] =
          validAnalyticsAuthzLiveEvidence();
      },
      assert: (checklist) => {
        if (checklist.status !== "passed") {
          throw new Error(
            `Expected analytics authz live required evidence to pass, got ${checklist.status}.`,
          );
        }
      },
    },
  );
  runCase(checks, "Analytics authz live evidence requires redaction proof", {
    checklistArgs: ["--require-analytics-authz-live"],
    mutate: (evidence) => {
      const live = validAnalyticsAuthzLiveEvidence();
      live.redaction.rawUsageMetadataReturned = true;
      evidence["dist/ci/analytics-authz-live-evidence.json"] = live;
    },
    gateId: "phase32.analytics_authz_live",
    failure: "analytics_authz_live_redaction_missing",
  });
  runCase(
    checks,
    "valid synthetic GA evidence satisfies tool-dispatch live required checklist",
    {
      checklistArgs: ["--require-tool-dispatch-live"],
      mutate: (evidence) => {
        evidence["dist/ci/tool-dispatch-live-evidence.json"] =
          validToolDispatchLiveEvidence();
      },
      assert: (checklist) => {
        if (checklist.status !== "passed") {
          throw new Error(
            `Expected tool-dispatch live required evidence to pass, got ${checklist.status}.`,
          );
        }
      },
    },
  );
  runCase(checks, "Data connector live evidence requires redaction proof", {
    checklistArgs: ["--require-data-connector-live"],
    mutate: (evidence) => {
      const live = validDataConnectorLiveEvidence();
      live.redaction.rawEndpointUrlsReturned = true;
      evidence["dist/ci/data-connector-live-evidence.json"] = live;
    },
    gateId: "phase31.data_connector_live_worker",
    failure: "data_connector_live_redaction_missing",
  });
  runCase(checks, "Tool-dispatch live evidence requires redaction proof", {
    checklistArgs: ["--require-tool-dispatch-live"],
    mutate: (evidence) => {
      const live = validToolDispatchLiveEvidence();
      live.redaction.rawPayloadValuesReturned = true;
      evidence["dist/ci/tool-dispatch-live-evidence.json"] = live;
    },
    gateId: "phase25.tool_dispatch_live_worker",
    failure: "tool_dispatch_live_redaction_missing",
  });
  runCase(checks, "Tool-dispatch live evidence requires MCP proof", {
    checklistArgs: ["--require-tool-dispatch-live"],
    mutate: (evidence) => {
      const live = validToolDispatchLiveEvidence();
      live.mcp.streamableHttpToolsCallVerified = false;
      evidence["dist/ci/tool-dispatch-live-evidence.json"] = live;
    },
    gateId: "phase25.tool_dispatch_live_worker",
    failure: "tool_dispatch_live_mcp_invalid",
  });
  runCase(
    checks,
    "valid synthetic GA evidence satisfies voice provider live required checklist",
    {
      checklistArgs: ["--require-voice-provider-live"],
      mutate: (evidence) => {
        evidence["dist/ci/voice-provider-live-evidence.json"] =
          validVoiceProviderLiveEvidence();
      },
      assert: (checklist) => {
        if (checklist.status !== "passed") {
          throw new Error(
            `Expected voice provider live required evidence to pass, got ${checklist.status}.`,
          );
        }
      },
    },
  );
  runCase(checks, "Voice provider live evidence requires live mode", {
    checklistArgs: ["--require-voice-provider-live"],
    mutate: (evidence) => {
      const live = validVoiceProviderLiveEvidence();
      live.mode = "dry-run";
      evidence["dist/ci/voice-provider-live-evidence.json"] = live;
    },
    gateId: "phase32.voice_provider_live",
    failure: "voice_provider_live_not_live",
  });
  runCase(checks, "Voice provider live evidence requires redaction proof", {
    checklistArgs: ["--require-voice-provider-live"],
    mutate: (evidence) => {
      const live = validVoiceProviderLiveEvidence();
      live.redaction.rawTranscriptTextReturned = true;
      evidence["dist/ci/voice-provider-live-evidence.json"] = live;
    },
    gateId: "phase32.voice_provider_live",
    failure: "voice_provider_live_redaction_missing",
  });
  runCase(
    checks,
    "valid synthetic GA evidence satisfies notification adapter live required checklist",
    {
      checklistArgs: ["--require-notification-adapter-live"],
      mutate: (evidence) => {
        evidence["dist/ci/notification-adapter-live-evidence.json"] =
          validNotificationAdapterLiveEvidence();
      },
      assert: (checklist) => {
        if (checklist.status !== "passed") {
          throw new Error(
            `Expected notification adapter live required evidence to pass, got ${checklist.status}.`,
          );
        }
      },
    },
  );
  runCase(checks, "Notification adapter live evidence requires live mode", {
    checklistArgs: ["--require-notification-adapter-live"],
    mutate: (evidence) => {
      const live = validNotificationAdapterLiveEvidence();
      live.mode = "dry-run";
      evidence["dist/ci/notification-adapter-live-evidence.json"] = live;
    },
    gateId: "phase32.notification_adapter_live",
    failure: "notification_adapter_live_not_live",
  });
  runCase(
    checks,
    "Notification adapter live evidence requires redaction proof",
    {
      checklistArgs: ["--require-notification-adapter-live"],
      mutate: (evidence) => {
        const live = validNotificationAdapterLiveEvidence();
        live.redaction.rawDestinationsReturned = true;
        evidence["dist/ci/notification-adapter-live-evidence.json"] = live;
      },
      gateId: "phase32.notification_adapter_live",
      failure: "notification_adapter_live_redaction_missing",
    },
  );
  runCase(
    checks,
    "valid synthetic GA evidence satisfies data-rights retention live required checklist",
    {
      checklistArgs: ["--require-data-rights-retention-live"],
      mutate: (evidence) => {
        evidence[
          "dist/ci/data-rights-operational-log-retention-evidence.json"
        ] = validDataRightsRetentionEvidence("operational_logs");
        evidence["dist/ci/data-rights-backup-retention-evidence.json"] =
          validDataRightsRetentionEvidence("backups");
      },
      assert: (checklist) => {
        if (checklist.status !== "passed") {
          throw new Error(
            `Expected data-rights retention live required evidence to pass, got ${checklist.status}.`,
          );
        }
      },
    },
  );
  runCase(
    checks,
    "Data-rights retention live evidence requires redaction proof",
    {
      checklistArgs: ["--require-data-rights-retention-live"],
      mutate: (evidence) => {
        const live = validDataRightsRetentionEvidence("backups");
        live.redaction.backupLocationIncluded = true;
        evidence[
          "dist/ci/data-rights-operational-log-retention-evidence.json"
        ] = validDataRightsRetentionEvidence("operational_logs");
        evidence["dist/ci/data-rights-backup-retention-evidence.json"] = live;
      },
      gateId: "phase33.data_rights_retention_live",
      failure: "data_rights_retention_redaction_missing",
    },
  );
  runCase(
    checks,
    "valid synthetic GA evidence satisfies billing operations live required checklist",
    {
      checklistArgs: ["--require-billing-operations-live"],
      mutate: (evidence) => {
        evidence["dist/ci/billing-operations-evidence.json"] =
          validBillingOperationsEvidence();
      },
      assert: (checklist) => {
        if (checklist.status !== "passed") {
          throw new Error(
            `Expected billing operations live required evidence to pass, got ${checklist.status}.`,
          );
        }
      },
    },
  );
  runCase(
    checks,
    "valid synthetic GA evidence satisfies audit-integrity live required checklist",
    {
      checklistArgs: ["--require-audit-integrity-live"],
      mutate: (evidence) => {
        evidence["dist/ci/audit-integrity-evidence.json"] =
          validAuditIntegrityEvidence();
      },
      assert: (checklist) => {
        if (checklist.status !== "passed") {
          throw new Error(
            `Expected audit-integrity live required evidence to pass, got ${checklist.status}.`,
          );
        }
      },
    },
  );
  runCase(checks, "Audit-integrity live evidence requires redaction proof", {
    checklistArgs: ["--require-audit-integrity-live"],
    mutate: (evidence) => {
      const live = validAuditIntegrityEvidence();
      live.redaction.rawSiemPayloadsReturned = true;
      evidence["dist/ci/audit-integrity-evidence.json"] = live;
    },
    gateId: "phase33.audit_integrity_live",
    failure: "audit_integrity_redaction_missing",
  });
  runCase(checks, "Audit-integrity live evidence requires checksum proof", {
    checklistArgs: ["--require-audit-integrity-live"],
    mutate: (evidence) => {
      const live = validAuditIntegrityEvidence();
      live.checksumChain.brokenLinkCount = 1;
      evidence["dist/ci/audit-integrity-evidence.json"] = live;
    },
    gateId: "phase33.audit_integrity_live",
    failure: "audit_integrity_checksum_chain_missing",
  });
  runCase(checks, "Billing operations live evidence requires redaction proof", {
    checklistArgs: ["--require-billing-operations-live"],
    mutate: (evidence) => {
      const live = validBillingOperationsEvidence();
      live.redaction.rawBillingProviderPayloadsReturned = true;
      evidence["dist/ci/billing-operations-evidence.json"] = live;
    },
    gateId: "phase33.billing_operations_live",
    failure: "billing_operations_redaction_missing",
  });
  runCase(
    checks,
    "valid synthetic GA evidence satisfies tenant purge live required checklist",
    {
      checklistArgs: ["--require-tenant-purge-live"],
      assert: (checklist) => {
        if (checklist.status !== "passed") {
          throw new Error(
            `Expected tenant purge live required evidence to pass, got ${checklist.status}.`,
          );
        }
      },
    },
  );
  runCase(checks, "Tenant purge live evidence rejects dry-run mode", {
    checklistArgs: ["--require-tenant-purge-live"],
    mutate: (evidence) => {
      evidence["dist/ci/tenant-purge-evidence.json"].mode = "dry-run";
    },
    gateId: "phase33.tenant_purge_live",
    failure: "tenant_purge_not_live",
  });
  runCase(
    checks,
    "Tenant purge live evidence requires external vector review",
    {
      checklistArgs: ["--require-tenant-purge-live"],
      mutate: (evidence) => {
        evidence[
          "dist/ci/tenant-purge-evidence.json"
        ].purge.externalVectorReviewedTenantCount = 0;
      },
      gateId: "phase33.tenant_purge_live",
      failure: "tenant_purge_externalVectorReviewedTenantCount_missing",
    },
  );
  runCase(checks, "Tenant purge live evidence requires redaction proof", {
    checklistArgs: ["--require-tenant-purge-live"],
    mutate: (evidence) => {
      evidence[
        "dist/ci/tenant-purge-evidence.json"
      ].redaction.objectStoreKeysReturned = true;
    },
    gateId: "phase33.tenant_purge_live",
    failure: "tenant_purge_redaction_missing",
  });
  runCase(
    checks,
    "valid synthetic GA evidence satisfies target resilience drills required checklist",
    {
      checklistArgs: ["--require-target-resilience-drills"],
      mutate: (evidence) => {
        Object.assign(evidence, validTargetResilienceDrillEvidence());
      },
      assert: (checklist) => {
        if (checklist.status !== "passed") {
          throw new Error(
            `Expected target resilience drills required evidence to pass, got ${checklist.status}.`,
          );
        }
      },
    },
  );
  runCase(checks, "Target resilience drills require redaction proof", {
    checklistArgs: ["--require-target-resilience-drills"],
    mutate: (evidence) => {
      const drills = validTargetResilienceDrillEvidence();
      drills[
        "dist/ci/provider-outage-evidence.json"
      ].redaction.rawProviderPayloadsReturned = true;
      Object.assign(evidence, drills);
    },
    gateId: "phase34.target_resilience_drills",
    failure: "provider_outage_redaction_missing",
  });
  runCase(
    checks,
    "valid synthetic GA evidence satisfies Postgres operations live required checklist",
    {
      checklistArgs: ["--require-postgres-operations-live"],
      assert: (checklist) => {
        if (checklist.status !== "passed") {
          throw new Error(
            `Expected Postgres operations live required evidence to pass, got ${checklist.status}.`,
          );
        }
      },
    },
  );
  runCase(
    checks,
    "Postgres query-plan evidence requires representative target",
    {
      checklistArgs: ["--require-postgres-operations-live"],
      mutate: (evidence) => {
        evidence[
          "dist/ci/postgres-query-plan-review.json"
        ].target.representativeVolume = false;
      },
      gateId: "phase34.postgres_operations_live",
      failure: "postgres_query_plan_not_representative",
    },
  );
  runCase(checks, "Postgres telemetry requires representative calls", {
    checklistArgs: ["--require-postgres-operations-live"],
    mutate: (evidence) => {
      evidence[
        "dist/ci/postgres-slow-query-telemetry.json"
      ].summary.totalCalls = 0;
    },
    gateId: "phase34.postgres_operations_live",
    failure: "postgres_slow_query_not_representative",
  });
  runCase(checks, "Postgres archival decision must be accepted", {
    checklistArgs: ["--require-postgres-operations-live"],
    mutate: (evidence) => {
      evidence["dist/ci/postgres-archival-partitioning-decision.json"].status =
        "deferred";
    },
    gateId: "phase34.postgres_operations_live",
    failure: "postgres_archival_decision_not_accepted",
  });
  runCase(checks, "Postgres operations evidence requires redaction proof", {
    checklistArgs: ["--require-postgres-operations-live"],
    mutate: (evidence) => {
      evidence[
        "dist/ci/postgres-query-plan-review.json"
      ].validation.rawSqlPersisted = true;
    },
    gateId: "phase34.postgres_operations_live",
    failure: "postgres_query_plan_redaction_missing",
  });
  runCase(checks, "Compose product smoke requires restart readback", {
    mutate: (evidence) => {
      const compose = evidence["dist/ci/compose-smoke.json"];
      compose.checks = compose.checks.filter(
        (check) => check !== "postgres_restart_readback",
      );
    },
    gateId: "phase20.compose_product_smoke",
    failure: "compose_smoke_missing_check:postgres_restart_readback",
  });
  runCase(checks, "Compose workers smoke requires crash recovery", {
    mutate: (evidence) => {
      evidence["dist/ci/compose-workers-smoke.json"].crashRecovery = {
        signal: "SIGKILL",
        recoveredStatus: "running",
      };
    },
    gateId: "phase20.compose_workers_smoke",
    failure: "compose_workers_crash_recovery_incomplete",
  });
  runCase(
    checks,
    "Compose backup restore evidence requires isolated projects",
    {
      mutate: (evidence) => {
        const backup = evidence["dist/ci/compose-backup-restore-smoke.json"];
        backup.restoreProjectName = backup.sourceProjectName;
      },
      gateId: "phase20.compose_backup_restore",
      failure: "compose_backup_restore_projects_not_isolated",
    },
  );
  runCase(checks, "Kubernetes render evidence requires KEDA examples", {
    mutate: (evidence) => {
      const render = evidence["dist/ci/kubernetes-render-smoke.json"];
      render.kedaExamples.resources = render.kedaExamples.resources.filter(
        (resource) => resource.kind !== "ScaledJob",
      );
    },
    gateId: "phase21.kubernetes_render_contract",
    failure:
      "kubernetes_render_missing_keda_example:keda.sh/v1alpha1:ScaledJob:romeo-webhook-retry",
  });
  runCase(checks, "Kubernetes live dry-run shape is rejected", {
    mutate: (evidence) => {
      evidence["dist/ci/kubernetes-live-smoke.json"].mode = "dry-run";
    },
    gateId: "phase21.kubernetes_live_smoke",
    failure: "kubernetes_live_smoke_not_live",
  });
  runCase(checks, "Kubernetes live evidence requires generated timestamp", {
    mutate: (evidence) => {
      delete evidence["dist/ci/kubernetes-live-smoke.json"].generatedAt;
    },
    gateId: "phase21.kubernetes_live_smoke",
    failure: "kubernetes_live_smoke_generated_at_invalid",
  });
  runCase(checks, "Kubernetes live evidence rejects stale target runs", {
    mutate: (evidence) => {
      evidence["dist/ci/kubernetes-live-smoke.json"].generatedAt =
        "2020-01-01T00:00:00.000Z";
    },
    gateId: "phase21.kubernetes_live_smoke",
    failure: "kubernetes_live_smoke_evidence_stale",
  });
  runCase(checks, "Kubernetes live evidence requires workflow readback", {
    mutate: (evidence) => {
      delete evidence["dist/ci/kubernetes-live-smoke.json"].productWorkflow
        .webhookDeliveryId;
    },
    gateId: "phase21.kubernetes_live_smoke",
    failure: "kubernetes_live_smoke_missing_readback_webhookDeliveryId",
  });
  runCase(checks, "Kubernetes live evidence requires pinned dependencies", {
    mutate: (evidence) => {
      evidence[
        "dist/ci/kubernetes-live-smoke.json"
      ].imagePosture.dependencyImagesDigestPinned = false;
    },
    gateId: "phase21.kubernetes_live_smoke",
    failure: "kubernetes_live_smoke_dependency_images_not_pinned",
  });
  runCase(checks, "Kubernetes live evidence requires local MFA fallback", {
    mutate: (evidence) => {
      const live = evidence["dist/ci/kubernetes-live-smoke.json"];
      live.checks = live.checks.filter(
        (check) => check !== "valid_mfa_code_sets_session_cookie",
      );
    },
    gateId: "phase21.kubernetes_live_smoke",
    failure:
      "kubernetes_live_smoke_missing_check:valid_mfa_code_sets_session_cookie",
  });
  runCase(checks, "Kubernetes live evidence requires auth log redaction", {
    mutate: (evidence) => {
      evidence[
        "dist/ci/kubernetes-live-smoke.json"
      ].logRedaction.rawAuthSentinelsChecked = 0;
    },
    gateId: "phase21.kubernetes_live_smoke",
    failure: "kubernetes_live_smoke_log_redaction_missing_auth_sentinel",
  });
  runCase(checks, "Kubernetes worker dry-run shape is rejected", {
    mutate: (evidence) => {
      evidence["dist/ci/kubernetes-workers-smoke.json"].mode = "dry-run";
    },
    gateId: "phase25.kubernetes_workers_smoke",
    failure: "kubernetes_workers_not_live",
  });
  runCase(checks, "Kubernetes worker evidence requires crash recovery", {
    mutate: (evidence) => {
      const workers = evidence["dist/ci/kubernetes-workers-smoke.json"];
      workers.checks = workers.checks.filter(
        (check) => check !== "workflow_resume_pod_crash_recovery",
      );
    },
    gateId: "phase25.kubernetes_workers_smoke",
    failure:
      "kubernetes_workers_missing_check:workflow_resume_pod_crash_recovery",
  });
  runCase(checks, "Kubernetes worker evidence requires log redaction", {
    mutate: (evidence) => {
      delete evidence["dist/ci/kubernetes-workers-smoke.json"].logRedaction;
    },
    gateId: "phase25.kubernetes_workers_smoke",
    failure: "kubernetes_workers_log_redaction_missing",
  });
  runCase(
    checks,
    "Kubernetes worker evidence requires prompt redaction proof",
    {
      mutate: (evidence) => {
        evidence[
          "dist/ci/kubernetes-workers-smoke.json"
        ].logRedaction.rawPromptSentinelsChecked = 0;
      },
      gateId: "phase25.kubernetes_workers_smoke",
      failure: "kubernetes_workers_log_redaction_missing_prompt_sentinels",
    },
  );
  runCase(checks, "Kubernetes NetworkPolicy dry-run shape is rejected", {
    mutate: (evidence) => {
      evidence["dist/ci/kubernetes-networkpolicy-smoke.json"].mode = "dry-run";
    },
    gateId: "phase21.kubernetes_networkpolicy_enforcement",
    failure: "networkpolicy_not_live",
  });
  runCase(checks, "Kubernetes NetworkPolicy requires denied egress proof", {
    mutate: (evidence) => {
      const networkPolicy =
        evidence["dist/ci/kubernetes-networkpolicy-smoke.json"];
      networkPolicy.checks = networkPolicy.checks.filter(
        (check) => check !== "denied_endpoint_blocked_after_policy",
      );
    },
    gateId: "phase21.kubernetes_networkpolicy_enforcement",
    failure: "networkpolicy_missing_check:denied_endpoint_blocked_after_policy",
  });
  runCase(checks, "Kubernetes NetworkPolicy requires log redaction evidence", {
    mutate: (evidence) => {
      delete evidence["dist/ci/kubernetes-networkpolicy-smoke.json"]
        .logRedaction;
    },
    gateId: "phase21.kubernetes_networkpolicy_enforcement",
    failure: "networkpolicy_log_redaction_missing",
  });
  runCase(
    checks,
    "Kubernetes NetworkPolicy requires generated sentinel redaction proof",
    {
      mutate: (evidence) => {
        evidence[
          "dist/ci/kubernetes-networkpolicy-smoke.json"
        ].logRedaction.generatedSentinelChecked = false;
      },
      gateId: "phase21.kubernetes_networkpolicy_enforcement",
      failure: "networkpolicy_log_redaction_missing_generated_sentinel",
    },
  );
  runCase(checks, "KEDA dry-run shape is rejected when required", {
    checklistArgs: ["--require-keda"],
    mutate: (evidence) => {
      evidence["dist/ci/kubernetes-keda-smoke.json"].mode = "dry-run";
    },
    gateId: "phase21.kubernetes_keda_scaler",
    failure: "keda_not_live",
  });
  runCase(checks, "KEDA evidence requires worker Job completion", {
    checklistArgs: ["--require-keda"],
    mutate: (evidence) => {
      const keda = evidence["dist/ci/kubernetes-keda-smoke.json"];
      keda.checks = keda.checks.filter(
        (check) => check !== "keda_worker_job_completed",
      );
    },
    gateId: "phase21.kubernetes_keda_scaler",
    failure: "keda_missing_check:keda_worker_job_completed",
  });
  runCase(checks, "KEDA evidence requires delivery retry readback", {
    checklistArgs: ["--require-keda"],
    mutate: (evidence) => {
      const keda = evidence["dist/ci/kubernetes-keda-smoke.json"];
      keda.seededDelivery.retriedAttemptCount =
        keda.seededDelivery.initialAttemptCount;
    },
    gateId: "phase21.kubernetes_keda_scaler",
    failure: "keda_delivery_retry_not_observed",
  });
  runCase(checks, "KEDA evidence requires log redaction", {
    checklistArgs: ["--require-keda"],
    mutate: (evidence) => {
      delete evidence["dist/ci/kubernetes-keda-smoke.json"].logRedaction;
    },
    gateId: "phase21.kubernetes_keda_scaler",
    failure: "keda_log_redaction_missing",
  });
  runCase(checks, "KEDA evidence requires target log scan proof", {
    checklistArgs: ["--require-keda"],
    mutate: (evidence) => {
      evidence[
        "dist/ci/kubernetes-keda-smoke.json"
      ].logRedaction.targetNamespaceLogEntries = 0;
    },
    gateId: "phase21.kubernetes_keda_scaler",
    failure: "keda_log_redaction_missing_target_log_scan",
  });
  runCase(checks, "KEDA evidence requires operator log scan proof", {
    checklistArgs: ["--require-keda"],
    mutate: (evidence) => {
      evidence[
        "dist/ci/kubernetes-keda-smoke.json"
      ].logRedaction.kedaOperatorLogEntries = 0;
    },
    gateId: "phase21.kubernetes_keda_scaler",
    failure: "keda_log_redaction_missing_operator_log_scan",
  });
  runCase(checks, "CloudNativePG DR evidence must use CloudNativePG mode", {
    mutate: (evidence) => {
      evidence["dist/ci/kubernetes-cloudnativepg-dr.json"].databaseMode =
        "external-postgres";
    },
    gateId: "phase21.kubernetes_dr_modes",
    failure: "kubernetes_dr_wrong_database_mode:cloudnativepg",
  });
  runCase(
    checks,
    "Kubernetes DR evidence requires isolated restore namespace",
    {
      mutate: (evidence) => {
        const dr = evidence["dist/ci/kubernetes-external-postgres-dr.json"];
        dr.restore.namespace = dr.source.namespace;
      },
      gateId: "phase21.kubernetes_dr_modes",
      failure: "kubernetes_dr_namespaces_not_isolated",
    },
  );
  runCase(checks, "Kubernetes DR evidence requires restore log redaction", {
    mutate: (evidence) => {
      evidence[
        "dist/ci/kubernetes-external-postgres-dr.json"
      ].logRedaction.restoreScannedPodLogEntries = 0;
    },
    gateId: "phase21.kubernetes_dr_modes",
    failure: "kubernetes_dr_log_redaction_missing_restore_pod_scan",
  });
  runCase(checks, "Planned release readback is rejected for GA", {
    mutate: (evidence) => {
      evidence["dist/release/readback-validation.json"].mode =
        "planned_readback";
    },
    gateId: "phase22.credentialed_release_readback",
    failure: "planned_readback_is_not_credentialed",
  });
  runCase(checks, "Release readback requires OCI image verification", {
    mutate: (evidence) => {
      evidence["dist/release/readback-validation.json"].required.images = [];
    },
    gateId: "phase22.credentialed_release_readback",
    failure: "release_readback_required_image_missing",
  });
  runCase(checks, "Release readback requires Helm chart verification", {
    mutate: (evidence) => {
      evidence["dist/release/readback-validation.json"].required.charts = [];
    },
    gateId: "phase22.credentialed_release_readback",
    failure: "release_readback_required_chart_missing",
  });
  runCase(checks, "Release readback requires remote SBOM asset", {
    mutate: (evidence) => {
      const readback = evidence["dist/release/readback-validation.json"];
      readback.required.assets = readback.required.assets.filter(
        (asset) => asset.name !== "sbom",
      );
    },
    gateId: "phase22.credentialed_release_readback",
    failure: "release_readback_missing_required_asset:sbom",
  });
  runCase(checks, "Release readback rejects unverified SBOM asset", {
    mutate: (evidence) => {
      const readback = evidence["dist/release/readback-validation.json"];
      const check = readback.checks.find(
        (item) => item.name === "sbom release asset readback is verified",
      );
      check.status = "fail";
    },
    gateId: "phase22.credentialed_release_readback",
    failure: "release_readback_asset_not_verified:sbom",
  });
  runCase(checks, "Release readback validation requires redaction proof", {
    mutate: (evidence) => {
      evidence[
        "dist/release/readback-validation.json"
      ].redaction.tokenValuesReturned = true;
    },
    gateId: "phase22.credentialed_release_readback",
    failure: "release_readback_redaction_missing",
  });
  runCase(checks, "Release provenance redaction proof is required", {
    mutate: (evidence) => {
      evidence[
        "dist/release/release-provenance.json"
      ].redaction.rawCiRunUrlReturned = true;
    },
    gateId: "phase22.release_security",
    failure: "release_provenance_redaction_missing",
  });
  runCase(checks, "Release approval redaction proof is required", {
    mutate: (evidence) => {
      evidence[
        "dist/release/release-approval.json"
      ].redaction.rawApproverIdsReturned = true;
    },
    gateId: "phase22.release_security",
    failure: "release_approval_redaction_missing",
  });
  runCase(
    checks,
    "valid synthetic GA evidence satisfies CI governance live required checklist",
    {
      checklistArgs: ["--require-ci-governance-live"],
      assert: (checklist) => {
        if (checklist.status !== "passed") {
          throw new Error(
            `Expected CI governance live required evidence to pass, got ${checklist.status}.`,
          );
        }
      },
    },
  );
  runCase(checks, "Hosted CI dry-run evidence is rejected for GA", {
    checklistArgs: ["--require-ci-governance-live"],
    mutate: (evidence) => {
      evidence["dist/ci/hosted-ci-run-verification.json"].mode = "dry-run";
    },
    gateId: "phase22.ci_governance_live",
    failure: "hosted_ci_run_not_live",
  });
  runCase(checks, "Branch-protection plan requires two approvals", {
    checklistArgs: ["--require-ci-governance-live"],
    mutate: (evidence) => {
      evidence[
        "dist/ci/branch-protection-plan.json"
      ].policy.requiredApprovingReviewCount = 1;
    },
    gateId: "phase22.ci_governance_live",
    failure: "branch_protection_plan_policy_incomplete",
  });
  runCase(
    checks,
    "Hosted branch-protection verification requires every planned check",
    {
      checklistArgs: ["--require-ci-governance-live"],
      mutate: (evidence) => {
        const verification =
          evidence["dist/ci/branch-protection-verification.json"];
        verification.checks = verification.checks.filter(
          (check) => check.name !== "all planned status checks required",
        );
      },
      gateId: "phase22.ci_governance_live",
      failure:
        "branch_protection_verification_missing_check:all planned status checks required",
    },
  );
  runCase(checks, "Hosted CI run evidence requires redaction proof", {
    checklistArgs: ["--require-ci-governance-live"],
    mutate: (evidence) => {
      evidence[
        "dist/ci/hosted-ci-run-verification.json"
      ].redaction.rawJobLogsReturned = true;
    },
    gateId: "phase22.ci_governance_live",
    failure: "hosted_ci_run_redaction_missing",
  });
  runCase(checks, "Target quality dry-run shape is rejected", {
    mutate: (evidence) => {
      evidence["dist/ci/target-quality-evidence.json"].mode = "dry-run";
    },
    gateId: "phase32.target_quality_evidence",
    failure: "target_quality_not_live",
  });
  runCase(checks, "Target quality evidence requires generated timestamp", {
    mutate: (evidence) => {
      delete evidence["dist/ci/target-quality-evidence.json"].generatedAt;
    },
    gateId: "phase32.target_quality_evidence",
    failure: "target_quality_generated_at_invalid",
  });
  runCase(checks, "Target quality evidence requires eval gate proof", {
    mutate: (evidence) => {
      const quality = evidence["dist/ci/target-quality-evidence.json"];
      quality.checks = quality.checks.filter(
        (check) => check !== "eval_gate_passed",
      );
    },
    gateId: "phase32.target_quality_evidence",
    failure: "target_quality_missing_check:eval_gate_passed",
  });
  runCase(checks, "Target quality evidence requires retrieval replay", {
    mutate: (evidence) => {
      const quality = evidence["dist/ci/target-quality-evidence.json"];
      quality.replay = { checked: false };
    },
    gateId: "phase32.target_quality_evidence",
    failure: "target_quality_replay_missing",
  });
  runCase(checks, "Target quality evidence requires redaction proof", {
    mutate: (evidence) => {
      evidence["dist/ci/target-quality-evidence.json"].analytics.redaction = {
        rawEvalInputsReturned: true,
      };
    },
    gateId: "phase32.target_quality_evidence",
    failure: "target_quality_analytics_redaction_missing",
  });
  runCase(checks, "Target quality evidence rejects raw eval subject IDs", {
    mutate: (evidence) => {
      const evalEvidence =
        evidence["dist/ci/target-quality-evidence.json"].evals[0];
      evalEvidence.agentId = "agent_contract";
      evalEvidence.workspaceId = "workspace_contract";
      delete evalEvidence.subject;
    },
    gateId: "phase32.target_quality_evidence",
    failure: "target_quality_eval_subject_raw_ids_returned",
  });
  runCase(
    checks,
    "Target quality vector comparison required checklist rejects missing proof",
    {
      checklistArgs: ["--require-target-quality-vector-comparison"],
      mutate: (evidence) => {
        const quality = evidence["dist/ci/target-quality-evidence.json"];
        quality.checks = quality.checks.filter(
          (check) => check !== "retrieval_vector_route_comparison",
        );
        delete quality.replay.vectorComparison;
      },
      gateId: "phase32.target_quality_evidence",
      failure: "target_quality_missing_check:retrieval_vector_route_comparison",
    },
  );
  runCase(checks, "Tenant isolation evidence requires vector post-filtering", {
    mutate: (evidence) => {
      const tenant = evidence["dist/ci/tenant-isolation-negative-suite.json"];
      tenant.checks = tenant.checks.filter(
        (check) => check !== "external_vector_hit_post_filtering",
      );
    },
    gateId: "phase33.tenant_isolation_negative_suite",
    failure:
      "tenant_isolation_missing_check:external_vector_hit_post_filtering",
  });
  runCase(
    checks,
    "Tenant isolation evidence requires suspended-tenant work boundary proof",
    {
      mutate: (evidence) => {
        const tenant = evidence["dist/ci/tenant-isolation-negative-suite.json"];
        tenant.checks = tenant.checks.filter(
          (check) => check !== "suspended_tenant_work_boundary_enforcement",
        );
      },
      gateId: "phase33.tenant_isolation_negative_suite",
      failure:
        "tenant_isolation_missing_check:suspended_tenant_work_boundary_enforcement",
    },
  );
  runCase(checks, "Tenant isolation evidence keeps test output hashed", {
    mutate: (evidence) => {
      evidence["dist/ci/tenant-isolation-negative-suite.json"].result.stdout =
        "RAW_TEST_OUTPUT";
    },
    gateId: "phase33.tenant_isolation_negative_suite",
    failure: "tenant_isolation_raw_stdout_present",
  });
  runCase(checks, "Kubernetes tiered RAG dry-run shape is rejected", {
    mutate: (evidence) => {
      evidence["dist/ci/kubernetes-tiered-rag-smoke.json"].mode = "dry-run";
    },
    gateId: "phase32.kubernetes_tiered_rag_smoke",
    failure: "tiered_rag_not_live",
  });
  runCase(checks, "Kubernetes tiered RAG requires denied-corpus proof", {
    mutate: (evidence) => {
      const tieredRag = evidence["dist/ci/kubernetes-tiered-rag-smoke.json"];
      tieredRag.checks = tieredRag.checks.filter(
        (check) => check !== "denied_corpus_skipped_without_id_or_content_leak",
      );
    },
    gateId: "phase32.kubernetes_tiered_rag_smoke",
    failure:
      "tiered_rag_missing_check:denied_corpus_skipped_without_id_or_content_leak",
  });
  runCase(checks, "Kubernetes tiered RAG requires vector plan posture check", {
    mutate: (evidence) => {
      const tieredRag = evidence["dist/ci/kubernetes-tiered-rag-smoke.json"];
      tieredRag.checks = tieredRag.checks.filter(
        (check) => check !== "tiered_rag_vector_plan_posture_reported",
      );
    },
    gateId: "phase32.kubernetes_tiered_rag_smoke",
    failure: "tiered_rag_missing_check:tiered_rag_vector_plan_posture_reported",
  });
  runCase(checks, "Kubernetes tiered RAG requires vector scope counts", {
    mutate: (evidence) => {
      evidence[
        "dist/ci/kubernetes-tiered-rag-smoke.json"
      ].vectorPosture.vectorScopeDriverCounts.pgvector = 3;
    },
    gateId: "phase32.kubernetes_tiered_rag_smoke",
    failure: "tiered_rag_vector_scope_counts_invalid",
  });
  runCase(checks, "Kubernetes tiered RAG requires policy restore", {
    mutate: (evidence) => {
      evidence["dist/ci/kubernetes-tiered-rag-smoke.json"].policyRestore = {
        requested: false,
        status: "kept_by_flag",
      };
    },
    gateId: "phase32.kubernetes_tiered_rag_smoke",
    failure: "tiered_rag_policy_not_restored",
  });
  runCase(checks, "Kubernetes tiered RAG requires log redaction", {
    mutate: (evidence) => {
      delete evidence["dist/ci/kubernetes-tiered-rag-smoke.json"].logRedaction;
    },
    gateId: "phase32.kubernetes_tiered_rag_smoke",
    failure: "tiered_rag_log_redaction_missing",
  });
  runCase(checks, "Qdrant live dry-run evidence is rejected", {
    checklistArgs: ["--require-qdrant-live"],
    mutate: (evidence) => {
      evidence["dist/ci/qdrant-live-evidence.json"].mode = "dry-run";
    },
    gateId: "phase32.qdrant_live_evidence",
    failure: "qdrant_live_not_live",
  });
  runCase(checks, "Qdrant live evidence requires generated timestamp", {
    checklistArgs: ["--require-qdrant-live"],
    mutate: (evidence) => {
      delete evidence["dist/ci/qdrant-live-evidence.json"].generatedAt;
    },
    gateId: "phase32.qdrant_live_evidence",
    failure: "qdrant_live_generated_at_invalid",
  });
  runCase(checks, "Qdrant live evidence requires namespace isolation", {
    checklistArgs: ["--require-qdrant-live"],
    mutate: (evidence) => {
      evidence["dist/ci/qdrant-live-evidence.json"].target.namespacePolicy =
        "none";
    },
    gateId: "phase32.qdrant_live_evidence",
    failure: "qdrant_live_namespace_policy_invalid",
  });
  runCase(checks, "Qdrant live evidence requires scoped trap exclusion", {
    checklistArgs: ["--require-qdrant-live"],
    mutate: (evidence) => {
      evidence[
        "dist/ci/qdrant-live-evidence.json"
      ].isolation.namespaceTrapExcluded = false;
    },
    gateId: "phase32.qdrant_live_evidence",
    failure: "qdrant_live_isolation_incomplete",
  });
  runCase(checks, "Qdrant live evidence requires redaction proof", {
    checklistArgs: ["--require-qdrant-live"],
    mutate: (evidence) => {
      evidence["dist/ci/qdrant-live-evidence.json"].redaction.endpointReturned =
        true;
    },
    gateId: "phase32.qdrant_live_evidence",
    failure: "qdrant_live_redaction_missing",
  });
  runCase(checks, "Qdrant DR dry-run restore evidence is rejected", {
    checklistArgs: ["--require-qdrant-dr"],
    mutate: (evidence) => {
      evidence["dist/ci/qdrant-dr-restore.json"].mode = "dry-run";
    },
    gateId: "phase32.qdrant_dr_consistency",
    failure: "qdrant_dr_not_live:verify_restore",
  });
  runCase(checks, "Qdrant DR restore requires cleanup proof", {
    checklistArgs: ["--require-qdrant-dr"],
    mutate: (evidence) => {
      evidence["dist/ci/qdrant-dr-restore.json"].restore.postDeleteResultCount =
        1;
    },
    gateId: "phase32.qdrant_dr_consistency",
    failure: "qdrant_dr_restore_cleanup_incomplete",
  });
  runCase(checks, "Qdrant DR source cleanup evidence is required", {
    checklistArgs: ["--require-qdrant-dr"],
    mutate: (evidence) => {
      delete evidence["dist/ci/qdrant-dr-source-cleanup.json"].cleanup;
    },
    gateId: "phase32.qdrant_dr_consistency",
    failure: "qdrant_dr_source_cleanup_incomplete",
  });
  runCase(checks, "Dry-run edge enforcement evidence is rejected", {
    mutate: (evidence) => {
      evidence["dist/ci/live-edge-enforcement.json"].mode = "dry-run";
    },
    gateId: "phase33.live_edge_enforcement",
    failure: "edge_enforcement_not_live",
  });
  runCase(checks, "Live edge enforcement requires WAF block proof", {
    mutate: (evidence) => {
      const edge = evidence["dist/ci/live-edge-enforcement.json"];
      edge.checks = edge.checks.filter(
        (check) => check !== "waf_or_gateway_probe_blocked",
      );
    },
    gateId: "phase33.live_edge_enforcement",
    failure: "edge_enforcement_missing_check:waf_or_gateway_probe_blocked",
  });
  runCase(checks, "Live edge enforcement requires redaction proof", {
    mutate: (evidence) => {
      delete evidence["dist/ci/live-edge-enforcement.json"].redaction;
    },
    gateId: "phase33.live_edge_enforcement",
    failure: "edge_redaction_missing",
  });
  runCase(checks, "Live edge enforcement requires probe body redaction", {
    mutate: (evidence) => {
      evidence[
        "dist/ci/live-edge-enforcement.json"
      ].requestBodyLimit.requestBodyReturned = true;
    },
    gateId: "phase33.live_edge_enforcement",
    failure: "edge_redaction_missing_body_limit_request_body",
  });
  runCase(checks, "Dry-run live alert evidence is rejected", {
    mutate: (evidence) => {
      evidence["dist/ci/live-alert-firing.json"].mode = "dry-run";
    },
    gateId: "phase34.live_alert_firing",
    failure: "alert_firing_not_live",
  });
  runCase(checks, "Live alert evidence requires backup alert coverage", {
    mutate: (evidence) => {
      const alerts = evidence["dist/ci/live-alert-firing.json"];
      alerts.requiredAlerts = alerts.requiredAlerts.filter(
        (alert) => alert.category !== "backup",
      );
    },
    gateId: "phase34.live_alert_firing",
    failure: "missing_backup_alert_category",
  });
  runCase(checks, "Live alert evidence requires redaction proof", {
    mutate: (evidence) => {
      evidence[
        "dist/ci/live-alert-firing.json"
      ].redaction.rawAlertPayloadsReturned = true;
    },
    gateId: "phase34.live_alert_firing",
    failure: "alert_firing_redaction_missing",
  });
  runCase(checks, "Kubernetes load/soak evidence requires repeated runs", {
    mutate: (evidence) => {
      evidence["dist/ci/kubernetes-load-soak.json"].loadRuns = 1;
    },
    gateId: "phase34.kubernetes_load_soak",
    failure: "load_soak_requires_repeated_runs",
  });
  runCase(checks, "Kubernetes load/soak evidence requires real duration", {
    mutate: (evidence) => {
      evidence["dist/ci/kubernetes-load-soak.json"].soak.requestedSeconds = 0;
    },
    gateId: "phase34.kubernetes_load_soak",
    failure: "load_soak_requested_duration_too_short",
  });
  runCase(checks, "Kubernetes load/soak evidence requires target namespace", {
    mutate: (evidence) => {
      delete evidence["dist/ci/kubernetes-load-soak.json"].target.namespace;
    },
    gateId: "phase34.kubernetes_load_soak",
    failure: "load_soak_missing_target_namespace",
  });
  runCase(checks, "Kubernetes load/soak evidence requires log redaction", {
    mutate: (evidence) => {
      delete evidence["dist/ci/kubernetes-load-soak.json"].logRedaction;
    },
    gateId: "phase34.kubernetes_load_soak",
    failure: "load_soak_log_redaction_missing",
  });
  runCase(
    checks,
    "Kubernetes load/soak evidence requires fixture redaction proof",
    {
      mutate: (evidence) => {
        evidence[
          "dist/ci/kubernetes-load-soak.json"
        ].logRedaction.rawFixtureSentinelsChecked = 0;
      },
      gateId: "phase34.kubernetes_load_soak",
      failure: "load_soak_log_redaction_missing_fixture_sentinels",
    },
  );
  runCase(checks, "Kubernetes load/soak evidence requires run summaries", {
    mutate: (evidence) => {
      evidence["dist/ci/kubernetes-load-soak.json"].loadEvidence[0].mode =
        "dry-run";
    },
    gateId: "phase34.kubernetes_load_soak",
    failure: "load_soak_run_summary_invalid",
  });
  runCase(checks, "Kubernetes load/soak evidence omits raw image IDs", {
    mutate: (evidence) => {
      evidence[
        "dist/ci/kubernetes-load-soak.json"
      ].kubernetes.pods[0].containers[0].imageID =
        "registry.example/romeo@sha256:abc";
    },
    gateId: "phase34.kubernetes_load_soak",
    failure: "load_soak_raw_image_id_returned",
  });
  runCase(checks, "Support bundle evidence requires secret redaction check", {
    mutate: (evidence) => {
      const support = evidence["dist/ci/support-bundle-redaction.json"];
      support.checks = support.checks.filter(
        (check) => check !== "environment_secret_values_not_included",
      );
    },
    gateId: "phase35.support_bundle_redaction",
    failure:
      "support_bundle_missing_check:environment_secret_values_not_included",
  });
  runCase(checks, "Support bundle evidence requires explicit redaction flags", {
    mutate: (evidence) => {
      evidence[
        "dist/ci/support-bundle-redaction.json"
      ].redaction.rawLogContentReturned = true;
    },
    gateId: "phase35.support_bundle_redaction",
    failure: "support_bundle_redaction_missing",
  });
  runCase(
    checks,
    "Support bundle evidence requires configured secret posture",
    {
      mutate: (evidence) => {
        const support = evidence["dist/ci/support-bundle-redaction.json"];
        support.supportBundle.configuredSecretKeys =
          support.supportBundle.configuredSecretKeys.filter(
            (key) => key !== "SESSION_SECRET",
          );
      },
      gateId: "phase35.support_bundle_redaction",
      failure: "support_bundle_missing_configured_secret:SESSION_SECRET",
    },
  );
  runCase(
    checks,
    "valid synthetic GA evidence satisfies support bundle live required checklist",
    {
      checklistArgs: ["--require-support-bundle-live"],
      assert: (checklist) => {
        if (checklist.status !== "passed") {
          throw new Error(
            `Expected support bundle live required evidence to pass, got ${checklist.status}.`,
          );
        }
      },
    },
  );
  runCase(checks, "Support bundle live evidence requires generated status", {
    checklistArgs: ["--require-support-bundle-live"],
    mutate: (evidence) => {
      evidence["dist/ci/support-bundle.json"].status = "failed";
    },
    gateId: "phase35.support_bundle_live",
    failure: "support_bundle_not_generated",
  });
  runCase(checks, "Support bundle live evidence requires baseline inventory", {
    checklistArgs: ["--require-support-bundle-live"],
    mutate: (evidence) => {
      evidence[
        "dist/ci/support-bundle.json"
      ].migrations.greenfieldBaselineOnly = false;
    },
    gateId: "phase35.support_bundle_live",
    failure: "support_bundle_migration_inventory_invalid",
  });
  runCase(checks, "Support bundle live evidence requires access-review link", {
    checklistArgs: ["--require-support-bundle-live"],
    mutate: (evidence) => {
      evidence["dist/ci/support-bundle.json"].complianceEvidence.accessReview =
        {
          status: "missing",
          count: 0,
          artifacts: [],
        };
    },
    gateId: "phase35.support_bundle_live",
    failure: "support_bundle_access_review_missing",
  });
  runCase(checks, "Support bundle live evidence requires bundle redaction", {
    checklistArgs: ["--require-support-bundle-live"],
    mutate: (evidence) => {
      evidence["dist/ci/support-bundle.json"].redaction.rawContentIncluded =
        true;
    },
    gateId: "phase35.support_bundle_live",
    failure: "support_bundle_redaction_missing",
  });
  runCase(
    checks,
    "Provider resilience evidence requires kill-switch fallback",
    {
      mutate: (evidence) => {
        const provider = evidence["dist/ci/provider-resilience-smoke.json"];
        provider.cases = provider.cases.filter(
          (item) => item.name !== "provider_kill_switch_fallback",
        );
      },
      gateId: "phase34.provider_resilience_smoke",
      failure: "provider_resilience_kill_switch_incomplete",
    },
  );
  runCase(checks, "Provider resilience evidence requires redaction proof", {
    mutate: (evidence) => {
      evidence[
        "dist/ci/provider-resilience-smoke.json"
      ].redaction.rawProviderErrorsReturned = true;
    },
    gateId: "phase34.provider_resilience_smoke",
    failure: "provider_resilience_redaction_missing",
  });
  runCase(checks, "Job lag evidence requires dead-letter alert", {
    mutate: (evidence) => {
      const jobs = evidence["dist/ci/job-lag-smoke.json"];
      jobs.summary.alerts = jobs.summary.alerts.filter(
        (alert) => alert.metric !== "dead_letter_jobs",
      );
    },
    gateId: "phase34.job_lag_smoke",
    failure: "job_lag_missing_alert_metric:dead_letter_jobs",
  });
  runCase(checks, "Job lag evidence requires redaction proof", {
    mutate: (evidence) => {
      evidence[
        "dist/ci/job-lag-smoke.json"
      ].redaction.rawDeadLetterPayloadReturned = true;
    },
    gateId: "phase34.job_lag_smoke",
    failure: "job_lag_redaction_missing",
  });
  runCase(checks, "Operational monitoring evidence requires provider metrics", {
    mutate: (evidence) => {
      const monitoring =
        evidence["dist/ci/operational-monitoring-validation.json"];
      monitoring.metricNames = monitoring.metricNames.filter(
        (metric) => metric !== "romeo_provider_circuit_state",
      );
    },
    gateId: "phase34.operational_monitoring_contract",
    failure:
      "operational_monitoring_missing_metric:romeo_provider_circuit_state",
  });
  runCase(checks, "Operational monitoring evidence requires redaction proof", {
    mutate: (evidence) => {
      evidence[
        "dist/ci/operational-monitoring-validation.json"
      ].redaction.prometheusTextReturned = true;
    },
    gateId: "phase34.operational_monitoring_contract",
    failure: "operational_monitoring_redaction_missing",
  });
  runCase(checks, "Backup upload failure evidence requires timeout case", {
    mutate: (evidence) => {
      const backup =
        evidence["dist/ci/postgres-backup-upload-failure-smoke.json"];
      backup.cases = backup.cases.filter(
        (item) => item.name !== "upload_timeout",
      );
    },
    gateId: "phase34.backup_upload_failure_smoke",
    failure: "backup_upload_missing_case:upload_timeout",
  });
  runCase(checks, "Backup upload failure evidence requires redaction proof", {
    mutate: (evidence) => {
      evidence[
        "dist/ci/postgres-backup-upload-failure-smoke.json"
      ].redaction.rawPresignedUploadUrlReturned = true;
    },
    gateId: "phase34.backup_upload_failure_smoke",
    failure: "backup_upload_redaction_missing",
  });
  runCase(checks, "Docs command evidence requires redaction proof", {
    mutate: (evidence) => {
      delete evidence["dist/ci/docs-command-check.json"].redaction;
    },
    gateId: "phase35.docs_command_check",
    failure: "docs_command_check_redaction_missing",
  });
  runCase(checks, "Docs command evidence requires markdown link proof", {
    mutate: (evidence) => {
      const docs = evidence["dist/ci/docs-command-check.json"];
      docs.checks = docs.checks.filter(
        (check) => check !== "documented_markdown_links_resolve",
      );
    },
    gateId: "phase35.docs_command_check",
    failure: "docs_command_check_markdown_links_missing",
  });
  runCase(checks, "Docs command evidence requires command classification", {
    mutate: (evidence) => {
      const docs = evidence["dist/ci/docs-command-check.json"];
      docs.checks = docs.checks.filter(
        (check) => check !== "documented_commands_classified",
      );
      delete docs.commandPosture;
    },
    gateId: "phase35.docs_command_check",
    failure: "docs_command_check_command_classification_missing",
  });
  runCase(checks, "Native OpenAPI coverage requires default mode", {
    mutate: (evidence) => {
      evidence[
        "dist/ci/openapi-route-coverage.json"
      ].configuration.openWebUiCompatibilityEnabled = true;
    },
    gateId: "phase22.openapi_route_coverage",
    failure: "openapi_route_coverage_mode_mismatch",
  });
  runCase(checks, "Bridge OpenAPI coverage requires zero uncovered routes", {
    mutate: (evidence) => {
      const coverage =
        evidence["dist/ci/openapi-route-coverage-openwebui.json"];
      coverage.stats.uncoveredRoutes = 1;
      coverage.stats.coveredRoutes = coverage.stats.publicApiV1Routes - 1;
    },
    gateId: "phase22.openapi_route_coverage",
    failure: "openapi_route_coverage_uncovered_routes",
  });
  runCase(
    checks,
    "Bridge OpenAPI coverage compares operations to unique route keys",
    {
      mutate: (evidence) => {
        const coverage =
          evidence["dist/ci/openapi-route-coverage-openwebui.json"];
        coverage.stats.openApiOperations =
          coverage.stats.publicApiV1RouteKeys - 1;
      },
      gateId: "phase22.openapi_route_coverage",
      failure: "openapi_route_coverage_operation_count_mismatch",
    },
  );
  runCase(checks, "OpenAPI route keys cannot exceed route registrations", {
    mutate: (evidence) => {
      const coverage = evidence["dist/ci/openapi-route-coverage.json"];
      coverage.stats.publicApiV1RouteKeys =
        coverage.stats.publicApiV1Routes + 1;
    },
    gateId: "phase22.openapi_route_coverage",
    failure: "openapi_route_coverage_route_keys_exceed_routes",
  });
  runCase(checks, "OpenAPI coverage requires redaction proof", {
    mutate: (evidence) => {
      evidence[
        "dist/ci/openapi-route-coverage.json"
      ].redaction.routeHandlerSourceReturned = true;
    },
    gateId: "phase22.openapi_route_coverage",
    failure: "openapi_route_coverage_redaction_missing",
  });
  runCase(checks, "Identity contracts require full provider catalog", {
    mutate: (evidence) => {
      const acceptance =
        evidence["dist/ci/auth-provider-acceptance-contract-smoke.json"];
      acceptance.catalog.providerIds = acceptance.catalog.providerIds.filter(
        (providerId) => providerId !== "saml",
      );
    },
    gateId: "phase23.enterprise_identity_contracts",
    failure: "auth_provider_acceptance_missing_provider:saml",
  });
  runCase(checks, "Identity contracts require directory credential cleanup", {
    mutate: (evidence) => {
      evidence[
        "dist/ci/directory-sync-contract-smoke.json"
      ].apply.sessionRevoked = false;
    },
    gateId: "phase23.enterprise_identity_contracts",
    failure: "directory_sync_credentials_not_revoked",
  });
  runCase(checks, "Identity contracts require SCIM group grant cleanup", {
    mutate: (evidence) => {
      evidence[
        "dist/ci/scim-lifecycle-contract-smoke.json"
      ].lifecycle.grantRevoked = false;
    },
    gateId: "phase23.enterprise_identity_contracts",
    failure: "scim_lifecycle_cleanup_invalid",
  });
  runCase(checks, "Identity contracts require redaction proof", {
    mutate: (evidence) => {
      evidence[
        "dist/ci/auth-provider-acceptance-contract-smoke.json"
      ].redaction.rawSecretRefsReturned = true;
    },
    gateId: "phase23.enterprise_identity_contracts",
    failure: "auth_provider_acceptance_redaction_missing",
  });
  runCase(checks, "Backend capability contracts require analytics scopes", {
    mutate: (evidence) => {
      evidence[
        "dist/ci/analytics-authz-contract-smoke.json"
      ].authorization.adminWithoutUsageStatus = 200;
    },
    gateId: "phase32.backend_capability_contracts",
    failure: "analytics_authz_authorization_missing",
  });
  runCase(checks, "Backend capability contracts require connector DNS denial", {
    mutate: (evidence) => {
      evidence[
        "dist/ci/data-connector-acceptance-contract-smoke.json"
      ].authorizationAndRuntime.privateDnsFetchAttemptCount = 1;
    },
    gateId: "phase32.backend_capability_contracts",
    failure: "data_connector_private_dns_not_blocked",
  });
  runCase(
    checks,
    "Backend capability contracts require tool dispatch private DNS denial",
    {
      mutate: (evidence) => {
        evidence[
          "dist/ci/tool-dispatch-acceptance-contract-smoke.json"
        ].worker.privateDnsFetchAttemptCount = 1;
      },
      gateId: "phase32.backend_capability_contracts",
      failure: "tool_dispatch_worker_contract_invalid",
    },
  );
  runCase(
    checks,
    "Backend capability contracts require tool dispatch redaction",
    {
      mutate: (evidence) => {
        evidence[
          "dist/ci/tool-dispatch-acceptance-contract-smoke.json"
        ].redaction.secretValuesReturned = true;
      },
      gateId: "phase32.backend_capability_contracts",
      failure: "tool_dispatch_acceptance_redaction_missing",
    },
  );
  runCase(
    checks,
    "Backend capability contracts require MCP tool-dispatch envelope evidence",
    {
      mutate: (evidence) => {
        evidence[
          "dist/ci/tool-dispatch-acceptance-contract-smoke.json"
        ].mcp.streamableHttpEnvelopeVerified = false;
      },
      gateId: "phase32.backend_capability_contracts",
      failure: "tool_dispatch_mcp_contract_invalid",
    },
  );
  runCase(
    checks,
    "Backend capability contracts require model tool dispatch resume",
    {
      mutate: (evidence) => {
        evidence[
          "dist/ci/model-tool-orchestration-contract-smoke.json"
        ].dispatch.waitingDispatchEventCount = 0;
      },
      gateId: "phase32.backend_capability_contracts",
      failure: "model_tool_dispatch_contract_invalid",
    },
  );
  runCase(checks, "Backend capability contracts require model tool redaction", {
    mutate: (evidence) => {
      evidence[
        "dist/ci/model-tool-orchestration-contract-smoke.json"
      ].redaction.rawProviderCallIdsReturned = true;
    },
    gateId: "phase32.backend_capability_contracts",
    failure: "model_tool_orchestration_redaction_missing",
  });
  runCase(checks, "Backend capability contracts require RAG vector filtering", {
    mutate: (evidence) => {
      evidence[
        "dist/ci/rag-vector-enterprise-contract-smoke.json"
      ].externalVector.crossTenantHitsReturned = 1;
    },
    gateId: "phase32.backend_capability_contracts",
    failure: "rag_vector_external_contract_invalid",
  });
  runCase(
    checks,
    "Backend capability contracts require voice artifact delete",
    {
      mutate: (evidence) => {
        evidence[
          "dist/ci/voice-provider-acceptance-contract-smoke.json"
        ].artifacts.deleted = false;
      },
      gateId: "phase32.backend_capability_contracts",
      failure: "voice_artifact_contract_invalid",
    },
  );
  runCase(
    checks,
    "Backend capability contracts require voice provider failure redaction",
    {
      mutate: (evidence) => {
        evidence[
          "dist/ci/voice-provider-acceptance-contract-smoke.json"
        ].redaction.rawProviderResponseReturned = true;
      },
      gateId: "phase32.backend_capability_contracts",
      failure: "voice_provider_acceptance_redaction_missing",
    },
  );
  runCase(
    checks,
    "Backend capability contracts require notification policy suppression",
    {
      mutate: (evidence) => {
        evidence[
          "dist/ci/notification-adapter-acceptance-contract-smoke.json"
        ].channelLifecycle.policySuppressedDeliveryCount = 0;
      },
      gateId: "phase32.backend_capability_contracts",
      failure: "notification_channel_lifecycle_contract_invalid",
    },
  );
  runCase(
    checks,
    "Backend capability contracts require notification redaction proof",
    {
      mutate: (evidence) => {
        evidence[
          "dist/ci/notification-adapter-acceptance-contract-smoke.json"
        ].redaction.rawSecretRefsReturned = true;
      },
      gateId: "phase32.backend_capability_contracts",
      failure: "notification_adapter_acceptance_redaction_missing",
    },
  );
  runCase(
    checks,
    "Backend capability contracts require native client scope denial",
    {
      mutate: (evidence) => {
        evidence["dist/ci/native-client-api-contract-smoke.json"].checks =
          evidence[
            "dist/ci/native-client-api-contract-smoke.json"
          ].checks.filter(
            (check) => check !== "device_authorization_scope_escalation_denied",
          );
      },
      gateId: "phase32.backend_capability_contracts",
      failure:
        "native_client_api_contract_missing_check:device_authorization_scope_escalation_denied",
    },
  );
  runCase(
    checks,
    "Backend capability contracts require native client redaction proof",
    {
      mutate: (evidence) => {
        evidence[
          "dist/ci/native-client-api-contract-smoke.json"
        ].redaction.rawRefreshTokensReturned = true;
      },
      gateId: "phase32.backend_capability_contracts",
      failure: "native_client_api_contract_redaction_missing",
    },
  );
  runCase(
    checks,
    "Backend capability contracts require browser artifact cleanup",
    {
      mutate: (evidence) => {
        evidence[
          "dist/ci/browser-automation-contract-smoke.json"
        ].artifacts.retentionDeletedCount = 0;
      },
      gateId: "phase32.backend_capability_contracts",
      failure: "browser_automation_retention_cleanup_missing",
    },
  );
  runCase(checks, "Backend capability contracts require redaction proof", {
    mutate: (evidence) => {
      evidence[
        "dist/ci/data-connector-acceptance-contract-smoke.json"
      ].redaction.rawTokensReturned = true;
    },
    gateId: "phase32.backend_capability_contracts",
    failure: "data_connector_acceptance_redaction_missing",
  });
  runCase(checks, "Data-rights retention requires passed log evidence", {
    mutate: (evidence) => {
      evidence[
        "dist/ci/data-rights-retention-contract-smoke.json"
      ].generatedEvidence.operationalLogs.destructionValidated = false;
    },
    gateId: "phase33.data_rights_retention_contract",
    failure: "data_rights_operational_log_evidence_invalid",
  });
  runCase(checks, "Data-rights retention requires CLI rejection cases", {
    mutate: (evidence) => {
      evidence[
        "dist/ci/data-rights-retention-contract-smoke.json"
      ].rejectedCases = evidence[
        "dist/ci/data-rights-retention-contract-smoke.json"
      ].rejectedCases.filter((item) => item.id !== "invalid_control_rejected");
    },
    gateId: "phase33.data_rights_retention_contract",
    failure: "data_rights_invalid_cli_case_missing:invalid_control_rejected",
  });
  runCase(checks, "Data-rights retention requires redaction proof", {
    mutate: (evidence) => {
      evidence[
        "dist/ci/data-rights-retention-contract-smoke.json"
      ].redaction.rawEvidencePathsReturned = true;
    },
    gateId: "phase33.data_rights_retention_contract",
    failure: "data_rights_retention_redaction_missing",
  });

  writeJson(outputPath, {
    schemaVersion: "romeo.ga-evidence-contract-smoke.v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    checks,
    notes: [
      "uses_temporary_synthetic_evidence_root_only",
      "does_not_replace_live_kubernetes_release_alert_or_load_soak_evidence",
    ],
  });
  process.stdout.write(`Wrote GA evidence contract smoke to ${outputPath}.\n`);
} finally {
  rmSync(tempRoot, { force: true, recursive: true });
}

function fullProductEnterpriseTargetFlags() {
  return [
    "qdrantLiveRequired",
    "qdrantDrRequired",
    "ciGovernanceLiveRequired",
    "kedaRequired",
    "browserAutomationRequired",
    "identityLiveRequired",
    "dataConnectorLiveRequired",
    "toolDispatchLiveRequired",
    "voiceProviderLiveRequired",
    "notificationAdapterLiveRequired",
    "analyticsAuthzLiveRequired",
    "targetQualityVectorComparisonRequired",
    "dataRightsRetentionLiveRequired",
    "billingOperationsLiveRequired",
    "auditIntegrityLiveRequired",
    "tenantPurgeLiveRequired",
    "supportBundleLiveRequired",
    "targetResilienceDrillsRequired",
    "postgresOperationsLiveRequired",
  ];
}

function fullProductEnterpriseGateIds() {
  return [
    "phase21.kubernetes_keda_scaler",
    "phase22.ci_governance_live",
    "phase23.identity_live",
    "phase31.browser_automation_live_runner",
    "phase31.data_connector_live_worker",
    "phase25.tool_dispatch_live_worker",
    "phase32.analytics_authz_live",
    "phase32.voice_provider_live",
    "phase32.notification_adapter_live",
    "phase32.qdrant_live_evidence",
    "phase32.qdrant_dr_consistency",
    "phase33.data_rights_retention_live",
    "phase33.billing_operations_live",
    "phase33.audit_integrity_live",
    "phase33.tenant_purge_live",
    "phase34.target_resilience_drills",
    "phase34.postgres_operations_live",
    "phase35.support_bundle_live",
  ];
}

function runCase(checks, name, options) {
  const evidence = validEvidence();
  options.mutate?.(evidence);
  const root = join(tempRoot, slug(name));
  writeEvidenceSet(root, evidence);
  const checklist = runChecklist(root, options.checklistArgs ?? []);
  if (options.assert !== undefined) {
    try {
      options.assert(checklist);
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)} First blockers: ${JSON.stringify(
          (checklist.blockers ?? []).slice(0, 5),
        )} Blocked gates: ${JSON.stringify(
          (checklist.gates ?? [])
            .filter((gate) => gate.status === "blocked")
            .slice(0, 5),
        )}`,
      );
    }
  } else {
    assertGateFailure(checklist, options.gateId, options.failure);
  }
  checks.push({
    name,
    status: "passed",
    checklistStatus: checklist.status,
    ...(options.gateId === undefined ? {} : { gateId: options.gateId }),
    ...(options.failure === undefined
      ? {}
      : { expectedFailure: options.failure }),
  });
}

function runExceptionRedactionCase(checks) {
  const name = "GA exception evidence is metadata-only";
  const evidence = validEvidence();
  delete evidence["dist/ci/docs-command-check.json"];
  const root = join(tempRoot, slug(name));
  writeEvidenceSet(root, evidence);
  const exceptionsPath = join(root, "ga-exceptions.json");
  const rawValues = [
    "raw_exception_owner_sentinel@example.com",
    "raw_exception_approver_sentinel@example.com",
    "RAW_EXCEPTION_RATIONALE_SENTINEL",
    "RAW_EXCEPTION_RISK_SENTINEL",
  ];
  writeJson(exceptionsPath, {
    schemaVersion: "romeo.ga-exceptions.v1",
    exceptions: [
      {
        gateId: "phase35.docs_command_check",
        owner: rawValues[0],
        approvedBy: rawValues[1],
        expiresAt: "2099-01-01T00:00:00.000Z",
        rationale: rawValues[2],
        riskAcceptance: rawValues[3],
      },
    ],
  });
  const checklist = runChecklist(root, ["--exceptions-file", exceptionsPath]);
  const docsGate = checklist.gates.find(
    (gate) => gate.id === "phase35.docs_command_check",
  );
  if (docsGate?.status !== "excepted") {
    throw new Error(
      `Expected docs command gate to be excepted, got ${docsGate?.status}.`,
    );
  }
  const serialized = JSON.stringify(checklist);
  for (const value of rawValues) {
    if (serialized.includes(value)) {
      throw new Error(`GA checklist leaked raw exception value: ${value}`);
    }
  }
  if (checklist.exceptions?.[0]?.status !== "valid") {
    throw new Error("Expected sanitized valid exception summary.");
  }
  if (checklist.exceptions[0].gateId !== "phase35.docs_command_check") {
    throw new Error("Expected sanitized exception gate id.");
  }
  if (checklist.exceptions[0].seniorApproval !== false) {
    throw new Error("Expected sanitized senior approval posture.");
  }
  checks.push({
    name,
    status: "passed",
    checklistStatus: checklist.status,
    gateId: "phase35.docs_command_check",
  });
}

function runChecklist(root, extraArgs = []) {
  const output = join(root, "ga-checklist.json");
  const result = spawnSync(
    process.execPath,
    [
      join(repoRoot, "scripts/generate-ga-checklist.mjs"),
      "--evidence-root",
      root,
      "--output",
      output,
      ...extraArgs,
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(
      [
        "GA checklist command failed.",
        result.error?.message,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return JSON.parse(readFileSync(output, "utf8"));
}

function fullProductEnterpriseEvidence() {
  return {
    "dist/ci/identity-live-evidence.json": validIdentityLiveEvidence(),
    "dist/ci/analytics-authz-live-evidence.json":
      validAnalyticsAuthzLiveEvidence(),
    "dist/ci/data-connector-live-evidence.json":
      validDataConnectorLiveEvidence(),
    "dist/ci/tool-dispatch-live-evidence.json": validToolDispatchLiveEvidence(),
    "dist/ci/voice-provider-live-evidence.json":
      validVoiceProviderLiveEvidence(),
    "dist/ci/browser-automation-live-evidence.json":
      validBrowserAutomationLiveEvidence(),
    "dist/ci/data-rights-operational-log-retention-evidence.json":
      validDataRightsRetentionEvidence("operational_logs"),
    "dist/ci/data-rights-backup-retention-evidence.json":
      validDataRightsRetentionEvidence("backups"),
    "dist/ci/billing-operations-evidence.json":
      validBillingOperationsEvidence(),
    "dist/ci/audit-integrity-evidence.json": validAuditIntegrityEvidence(),
    ...validTargetResilienceDrillEvidence(),
  };
}

function assertGateFailure(checklist, gateId, expectedFailure) {
  const gate = checklist.gates.find((item) => item.id === gateId);
  if (gate === undefined) throw new Error(`Missing gate ${gateId}.`);
  if (gate.status !== "blocked") {
    throw new Error(`Expected ${gateId} to be blocked, got ${gate.status}.`);
  }
  const failures = gate.evidence.flatMap((item) => item.failures ?? []);
  if (!failures.includes(expectedFailure)) {
    throw new Error(
      `Expected ${gateId} failure ${expectedFailure}; got ${failures.join(", ")}.`,
    );
  }
}

function validEvidence() {
  const liveAlertNames = [
    "RomeoProviderCircuitOpen",
    "RomeoBackgroundJobQueuedLag",
    "RomeoBackgroundJobDeadLetters",
    "RomeoPostgresBackupJobFailed",
  ];
  return {
    "dist/ci/greenfield-baseline-review.json": simple(
      "romeo.greenfield-baseline-review.v1",
    ),
    "dist/ci/postgres-schema-validation.json": simple(
      "romeo.postgres-schema-validation.v1",
    ),
    "dist/ci/repository-conformance.json": simple(
      "romeo.repository-conformance-coverage.v1",
    ),
    "dist/ci/compose-smoke.json": validComposeSmoke(),
    "dist/ci/compose-workers-smoke.json": validComposeWorkersSmoke(),
    "dist/ci/compose-backup-restore-smoke.json":
      validComposeBackupRestoreSmoke(),
    "dist/ci/kubernetes-render-smoke.json": validKubernetesRenderSmoke(),
    "dist/ci/openapi-route-coverage.json": validOpenApiRouteCoverage(false),
    "dist/ci/openapi-route-coverage-openwebui.json":
      validOpenApiRouteCoverage(true),
    "dist/ci/branch-protection-plan.json": validBranchProtectionPlan(),
    "dist/ci/hosted-ci-run-verification.json": validHostedCiRunVerification(),
    "dist/ci/branch-protection-verification.json":
      validBranchProtectionVerification(),
    "dist/ci/auth-provider-acceptance-contract-smoke.json":
      validAuthProviderAcceptance(),
    "dist/ci/directory-sync-contract-smoke.json": validDirectorySyncContract(),
    "dist/ci/scim-lifecycle-contract-smoke.json": validScimLifecycleContract(),
    "dist/ci/analytics-authz-contract-smoke.json": validAnalyticsAuthz(),
    "dist/ci/data-connector-acceptance-contract-smoke.json":
      validDataConnectorAcceptance(),
    "dist/ci/tool-dispatch-acceptance-contract-smoke.json":
      validToolDispatchAcceptance(),
    "dist/ci/model-tool-orchestration-contract-smoke.json":
      validModelToolOrchestration(),
    "dist/ci/rag-vector-enterprise-contract-smoke.json":
      validRagVectorEnterpriseContract(),
    "dist/ci/voice-provider-acceptance-contract-smoke.json":
      validVoiceProviderAcceptance(),
    "dist/ci/notification-adapter-acceptance-contract-smoke.json":
      validNotificationAdapterAcceptance(),
    "dist/ci/notification-adapter-live-evidence.json":
      validNotificationAdapterLiveEvidence(),
    "dist/ci/native-client-api-contract-smoke.json":
      validNativeClientApiContract(),
    "dist/ci/browser-automation-contract-smoke.json":
      validBrowserAutomationContract(),
    "dist/ci/data-rights-retention-contract-smoke.json":
      validDataRightsRetentionContract(),
    "dist/ci/tenant-purge-evidence.json": validTenantPurgeEvidence(),
    "dist/ci/support-bundle.json": validSupportBundle(),
    "dist/ci/kubernetes-live-smoke.json": validKubernetesLiveSmoke(),
    "dist/ci/kubernetes-workers-smoke.json": validKubernetesWorkersSmoke(),
    "dist/ci/kubernetes-networkpolicy-smoke.json":
      validKubernetesNetworkPolicySmoke(),
    "dist/ci/kubernetes-keda-smoke.json": validKubernetesKedaSmoke(),
    "dist/ci/kubernetes-cloudnativepg-dr.json":
      validKubernetesDrSmoke("cloudnativepg"),
    "dist/ci/kubernetes-external-postgres-dr.json":
      validKubernetesDrSmoke("external-postgres"),
    "dist/release/security-evidence.json": {
      schemaVersion: "romeo.security-evidence.v1",
      status: "pass",
    },
    "dist/release/sbom.cdx.json": { bomFormat: "CycloneDX" },
    "dist/release/release-provenance.json": validReleaseProvenance(),
    "dist/release/release-approval.json": validReleaseApproval(),
    "dist/release/readback-validation.json": validReleaseReadbackValidation(),
    "dist/ci/target-quality-evidence.json": validTargetQualityEvidence(),
    "dist/ci/tenant-isolation-negative-suite.json":
      validTenantIsolationNegativeSuite(),
    "dist/ci/kubernetes-tiered-rag-smoke.json": validKubernetesTieredRagSmoke(),
    "dist/ci/qdrant-live-evidence.json": validQdrantLiveEvidence(),
    "dist/ci/qdrant-dr-source.json": validQdrantDrEvidence("prepare-source"),
    "dist/ci/qdrant-dr-restore.json": validQdrantDrEvidence("verify-restore"),
    "dist/ci/qdrant-dr-source-cleanup.json":
      validQdrantDrEvidence("cleanup-source"),
    "dist/ci/live-edge-enforcement.json": validLiveEdgeEnforcement(),
    "dist/ci/provider-resilience-smoke.json": validProviderResilienceSmoke(),
    "dist/ci/job-lag-smoke.json": validJobLagSmoke(),
    "dist/ci/operational-monitoring-validation.json":
      validOperationalMonitoringValidation(),
    "dist/ci/postgres-backup-upload-failure-smoke.json":
      validBackupUploadFailureSmoke(),
    "dist/ci/postgres-query-plan-review.json": validPostgresQueryPlanReview(),
    "dist/ci/postgres-slow-query-telemetry.json":
      validPostgresSlowQueryTelemetry(),
    "dist/ci/postgres-lock-telemetry.json": validPostgresLockTelemetry(),
    "dist/ci/postgres-archival-partitioning-decision.json":
      validPostgresArchivalPartitioningDecision(),
    "dist/ci/live-alert-firing.json": {
      schemaVersion: "romeo.live-alert-firing.v1",
      generatedAt: generatedAtNow(),
      status: "passed",
      mode: "live",
      requiredAlerts: [
        { name: liveAlertNames[0], category: "provider" },
        { name: liveAlertNames[1], category: "queue" },
        { name: liveAlertNames[2], category: "queue" },
        { name: liveAlertNames[3], category: "backup" },
      ],
      prometheus: {
        status: "passed",
        requiredAlertsFiring: liveAlertNames.map((name) => ({ name })),
      },
      alertmanager: { checked: true, status: "passed" },
      redaction: {
        bearerTokensReturned: false,
        rawPrometheusResponseReturned: false,
        rawAlertmanagerResponseReturned: false,
        rawPrometheusUrlReturned: false,
        rawAlertmanagerUrlReturned: false,
        rawAlertPayloadsReturned: false,
      },
    },
    "dist/ci/kubernetes-load-soak.json": {
      schemaVersion: "romeo.kubernetes-load-soak.v1",
      generatedAt: generatedAtNow(),
      status: "passed",
      mode: "live",
      target: {
        deployment: "kubernetes",
        namespace: "romeo-load-soak-contract",
        releaseName: "romeo",
        serviceName: "romeo",
        deploymentName: "romeo",
      },
      tier: "small",
      loadRuns: 2,
      soak: { requestedSeconds: 60, passed: true },
      checks: [
        "cluster_reachable",
        "namespace_readable",
        "deployment_rollout_available",
        "scale_fixture_validation",
        "live_scale_load_repeated",
        "scale_load_evidence_summaries",
        "non_local_scale_tier",
        "soak_duration_observed",
        "pod_inventory_readback",
        "pod_logs_redacted",
      ],
      kubernetes: {
        pods: [
          {
            name: "romeo-0",
            phase: "Running",
            ready: true,
            restarts: 0,
            containers: [
              {
                name: "app",
                ready: true,
                restartCount: 0,
                imageIdConfigured: true,
              },
            ],
          },
        ],
      },
      loadEvidence: [
        {
          runIndex: 1,
          status: "passed",
          mode: "live",
          latencyMs: { count: 4, p95: 25 },
        },
        {
          runIndex: 2,
          status: "passed",
          mode: "live",
          latencyMs: { count: 4, p95: 25 },
        },
      ],
      logRedaction: {
        status: "passed",
        scannedPods: 2,
        apiKeyChecked: true,
        rawFixtureSentinelsChecked: 4,
      },
    },
    "dist/ci/docs-command-check.json": validDocsCommandCheck(),
    "dist/ci/support-bundle-redaction.json": validSupportBundleRedaction(),
  };
}

function validPostgresQueryPlanReview() {
  const categories = ["admin", "audit", "chat", "knowledge", "jobs", "tenant"];
  const checks = Array.from({ length: 21 }, (_, index) => ({
    id: `postgres_query_plan_${index + 1}`,
    category: categories[index % categories.length],
    description: "Synthetic representative query-plan check",
    status: "passed",
    expectedIndexes: [
      {
        name: `idx_synthetic_${index + 1}`,
        present: true,
        usedInObservedPlan: true,
      },
    ],
    observedPlan: {
      rootNodeType: "Index Scan",
      totalCost: 12.34,
      planRows: 10,
      relationCount: 1,
      nodeCount: 1,
      nodes: [{ depth: 0, nodeType: "Index Scan", planRows: 10 }],
    },
  }));
  return {
    schemaVersion: "romeo.postgres-query-plan-review.v1",
    generatedAt: new Date().toISOString(),
    database: { redacted: true },
    status: "passed",
    target: {
      representativeVolume: true,
      deploymentTier: "enterprise",
      postgresMode: "cloudnativepg",
    },
    validation: {
      explainMode: "EXPLAIN FORMAT JSON without ANALYZE",
      rawSqlPersisted: false,
      rawRowContentPersisted: false,
      missingExpectedIndexesFail: true,
      observedIndexUseIsAdvisory: true,
      smallTablePlannerChoicesCanUseSequentialScans: true,
    },
    coverage: {
      checkCount: checks.length,
      categories,
    },
    indexMetadata: [],
    missingExpectedIndexes: [],
    checks,
  };
}

function validPostgresSlowQueryTelemetry() {
  return {
    schemaVersion: "romeo.postgres-slow-query-telemetry.v1",
    generatedAt: new Date().toISOString(),
    database: { redacted: true },
    status: "passed",
    failures: [],
    thresholds: {
      slowThresholdMs: 1000,
      windowMinutes: 60,
    },
    summary: {
      windowMinutes: 60,
      fingerprintCount: 12,
      slowQueryCount: 0,
      totalCalls: 2500,
      maxMeanMs: 123.45,
      tempFileStatementCount: 0,
    },
    validation: postgresTelemetryValidation(),
  };
}

function validPostgresLockTelemetry() {
  return {
    schemaVersion: "romeo.postgres-lock-telemetry.v1",
    generatedAt: new Date().toISOString(),
    database: { redacted: true },
    status: "passed",
    failures: [],
    thresholds: {
      windowMinutes: 60,
      maxBlockedSessions: 0,
      maxDeadlocks: 0,
    },
    summary: {
      windowMinutes: 60,
      blockedSessionMax: 0,
      longestWaitMs: 0,
      deadlockCount: 0,
      lockTypeCounts: {},
    },
    validation: postgresTelemetryValidation(),
  };
}

function validPostgresArchivalPartitioningDecision() {
  return {
    schemaVersion: "romeo.postgres-archival-partitioning-decision.v1",
    generatedAt: new Date().toISOString(),
    database: { redacted: true },
    status: "accepted",
    decision: "no_runtime_partitioning_enabled",
    migrationRequired: false,
    failures: [],
    thresholds: {
      maxTableBytes: 50_000_000_000,
      maxEstimatedRows: 25_000_000,
      maxDeadTupleRatioPercent: 20,
    },
    summary: {
      tableCount: 12,
      tablesOverThresholdCount: 0,
      largestTableBytes: 100_000_000,
      largestEstimatedRows: 100_000,
      totalBytes: 500_000_000,
      totalEstimatedRows: 500_000,
    },
    tables: [],
    validation: {
      rawRowContentPersisted: false,
      rawSqlPersisted: false,
      tableNamesOnly: true,
      rowSamplesPersisted: false,
      migrationGenerated: false,
      explicitAcceptanceRequired: true,
      thresholdConflictsFail: true,
    },
  };
}

function postgresTelemetryValidation() {
  return {
    rawSqlPersisted: false,
    queryTextPersisted: false,
    queryParameterValuesPersisted: false,
    lockStatementsPersisted: false,
    rowDataPersisted: false,
    secretValuesPersisted: false,
  };
}

function validDocsCommandCheck() {
  return {
    schemaVersion: "romeo.docs-command-check.v1",
    status: "passed",
    checks: [
      "documented_markdown_links_resolve",
      "documented_commands_classified",
    ],
    stats: {
      markdownLinksChecked: 24,
      markdownAnchorLinksChecked: 8,
    },
    commandPosture: {
      total: 40,
      classified: 40,
      unclassified: 0,
      categories: {
        assignmentOnly: 1,
        deploymentCommandChecked: 6,
        environmentSpecific: 4,
        nodeScriptChecked: 2,
        operatorShellUtility: 3,
        pnpmBuiltinOrPackageCommand: 1,
        pnpmScriptChecked: 20,
        romeoCliChecked: 1,
        workspaceFilterChecked: 2,
      },
      everyCommandClassified: true,
      rawCommandTextReturned: false,
    },
    redaction: {
      rawMarkdownBodiesReturned: false,
      rawShellCommandTextReturned: false,
      environmentValuesReturned: false,
      secretValuesReturned: false,
    },
  };
}

function validOpenApiRouteCoverage(openWebUiCompatibilityEnabled) {
  const publicApiV1Routes = openWebUiCompatibilityEnabled ? 375 : 323;
  const publicApiV1RouteKeys = openWebUiCompatibilityEnabled
    ? publicApiV1Routes - 2
    : publicApiV1Routes;
  return {
    schemaVersion: "romeo.openapi-route-coverage.v1",
    status: "passed",
    checks: [
      "route_files_scanned",
      "openapi_document_exported",
      "public_api_v1_routes_have_openapi_operations",
    ],
    stats: {
      routeFiles: openWebUiCompatibilityEnabled ? 44 : 43,
      publicApiV1Routes,
      publicApiV1RouteKeys,
      openApiOperations: publicApiV1RouteKeys,
      coveredRoutes: publicApiV1Routes,
      uncoveredRoutes: 0,
    },
    configuration: {
      openWebUiCompatibilityEnabled,
    },
    redaction: {
      routeHandlerSourceReturned: false,
      requestBodiesReturned: false,
      responseBodiesReturned: false,
      secretValuesReturned: false,
    },
  };
}

function validAuthProviderAcceptance() {
  return {
    schemaVersion: "romeo.auth-provider-acceptance-contract-smoke.v1",
    status: "passed",
    checks: [
      "auth_provider_catalog_covers_enterprise_provider_ids",
      "per_provider_oidc_oauth2_ldap_saml_settings_persist",
      "local_managed_secret_ingestion_uses_encrypted_reference",
      "provider_settings_return_sanitized_connection_summaries",
      "provider_connection_tests_return_metadata_only",
      "auth_provider_audit_logs_exclude_raw_identity_config",
    ],
    catalog: {
      providerIds: [
        "active-directory",
        "auth0",
        "azure-ad",
        "generic-oidc",
        "github",
        "google",
        "keycloak",
        "ldap",
        "local",
        "okta",
        "saml",
      ],
      implementedCount: 11,
    },
    connectionTests: {
      statuses: {
        local: "passed",
        keycloak: "passed",
        github: "passed",
        ldap: "passed",
        saml: "passed",
      },
    },
    managedSecrets: {
      localSecretStoredEncrypted: true,
      localSecretValueReturned: false,
    },
    redaction: {
      rawIssuerPathsReturned: false,
      rawClientIdsReturned: false,
      rawSecretRefsReturned: false,
      rawSecretValuesReturned: false,
      rawDirectoryDnsReturned: false,
      rawIdentityGroupsReturned: false,
      rawProviderResponsesReturned: false,
    },
  };
}

function validDirectorySyncContract() {
  return {
    schemaVersion: "romeo.directory-sync-contract-smoke.v1",
    status: "passed",
    checks: [
      "unauthenticated_directory_sync_denied",
      "preview_default_does_not_mutate",
      "apply_requires_confirmation",
      "user_disable_cap_enforced",
      "apply_disables_missing_user",
      "apply_preserves_admin_user_by_default",
      "apply_preserves_current_caller_membership",
      "apply_removes_stale_group_membership",
      "apply_revokes_disabled_user_credentials",
      "metadata_only_directory_sync_audit",
      "raw_directory_values_absent_from_responses_audit_and_evidence",
    ],
    authorization: { unauthenticatedStatus: 401 },
    preview: {
      status: "preview",
      userDisableCount: 1,
      membershipRemovalCount: 1,
    },
    guardrails: {
      missingConfirmationCode: "directory_sync_confirmation_required",
      capExceededCode: "directory_sync_user_disable_limit_exceeded",
    },
    apply: {
      status: "applied",
      adminPreserved: true,
      callerMembershipPreserved: true,
      apiKeyRevoked: true,
      sessionRevoked: true,
    },
    audit: {
      previewAction: "directory_sync.preview",
      applyAction: "directory_sync.apply",
      disableAction: "user.disable",
      schema: "romeo.directory-sync.v1",
    },
    redaction: {
      rawEmailsReturned: false,
      rawNamesReturned: false,
      rawDirectoryReasonReturned: false,
      rawCredentialTokensReturned: false,
      rawGroupNameReturned: false,
    },
  };
}

function validScimLifecycleContract() {
  return {
    schemaVersion: "romeo.scim-lifecycle-contract-smoke.v1",
    status: "passed",
    checks: [
      "scim_disabled_fail_closed",
      "identity_lifecycle_policy_reports_scim_resources",
      "service_provider_config_scim_json_and_patch",
      "resource_types_include_user_and_group",
      "scim_user_create",
      "scim_group_create_with_member",
      "group_principal_grant_seeded",
      "scim_group_delete_returns_204",
      "group_record_removed",
      "group_memberships_removed",
      "group_resource_grants_revoked",
      "deleted_group_readback_returns_scim_404",
      "metadata_only_group_delete_audit",
      "raw_scim_values_absent_from_audit_and_evidence",
    ],
    posture: {
      disabledServiceProviderStatus: 404,
      disabledServiceProviderScimType: "scim_disabled",
      identityLifecycleScim: "enabled",
      supportedResources: ["User", "Group"],
      patchSupported: true,
    },
    lifecycle: {
      seededMemberCount: 1,
      deleteStatus: 204,
      postDeleteMembershipCount: 0,
      grantRevoked: true,
      deletedReadbackStatus: 404,
    },
    audit: {
      action: "scim.group.delete",
      resourceType: "group",
      metadataSchema: "romeo.scim.audit.v1",
      membershipCount: 1,
      revokedGrantCount: 1,
      destructiveDelete: true,
    },
    redaction: {
      rawEmailReturned: false,
      rawDisplayNameReturned: false,
      rawGivenNameReturned: false,
      rawFamilyNameReturned: false,
      rawGrantIdReturned: false,
    },
  };
}

function validAnalyticsAuthz() {
  return {
    schemaVersion: "romeo.analytics-authz-contract-smoke.v1",
    status: "passed",
    checks: [
      "unauthenticated_admin_analytics_denied",
      "usage_scope_without_admin_denied",
      "admin_scope_without_usage_denied",
      "minimal_admin_analytics_json_read",
      "minimal_admin_analytics_csv_read",
      "eval_evidence_requires_agent_read",
      "eval_evidence_redaction_flags",
      "raw_analytics_and_eval_content_absent",
      "api_tokens_not_retained",
    ],
    authorization: {
      unauthenticatedAnalyticsStatus: 401,
      usageWithoutAdminStatus: 403,
      adminWithoutUsageStatus: 403,
      evalWithoutAgentReadStatus: 403,
    },
    readback: {
      evalReleaseGateStatus: "passed",
      evalSuiteCount: 1,
      usageEventCount: 1,
      csvBytes: 518,
      csvSha256:
        "9f11053f52e18bdc8c569ef6c6baca812f30f811d632fc1fc66b093d937131cd",
      evalEvidenceGateStatus: "passed",
    },
    redaction: {
      rawAnalyticsJsonReturned: false,
      rawAnalyticsCsvReturned: false,
      rawEvalEvidenceReturned: false,
      rawApiTokensReturned: false,
    },
  };
}

function validIdentityLiveEvidence() {
  return {
    schemaVersion: "romeo.identity-live-evidence.v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    mode: "live",
    deployment: "kubernetes",
    checks: [
      "managed_secret_backend_live",
      "configured_idp_login_live",
      "directory_lookup_live",
      "group_mapping_validation_live",
      "directory_sync_preview_live",
      "directory_sync_apply_live",
      "deprovision_or_scim_lifecycle_live",
      "access_review_readback",
      "identity_log_redaction",
      "identity_evidence_redaction_reviewed",
    ],
    identityProviders: {
      configuredProviderCount: 2,
      liveLoginProviderCount: 2,
      oidcProviderCount: 1,
      oauth2ProviderCount: 0,
      ldapProviderCount: 1,
      samlProviderCount: 0,
      localFallbackVerified: true,
      mfaFallbackVerified: true,
    },
    secretBackends: {
      managedSecretBackendCount: 1,
      vaultSecretWriteCount: 1,
      externalSecretReferenceCount: 1,
      secretResolutionCheckCount: 1,
    },
    directory: {
      directoryProviderCount: 1,
      directoryLookupCount: 1,
      mappedGroupCount: 1,
      workspaceMappingCount: 1,
      directorySyncPreviewChangeCount: 1,
      directorySyncAppliedChangeCount: 1,
      policyViolationCount: 0,
    },
    lifecycle: {
      deprovisionedUserCount: 1,
      scimUserLifecycleCount: 1,
      scimGroupLifecycleCount: 1,
      disabledUserCount: 1,
      revokedSessionCount: 1,
    },
    accessReview: {
      checked: true,
      reportUserCount: 1,
      reportGroupCount: 1,
      reportGrantCount: 1,
      exportedCsv: true,
    },
    failures: [],
    redaction: {
      evidenceFileBodiesReturned: false,
      rawDirectoryEntriesReturned: false,
      rawEmailAddressesReturned: false,
      rawEvidencePathsReturned: false,
      rawGroupNamesReturned: false,
      rawIdpResponsesReturned: false,
      rawLdapDnsReturned: false,
      rawProviderEndpointsReturned: false,
      rawSamlAssertionsReturned: false,
      rawSecretRefsReturned: false,
      secretValuesReturned: false,
      tokenValuesReturned: false,
    },
  };
}

function validAnalyticsAuthzLiveEvidence() {
  return {
    schemaVersion: "romeo.analytics-authz-live-evidence.v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    mode: "live",
    deployment: "kubernetes",
    checks: [
      "admin_summary_readback",
      "admin_csv_export_readback",
      "usage_scope_enforced",
      "eval_evidence_resource_grant_enforced",
      "non_admin_summary_denied",
      "non_admin_csv_denied",
      "cross_org_summary_denied",
      "cross_workspace_export_scoped",
      "csv_export_hash_recorded",
      "raw_analytics_content_absent",
      "analytics_log_redaction",
      "analytics_evidence_redaction_reviewed",
    ],
    subjects: {
      adminSubjectCount: 1,
      orgAdminSubjectCount: 1,
      nonAdminSubjectCount: 1,
      serviceAccountSubjectCount: 1,
      crossOrgSubjectCount: 1,
    },
    authorization: {
      adminSummaryAllowedCount: 1,
      adminCsvAllowedCount: 1,
      nonAdminSummaryDeniedCount: 1,
      nonAdminCsvDeniedCount: 1,
      missingUsageScopeDeniedCount: 1,
      evalGrantDeniedCount: 1,
      crossOrgDeniedCount: 1,
      crossWorkspaceScopedCount: 1,
    },
    analytics: {
      summaryReadCount: 1,
      csvExportReadCount: 1,
      evalEvidenceReadCount: 1,
      csvSha256Count: 1,
      usageMetricCount: 1,
      evalSuiteCount: 1,
      jobSummaryCount: 1,
      providerSummaryCount: 1,
    },
    failures: [],
    redaction: {
      apiKeysReturned: false,
      evidenceFileBodiesReturned: false,
      rawAnalyticsCsvRowsReturned: false,
      rawEvalInputsReturned: false,
      rawEvalOutputsReturned: false,
      rawEvidencePathsReturned: false,
      rawHumanRatingCommentsReturned: false,
      rawJobPayloadsReturned: false,
      rawOrgNamesReturned: false,
      rawProviderConfigReturned: false,
      rawSecretRefsReturned: false,
      rawToolInputsReturned: false,
      rawUsageMetadataReturned: false,
      rawUserEmailsReturned: false,
      rawWorkspaceNamesReturned: false,
      secretValuesReturned: false,
      tokenValuesReturned: false,
    },
  };
}

function validDataConnectorAcceptance() {
  return {
    schemaVersion: "romeo.data-connector-acceptance-contract-smoke.v1",
    status: "passed",
    checks: [
      "catalog_covers_supported_connector_types",
      "catalog_exposes_runtime_and_credential_posture",
      "catalog_omits_allowed_hosts_endpoints_tokens_and_credentials",
      "managed_creation_fails_closed_when_driver_disabled",
      "runtime_blocked_creation_does_not_persist_connector",
      "managed_creation_fails_closed_when_required_allowlist_missing",
      "github_secret_ref_and_delegated_oauth_are_mutually_exclusive",
      "local_import_remains_available_without_outbound_runtime",
      "website_dns_private_address_denied_before_fetch",
      "connector_acceptance_evidence_omits_raw_config_and_content",
    ],
    catalog: {
      connectorTypes: [
        "confluence",
        "github",
        "jira",
        "linear",
        "local_import",
        "notion",
        "rss",
        "s3",
        "slack",
        "website",
      ],
      executionDriver: "managed-fetch",
      egressPolicy: "require_allowlist",
      allowedHostRuleCount: 2,
      secretResolver: {
        driver: "env",
        managedSecretConfigured: true,
        externalValueResolverConfigured: true,
      },
    },
    authorizationAndRuntime: {
      blockedCreationStatus: 409,
      blockedCreationCode: "connector_runtime_not_configured",
      persistedAfterBlockedCreation: false,
      credentialConflictStatus: 400,
      credentialConflictCode: "invalid_connector_config",
      failClosedAllowlistStatus: 409,
      failClosedAllowlistCode: "connector_runtime_not_configured",
      localImportCreationStatus: 201,
      localImportSyncStatus: "completed",
      privateDnsCreationStatus: 201,
      privateDnsSyncStatus: 403,
      privateDnsSyncCode: "connector_private_network_host_blocked",
      privateDnsFetchAttemptCount: 0,
      confluenceCreationStatus: 201,
      confluenceSyncStatus: "completed",
      jiraCreationStatus: 201,
      jiraSyncStatus: "completed",
      notionCreationStatus: 201,
      notionSyncStatus: "completed",
      linearCreationStatus: 201,
      linearSyncStatus: "completed",
      slackCreationStatus: 201,
      slackSyncStatus: "completed",
    },
    redaction: {
      rawAllowedHostsReturned: false,
      rawEndpointUrlsReturned: false,
      rawAtlassianQueriesReturned: false,
      rawSecretRefsReturned: false,
      rawTokensReturned: false,
      rawConnectorContentReturned: false,
      rawConnectorConfigPersistedInEvidence: false,
    },
  };
}

function validToolDispatchAcceptance() {
  return {
    schemaVersion: "romeo.tool-dispatch-acceptance-contract-smoke.v1",
    status: "passed",
    checks: [
      "disabled_without_payload_source_fails_closed",
      "managed_payload_claim_read_and_complete",
      "mcp_streamable_http_tools_call_envelope",
      "worker_secret_resolution_boundary",
      "private_dns_denied_before_fetch",
      "missing_secret_denied_before_fetch",
      "response_schema_validation_recorded",
      "invalid_response_schema_metadata_only",
      "worker_output_redaction",
      "dispatch_readback_redaction",
    ],
    worker: {
      disabledWithoutPayloadSource: true,
      managedClaimCount: 1,
      managedPayloadReadCount: 1,
      completedCount: 3,
      failedCount: 2,
      privateDnsFetchAttemptCount: 0,
      missingSecretFetchAttemptCount: 0,
    },
    mcp: {
      streamableHttpEnvelopeVerified: true,
      protocolHeadersVerified: true,
      callCount: 1,
      outputRedacted: true,
    },
    secrets: {
      secretResolutionVerified: true,
      secretResolverBoundaryVerified: true,
      missingSecretDeniedBeforeFetch: true,
      secretResolutionCount: 1,
    },
    responseValidation: {
      passedSchemaValidationCount: 1,
      failedSchemaValidationCount: 1,
      invalidResponseMetadataOnly: true,
    },
    redaction: {
      rawObjectStoreKeysReturned: false,
      rawPayloadValuesReturned: false,
      rawResponseBodiesReturned: false,
      rawSecretRefsReturned: false,
      secretValuesReturned: false,
    },
  };
}

function validModelToolOrchestration() {
  return {
    schemaVersion: "romeo.model-tool-orchestration-contract-smoke.v1",
    status: "passed",
    checks: [
      "openai_chat_tool_call_normalizes_and_continues",
      "tool_schema_injection_authorized_for_builtin",
      "run_events_omit_provider_call_ids_and_arguments",
      "imported_operation_dispatch_waits_and_resumes",
      "worker_readback_continuation_uses_dispatch_job_id",
      "managed_dispatch_payload_is_encrypted_and_redacted",
      "approval_wait_reject_terminalizes_without_replay",
      "pending_approval_readback_is_metadata_only",
      "model_tool_evidence_omits_raw_values",
    ],
    inline: {
      completedRun: true,
      providerRequestCount: 2,
      runContinuingEventCount: 0,
      toolCompletedEventCount: 1,
      toolSchemaInjected: true,
    },
    dispatch: {
      completedRun: true,
      dispatchJobIdInContinuation: true,
      providerRequestCount: 2,
      waitingDispatchEventCount: 1,
      workerReadbackOutcome: "completed",
    },
    managedPayload: {
      encryptedObjectWritten: true,
      encryptedPayloadRedacted: true,
      eventObjectKeyRedacted: true,
      payloadStorage: "managed_encrypted_object_store",
    },
    approval: {
      pendingApprovalRedacted: true,
      providerContinuationCount: 0,
      rejectedApprovalRemoved: true,
      runCancelled: true,
    },
    redaction: {
      rawManagedObjectKeysReturned: false,
      rawOperationPayloadsReturned: false,
      rawProviderCallIdsReturned: false,
      rawToolArgumentsReturned: false,
      rawToolResultsReturned: false,
    },
  };
}

function validRagVectorEnterpriseContract() {
  return {
    schemaVersion: "romeo.rag-vector-enterprise-contract-smoke.v1",
    status: "passed",
    checks: [
      "me_exposes_single_tenancy_mode",
      "default_rag_policy_uses_pgvector_shared_row_scope",
      "tiered_rag_user_workspace_org_shared_hits",
      "denied_corpus_skipped_without_id_or_content_leak",
      "tiered_rag_audit_is_metadata_only",
      "rag_policy_exposes_external_vector_and_physical_isolation_controls",
      "physical_vector_isolation_required_mismatch_warns",
      "qdrant_posture_is_sanitized_and_deployment_managed",
      "qdrant_upsert_and_query_use_secret_resolver_boundary",
      "qdrant_query_uses_scope_filters_and_postgres_post_filtering",
    ],
    defaultPgvector: {
      tenancyMode: "single",
      vectorDriver: "pgvector",
      isolationMode: "shared_row_scope",
      authorizedTierCount: 4,
      skippedDeniedCount: 1,
      tierCounts: {
        user_private: 1,
        workspace: 1,
        org: 1,
        shared: 1,
      },
      physicalIsolationMismatch: true,
    },
    externalVector: {
      vectorDriver: "qdrant",
      externalVectorStoreDriver: "qdrant",
      externalVectorStoreRoutingActive: true,
      namespacePolicy: "knowledge_base",
      partitioningPolicy: "org",
      qdrantUpsertCount: 1,
      qdrantQueryCount: 1,
      qdrantApiKeyResolved: true,
      crossTenantHitsReturned: 0,
      vectorsReturned: false,
    },
    redaction: {
      rawCorpusReturned: false,
      deniedCorpusIdReturned: false,
      deniedCorpusContentReturned: false,
      qdrantEndpointReturned: false,
      qdrantCollectionReturned: false,
      qdrantSecretRefReturned: false,
      qdrantSecretValueReturned: false,
      crossTenantVectorPayloadReturned: false,
    },
  };
}

function validVoiceProviderAcceptance() {
  return {
    schemaVersion: "romeo.voice-provider-acceptance-contract-smoke.v1",
    status: "passed",
    checks: [
      "disabled_provider_fails_closed",
      "development_provider_catalog_sync_dedupes",
      "development_preview_artifact_readback",
      "voice_artifact_delete_redacts_storage_key",
      "transcription_usage_metadata_redacted",
      "openai_compatible_provider_sync_preview_and_transcribe",
      "provider_failure_response_redacted",
      "voice_acceptance_evidence_omits_raw_text_audio_and_secrets",
    ],
    providerBoundary: {
      disabledPreviewStatus: 409,
      devProviderId: "voice_dev",
      openAiCompatibleProviderId: "voice_openai_compatible",
      providerFamiliesExercised: ["dev", "disabled", "openai-compatible"],
      openAiCompatibleUsesCoreApiWithoutServiceCodeChanges: true,
    },
    catalog: {
      devImportedCount: 1,
      devExistingAfterResync: 1,
      devProviderVoiceCount: 1,
      openAiCompatibleImportedCount: 1,
      duplicateProfilesCreated: false,
    },
    artifacts: {
      contentType: "audio/wav",
      readbackBytes: 44,
      deleted: true,
      deletedReadbackStatus: 404,
      storageKeyHash:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      rawStorageKeyReturned: false,
    },
    transcription: {
      devStatus: 200,
      openAiCompatibleStatus: 200,
      usageAudioBytes: 4,
      usageTextLength: 35,
      promptProvided: true,
    },
    providerFailure: {
      previewStatus: 409,
      errorCode: "voice_not_configured",
      rawProviderBodyReturned: false,
    },
    redaction: {
      rawSpeechTextReturned: false,
      rawTranscriptReturned: false,
      rawPromptReturned: false,
      rawAudioReturned: false,
      rawStorageKeyReturned: false,
      rawProviderResponseReturned: false,
      rawProviderEndpointReturned: false,
      secretValuesReturned: false,
    },
  };
}

function validNotificationAdapterAcceptance() {
  return {
    schemaVersion: "romeo.notification-adapter-acceptance-contract-smoke.v1",
    status: "passed",
    checks: [
      "disabled_sender_fails_closed",
      "configured_adapter_routes_mixed_channel_types",
      "secret_backed_channels_resolve_at_send_time",
      "provider_payloads_use_id_only_notification_context",
      "policy_suppression_creates_disabled_ledgers",
      "retry_due_success_clears_retry_state",
      "retry_due_exhaustion_dead_letters_metadata_only",
      "channel_type_isolation_blocks_wrong_adapter_egress",
      "channel_readback_redacts_destinations_and_secret_refs",
      "delivery_evidence_omits_destinations_bodies_and_secrets",
    ],
    channelLifecycle: {
      createdChannelTypes: [
        "email",
        "mobile_push",
        "pagerduty",
        "slack",
        "teams",
        "webhook",
      ],
      redactedConfigReadbackVerified: true,
      internalConfigRetainedForDelivery: true,
      disabledStatus: "disabled",
      disabledErrorCode: "delivery_adapter_not_configured",
      policySuppressedDeliveryCount: 6,
      policySuppressionAttemptedEgress: false,
    },
    adapterRouting: {
      deliveryCount: 6,
      fetchRequestCount: 6,
      providerCounts: {
        fcm: 1,
        pagerduty: 1,
        slack: 1,
        smtp: 1,
        teams: 1,
        webhook: 1,
      },
      smtpSendMailCount: 1,
      secretResolutionCount: 3,
      pagerDutyRoutingKeyResolved: true,
      fcmDeviceTokenResolved: true,
      fcmAccessTokenUsed: true,
      idOnlyProviderPayloads: true,
      commentBodyInProviderPayloads: false,
    },
    retry: {
      successStatus: "sent",
      successAttemptCount: 2,
      successClearedError: true,
      successClearedRetryState: true,
      deadLetterStatus: "failed",
      deadLetterAttemptCount: 5,
      deadLetterReason: "max_attempts_exhausted",
      rawProviderFailureReturned: false,
    },
    channelTypeIsolation: {
      fetchAttempted: false,
      status: "failed",
      errorCode: "notification_channel_type_unsupported",
    },
    redaction: {
      rawCommentBodyReturned: false,
      rawDestinationReturned: false,
      rawWebhookUrlsReturned: false,
      rawEmailReturned: false,
      rawSecretRefsReturned: false,
      rawSecretValuesReturned: false,
      rawProviderResponseReturned: false,
      rawSmtpCredentialsReturned: false,
      rawFcmCredentialsReturned: false,
    },
  };
}

function validNotificationAdapterLiveEvidence() {
  return {
    schemaVersion: "romeo.notification-adapter-live-evidence.v1",
    status: "passed",
    mode: "live",
    deployment: "kubernetes",
    checks: [
      "live_notification_delivery_verified",
      "mixed_channel_type_delivery_verified",
      "secret_ref_resolution_verified",
      "notification_egress_policy_verified",
      "provider_payload_redaction_verified",
      "channel_type_isolation_verified",
      "retry_and_dead_letter_verified",
      "notification_log_redaction",
      "notification_evidence_redaction_reviewed",
    ],
    delivery: {
      deliveryDriver: "configured",
      attemptedCount: 7,
      successfulCount: 6,
      failedCount: 1,
      providerFamilyCount: 6,
      providerPayloadRedacted: true,
    },
    channels: {
      total: 6,
      webhookCount: 1,
      emailCount: 1,
      slackCount: 1,
      teamsCount: 1,
      pagerDutyCount: 1,
      mobilePushCount: 1,
      mixedChannelTypesVerified: true,
    },
    secrets: {
      secretRefResolutionCount: 3,
      secretResolverBoundaryVerified: true,
    },
    policy: {
      suppressionVerified: true,
      retrySuccessCount: 1,
      deadLetterCount: 1,
      channelTypeIsolationVerified: true,
    },
    egress: {
      networkPolicyEnforced: true,
      hostAllowlistEnforced: true,
      privateNetworkDenied: true,
      providerEndpointAccessVerified: true,
    },
    logRedaction: {
      appLogRedactionVerified: true,
      podLogRedactionVerified: true,
      appLogScanCount: 1,
      podLogScanCount: 1,
      destinationSentinelHitCount: 0,
      bodySentinelHitCount: 0,
      secretSentinelHitCount: 0,
      tokenSentinelHitCount: 0,
    },
    failures: [],
    redaction: {
      rawDestinationsReturned: false,
      rawEndpointUrlsReturned: false,
      rawEvidencePathsReturned: false,
      rawLogLinesReturned: false,
      rawMessageBodiesReturned: false,
      rawProviderResponsesReturned: false,
      rawSecretRefsReturned: false,
      secretValuesReturned: false,
      tokenValuesReturned: false,
    },
  };
}

function validNativeClientApiContract() {
  return {
    schemaVersion: "romeo.native-client-api-contract-smoke.v1",
    status: "passed",
    checks: [
      "device_authorization_create_list_redacts_refresh_hash",
      "device_authorization_scope_escalation_denied",
      "device_authorization_refresh_rotates_and_revokes_old_credentials",
      "device_authorization_refresh_public_route_secure_mode",
      "device_authorization_revoke_invalidates_access_and_refresh",
      "resumable_upload_requires_device_file_scopes_and_redacts_object_keys",
      "resumable_upload_composes_parts_and_cleans_staging",
      "mobile_push_channel_readback_redacts_token_ref",
      "native_client_evidence_omits_tokens_secret_refs_object_keys_and_content",
    ],
    deviceAuthorization: {
      createStatus: 201,
      accessTokenPrefix: "rmk",
      refreshTokenPrefix: "rmr",
      authorizationScopes: ["me:read", "files:read", "files:write"],
      listStatus: 200,
      listCount: 2,
      meStatus: 200,
      subjectApiKeyMatched: true,
      hashedRefreshTokenReturned: false,
      scopeEscalationStatus: 400,
      scopeEscalationErrorCode: "device_authorization_scope_exceeded",
      secureRefreshWithoutAccessStatus: 200,
      rotatedAccessToken: true,
      rotatedRefreshToken: true,
      oldAccessStatus: 403,
      oldRefreshStatus: 403,
      newAccessStatus: 200,
      revokeStatus: 200,
      revokedAccessStatus: 403,
      revokedRefreshStatus: 403,
      postRevokeScopedAccessStatus: 201,
    },
    resumableUpload: {
      createStatus: 201,
      refreshStatus: 200,
      completeStatus: 200,
      contentReadbackStatus: 200,
      createdFileStatus: "uploading",
      completedFileStatus: "available",
      uploadMode: "resumable_backend_composed",
      partCount: 4,
      partSizeBytes: 7,
      maxBytes: 64,
      readbackBytes: 31,
      readbackSha256:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      stagedPartCleanupVerified: true,
      objectKeyReturned: false,
      uploadUrlsPersisted: false,
      rawContentReturned: false,
    },
    mobilePush: {
      createStatus: 201,
      listStatus: 200,
      listCount: 1,
      tokenConfigured: true,
      tokenRefScheme: "env",
      tokenRefReturned: false,
      tokenRefRetainedInternally: true,
      platform: "ios",
      collapseKeyReturned: "romeo-native",
    },
    redaction: {
      rawAccessTokensReturned: false,
      rawRefreshTokensReturned: false,
      hashedRefreshTokensReturned: false,
      rawMobilePushTokenRefsReturned: false,
      rawMobilePushTokenValuesReturned: false,
      objectStoreKeysReturned: false,
      uploadUrlsReturned: false,
      rawFileContentReturned: false,
    },
  };
}

function validBrowserAutomationContract() {
  return {
    schemaVersion: "romeo.browser-automation-contract-smoke.v1",
    status: "passed",
    checks: [
      "browser_task_approval_metadata_redaction",
      "stale_running_browser_task_reclaimed",
      "external_runner_completion",
      "worker_stdout_redaction",
      "worker_stderr_redaction",
      "registered_artifact_readback",
      "browser_artifact_retention_cleanup",
      "retention_metadata_redaction",
    ],
    workflow: {
      finalStatus: "completed",
    },
    worker: {
      firstAttempt: 1,
      reclaimedAttempt: 2,
      output: {
        completedCount: 1,
        failedCount: 0,
      },
    },
    artifacts: {
      registeredCount: 1,
      readbackBytes: 24,
      retentionDeletedCount: 1,
    },
    redaction: {
      approvalReadback: "passed",
      workerStdout: "passed",
      workerStderr: "passed",
      workflowReadback: "passed",
      retentionEvidence: "passed",
    },
  };
}

function validBrowserAutomationLiveEvidence() {
  return {
    schemaVersion: "romeo.browser-automation-live-evidence.v1",
    generatedAt: generatedAtNow(),
    status: "passed",
    mode: "live",
    deployment: "kubernetes",
    checks: [
      "reviewed_runner_sandbox",
      "network_denial_enforced",
      "worker_crash_retry",
      "retention_worker_execution",
      "pod_log_redaction",
    ],
    runnerSandbox: {
      reviewedRunnerSandbox: true,
      isolatedContextPerTask: true,
      runnerProcessIsolated: true,
      targetOriginOnly: true,
    },
    networkDenial: {
      privateNetworkDenied: true,
      cniOrNetworkPolicyDenied: true,
      dnsRebindingDenied: true,
      deniedNetworkCount: 2,
      blockedTargetCount: 2,
    },
    crashRetry: {
      workerCrashRetryVerified: true,
      reclaimedAttempt: 2,
      completedAfterRetry: true,
    },
    retention: {
      workerExecutionVerified: true,
      deletedArtifactCount: 1,
      cleanedJobCount: 1,
    },
    logRedaction: {
      podLogRedactionVerified: true,
      workerLogRedactionVerified: true,
      podLogScanCount: 2,
      workerLogScanCount: 1,
      rawTaskSentinelHitCount: 0,
      rawPageSentinelHitCount: 0,
      secretSentinelHitCount: 0,
    },
    redaction: {
      artifactBytesReturned: false,
      rawEvidencePathsReturned: false,
      rawPageContentReturned: false,
      rawRunnerUrlReturned: false,
      rawTaskTextReturned: false,
      secretValuesReturned: false,
    },
  };
}

function validDataConnectorLiveEvidence() {
  return {
    schemaVersion: "romeo.data-connector-live-evidence.v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    mode: "live",
    deployment: "kubernetes",
    checks: [
      "managed_connector_sync_exercised",
      "worker_cni_egress_enforced",
      "dns_private_address_denied",
      "secret_ref_resolution_verified",
      "worker_crash_retry_or_requeue_verified",
      "sync_log_redaction",
      "sanitized_readback_verified",
    ],
    connectors: {
      managedConnectorTypeCount: 2,
      syncAttemptCount: 3,
      successfulSyncCount: 2,
      failedSyncCount: 0,
      secretRefConnectorCount: 1,
      delegatedOAuthConnectorCount: 1,
      deniedPrivateTargetCount: 1,
    },
    egress: {
      workerCniOrNetworkPolicyEnforced: true,
      allowlistRequired: true,
      privateNetworkDenied: true,
      dnsRebindingDenied: true,
      deniedPrivateNetworkCount: 1,
      allowedExternalHostCount: 1,
    },
    worker: {
      workerExecutionVerified: true,
      crashRetryOrRequeueVerified: true,
      requeuedSyncCount: 1,
      completedAfterRetry: true,
    },
    secrets: {
      secretRefResolutionVerified: true,
      secretResolverBoundaryVerified: true,
      rawSecretValuesReturned: false,
      tokenValuesReturned: false,
    },
    logRedaction: {
      syncLogRedactionVerified: true,
      podLogRedactionVerified: true,
      podLogScanCount: 1,
      workerLogScanCount: 1,
      connectorContentSentinelHitCount: 0,
      secretSentinelHitCount: 0,
      tokenSentinelHitCount: 0,
    },
    readback: {
      adminPostureReadbackVerified: true,
      syncHistoryReadbackVerified: true,
    },
    redaction: {
      rawAllowedHostsReturned: false,
      rawConnectorConfigReturned: false,
      rawConnectorContentReturned: false,
      rawEndpointUrlsReturned: false,
      rawEvidencePathsReturned: false,
      rawLogLinesReturned: false,
      rawSecretRefsReturned: false,
      secretValuesReturned: false,
      tokenValuesReturned: false,
    },
  };
}

function validToolDispatchLiveEvidence() {
  return {
    schemaVersion: "romeo.tool-dispatch-live-evidence.v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    mode: "live",
    deployment: "kubernetes",
    checks: [
      "worker_claim_execution_verified",
      "managed_payload_read_verified",
      "mcp_streamable_http_tools_call_verified",
      "worker_cni_egress_enforced",
      "dns_private_address_denied",
      "secret_resolution_verified",
      "worker_crash_retry_or_reclaim_verified",
      "response_schema_validation_verified",
      "worker_log_redaction",
      "sanitized_readback_verified",
    ],
    operations: {
      dispatchRequestCount: 2,
      completedDispatchCount: 2,
      failedDispatchCount: 0,
      managedPayloadReadCount: 2,
      externalPayloadCount: 0,
      workerClaimExecutionVerified: true,
      managedPayloadReadVerified: true,
    },
    mcp: {
      streamableHttpToolsCallVerified: true,
      protocolHeadersVerified: true,
      jsonRpcEnvelopeVerified: true,
      callCount: 1,
      payloadArgumentsRedacted: true,
      outputRedacted: true,
    },
    egress: {
      workerCniOrNetworkPolicyEnforced: true,
      privateNetworkDenied: true,
      dnsPrivateAddressDenied: true,
      deniedPrivateTargetCount: 1,
      redirectDenied: true,
      httpsOnly: true,
    },
    secrets: {
      secretResolutionVerified: true,
      secretResolverBoundaryVerified: true,
      secretResolutionCount: 1,
      oauthTokenRedactionVerified: true,
      secretValuesReturned: false,
      tokenValuesReturned: false,
    },
    worker: {
      workerCrashRetryOrReclaimVerified: true,
      reclaimedDispatchCount: 1,
      completedAfterReclaim: true,
    },
    responseValidation: {
      responseSchemaValidationVerified: true,
      schemaValidationCount: 1,
      invalidResponseFailedClosed: true,
    },
    logRedaction: {
      workerLogRedactionVerified: true,
      podLogRedactionVerified: true,
      workerLogScanCount: 1,
      podLogScanCount: 1,
      payloadSentinelHitCount: 0,
      responseSentinelHitCount: 0,
      secretSentinelHitCount: 0,
      tokenSentinelHitCount: 0,
    },
    readback: {
      adminPostureReadbackVerified: true,
      dispatchReadbackVerified: true,
    },
    redaction: {
      rawEvidencePathsReturned: false,
      rawLogLinesReturned: false,
      rawObjectStoreKeysReturned: false,
      rawOperationHostsReturned: false,
      rawPayloadValuesReturned: false,
      rawResponseBodiesReturned: false,
      rawSecretRefsReturned: false,
      secretValuesReturned: false,
      tokenValuesReturned: false,
    },
  };
}

function validVoiceProviderLiveEvidence() {
  return {
    schemaVersion: "romeo.voice-provider-live-evidence.v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    mode: "live",
    deployment: "kubernetes",
    checks: [
      "live_tts_preview_verified",
      "live_transcription_verified",
      "voice_artifact_readback_verified",
      "voice_artifact_deletion_verified",
      "streaming_consent_reviewed",
      "provider_failure_redaction_verified",
      "voice_log_redaction",
      "voice_evidence_redaction_reviewed",
    ],
    provider: {
      driver: "openai-compatible",
      catalogSyncCount: 1,
      configuredVoiceCount: 1,
      providerFailureRedacted: true,
      transcriptionRequestCount: 1,
      ttsRequestCount: 1,
    },
    tts: {
      livePreviewVerified: true,
      generatedArtifactCount: 1,
      generatedAudioBytes: 44,
    },
    transcription: {
      liveTranscriptionVerified: true,
      audioBytes: 4,
      promptProvided: true,
      transcriptLength: 24,
    },
    artifacts: {
      readbackVerified: true,
      readbackBytes: 44,
      deleteVerified: true,
      deletedArtifactCount: 1,
    },
    streamingConsent: {
      streamingEnabled: true,
      reviewed: true,
      reviewedPolicyCount: 1,
    },
    logRedaction: {
      appLogRedactionVerified: true,
      podLogRedactionVerified: true,
      appLogScanCount: 1,
      podLogScanCount: 1,
      rawAudioSentinelHitCount: 0,
      rawSpeechTextSentinelHitCount: 0,
      rawTranscriptSentinelHitCount: 0,
      secretSentinelHitCount: 0,
    },
    redaction: {
      rawAudioReturned: false,
      rawEvidencePathsReturned: false,
      rawObjectStoreKeysReturned: false,
      rawProviderEndpointReturned: false,
      rawProviderResponseReturned: false,
      rawSpeechTextReturned: false,
      rawTranscriptTextReturned: false,
      secretValuesReturned: false,
      tokenValuesReturned: false,
    },
  };
}

function validDataRightsRetentionEvidence(control) {
  return {
    schemaVersion: "romeo.data-rights-retention-evidence.v1",
    generatedAt: new Date().toISOString(),
    control,
    status: "passed",
    retentionDays: control === "backups" ? 90 : 30,
    destructionValidated: true,
    encryptedAtRest: true,
    immutableWindowDays: control === "backups" ? 30 : 7,
    reviewedSystemCount: control === "backups" ? 2 : 3,
    failureCodes: [],
    redaction: {
      backupLocationIncluded: false,
      logContentIncluded: false,
      objectStoreKeysIncluded: false,
      rawSystemNamesIncluded: false,
      secretValuesIncluded: false,
    },
  };
}

function validBillingOperationsEvidence() {
  return {
    schemaVersion: "romeo.billing-operations-evidence.v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    mode: "live",
    deployment: "kubernetes",
    checks: [
      "entitlement_reconcile_worker_cadence",
      "billing_lifecycle_worker_cadence",
      "entitlement_api_readback",
      "lifecycle_api_readback",
      "worker_log_redaction",
      "billing_alerting_readback",
    ],
    cadence: {
      windowMinutes: 120,
      expectedRunCount: 2,
      observedRunCount: 2,
      missedRunCount: 0,
    },
    workers: {
      entitlementReconcile: {
        configured: true,
        scheduleConfigured: true,
        lastRunStatus: "passed",
        successCount: 1,
        failureCount: 0,
        alertConfigured: true,
      },
      lifecycleEnforce: {
        configured: true,
        scheduleConfigured: true,
        lastRunStatus: "passed",
        successCount: 1,
        failureCount: 0,
        alertConfigured: true,
      },
    },
    apiReadback: {
      entitlementReportHealthy: true,
      lifecycleReportHealthy: true,
      mismatchCount: 0,
      dueTransitionCount: 0,
    },
    alerting: {
      checked: true,
      status: "passed",
      configuredRuleCount: 2,
      firingRequiredCount: 0,
    },
    failures: [],
    redaction: {
      rawBillingProviderPayloadsReturned: false,
      rawWorkerLogsReturned: false,
      rawApiKeysReturned: false,
      rawAlertPayloadsReturned: false,
      rawCustomerIdentifiersReturned: false,
      rawEvidencePathsReturned: false,
      secretValuesReturned: false,
    },
  };
}

function validAuditIntegrityEvidence() {
  return {
    schemaVersion: "romeo.audit-integrity-evidence.v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    mode: "live",
    deployment: "kubernetes",
    checks: [
      "audit_export_configured",
      "siem_delivery_readback",
      "immutable_storage_reviewed",
      "retention_policy_reviewed",
      "time_sync_reviewed",
      "checksum_chain_verified",
      "audit_evidence_redaction_flags",
    ],
    export: {
      enabled: true,
      destinationType: "siem",
      successfulDeliveryCount: 1,
      failedDeliveryCount: 0,
      lastDeliveryStatus: "passed",
    },
    immutability: {
      wormStorageConfigured: true,
      retentionLockConfigured: true,
      immutableWindowDays: 365,
      deleteProtectionReviewed: true,
    },
    retention: {
      auditLogRetentionDays: 365,
      exportRetentionDays: 365,
      policyReviewed: true,
    },
    timeSync: {
      sourceConfigured: true,
      checkedHostCount: 3,
      maxClockSkewMs: 100,
      driftWithinThreshold: true,
    },
    checksumChain: {
      checked: true,
      status: "passed",
      verifiedRecordCount: 25,
      brokenLinkCount: 0,
    },
    failures: [],
    redaction: {
      rawAuditMetadataReturned: false,
      rawActorIdentifiersReturned: false,
      rawDestinationReturned: false,
      rawSiemPayloadsReturned: false,
      rawEvidencePathsReturned: false,
      secretValuesReturned: false,
    },
  };
}

function validTenantPurgeEvidence() {
  return {
    schemaVersion: "romeo.tenant-purge-evidence.v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    mode: "live",
    deployment: "kubernetes",
    checks: [
      "app_database_purge_executed",
      "app_object_store_purge_executed",
      "external_vector_store_reviewed",
      "backup_retention_reviewed",
      "operational_log_retention_reviewed",
      "support_bundle_retention_reviewed",
      "external_secret_store_reviewed",
      "tenant_purge_redaction_reviewed",
    ],
    purge: {
      tenantCount: 1,
      databasePurgedTenantCount: 1,
      objectStorePurgedTenantCount: 1,
      externalVectorReviewedTenantCount: 1,
      backupRetentionReviewedTenantCount: 1,
      operationalLogRetentionReviewedTenantCount: 1,
      supportBundleReviewedTenantCount: 1,
      externalSecretReviewedTenantCount: 1,
    },
    storage: {
      postgresRecordCount: 42,
      objectStoreObjectCount: 7,
      externalVectorNamespaceCount: 1,
      backupSystemCount: 2,
      operationalLogSystemCount: 2,
      supportBundleSystemCount: 1,
      secretStoreCount: 1,
    },
    retention: {
      backupRetentionDays: 35,
      operationalLogRetentionDays: 30,
      supportBundleRetentionDays: 14,
    },
    failures: [],
    redaction: {
      backupLocationsReturned: false,
      evidenceFileBodiesReturned: false,
      objectStoreKeysReturned: false,
      operationalLogBodiesReturned: false,
      rawEvidencePathsReturned: false,
      secretValuesReturned: false,
      supportBundleBodiesReturned: false,
      vectorValuesReturned: false,
    },
  };
}

function validTargetResilienceDrillEvidence() {
  return {
    "dist/ci/provider-outage-evidence.json": validProviderOutageEvidence(),
    "dist/ci/migration-drill-evidence.json": validMigrationDrillEvidence(),
    "dist/ci/network-partition-evidence.json": validNetworkPartitionEvidence(),
    "dist/ci/secret-rotation-drill-evidence.json":
      validSecretRotationDrillEvidence(),
  };
}

function validProviderOutageEvidence() {
  return {
    schemaVersion: "romeo.provider-outage-evidence.v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    mode: "live",
    deployment: "kubernetes",
    checks: [
      "provider_outage_injected",
      "provider_timeout_observed",
      "provider_circuit_open",
      "fallback_routing_verified",
      "kill_switch_verified",
      "operational_summary_readback",
      "provider_alerting_readback",
      "provider_recovery_verified",
      "provider_log_redaction",
    ],
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
    recovery: {
      checked: true,
      recoveredProviderCount: 1,
      recoverySeconds: 60,
    },
    failures: [],
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
  };
}

function validMigrationDrillEvidence() {
  return {
    schemaVersion: "romeo.migration-drill-evidence.v1",
    generatedAt: new Date().toISOString(),
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
    runbook: {
      reviewed: true,
      recoveryDocumented: true,
      reviewerCount: 1,
    },
    failures: [],
    redaction: {
      databaseUrlsReturned: false,
      migrationSqlReturned: false,
      migrationLogsReturned: false,
      rawErrorStacksReturned: false,
      rawEvidencePathsReturned: false,
      secretValuesReturned: false,
    },
  };
}

function validNetworkPartitionEvidence() {
  return {
    schemaVersion: "romeo.network-partition-evidence.v1",
    generatedAt: new Date().toISOString(),
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
      recoverySeconds: 60,
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
    failures: [],
    redaction: {
      rawNetworkEndpointsReturned: false,
      rawPodIpsReturned: false,
      rawPacketCapturesReturned: false,
      rawLogLinesReturned: false,
      rawEvidencePathsReturned: false,
      secretValuesReturned: false,
    },
  };
}

function validSecretRotationDrillEvidence() {
  return {
    schemaVersion: "romeo.secret-rotation-drill-evidence.v1",
    generatedAt: new Date().toISOString(),
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
    failures: [],
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
  };
}

function validDataRightsRetentionContract() {
  return {
    schemaVersion: "romeo.data-rights-retention-contract-smoke.v1",
    status: "passed",
    checks: [
      "retention_evidence_positive_generation",
      "retention_evidence_failed_status_generation",
      "retention_evidence_invalid_cli_inputs_rejected",
      "support_bundle_records_retention_evidence_posture",
      "support_bundle_omits_retention_evidence_paths_and_bodies",
    ],
    generatedEvidence: {
      operationalLogs: {
        schemaVersion: "romeo.data-rights-retention-evidence.v1",
        control: "operational_logs",
        status: "passed",
        retentionDays: 30,
        destructionValidated: true,
        encryptedAtRest: true,
        immutableWindowDays: 7,
        reviewedSystemCount: 2,
        failureCodeCount: 0,
      },
      backups: {
        schemaVersion: "romeo.data-rights-retention-evidence.v1",
        control: "backups",
        status: "failed",
        retentionDays: 90,
        destructionValidated: false,
        encryptedAtRest: true,
        immutableWindowDays: 0,
        reviewedSystemCount: 1,
        failureCodeCount: 1,
      },
    },
    rejectedCases: [
      { id: "passed_status_rejects_failure_code", status: "rejected" },
      {
        id: "passed_status_rejects_missing_destruction_validation",
        status: "rejected",
      },
      { id: "invalid_control_rejected", status: "rejected" },
      { id: "missing_retention_days_rejected", status: "rejected" },
    ],
    supportBundle: {
      schemaVersion: "romeo.support-bundle.v1",
      dataRightsEvidenceConfigured: true,
      evidenceCount: 1,
    },
    redaction: {
      backupLocationsReturned: false,
      evidenceFileBodiesReturned: false,
      rawEvidencePathsReturned: false,
      rawLogDestinationsReturned: false,
      secretValuesReturned: false,
    },
  };
}

function validComposeSmoke() {
  return {
    schemaVersion: "romeo.compose-smoke.v1",
    status: "passed",
    projectName: "romeo_smoke_contract",
    checks: [
      "compose_build_and_start",
      "migration_service",
      "explicit_development_seed",
      "secure_recreate_with_seeded_login_disabled",
      "unauthenticated_api_denied",
      "admin_readiness_ready",
      "chat_persisted_after_restart",
      "knowledge_source_persisted_after_restart",
      "attachment_persisted_after_object_store_restart",
      "run_usage_audit_notification_persisted_after_restart",
      "webhook_delivery_readback",
      "webhook_delivery_payload_redacted",
      "valkey_restart_readback",
      "rustfs_restart_readback",
      "postgres_restart_readback",
      "postgres_schema_validation",
      "compose_logs_redacted",
      "compose_raw_content_logs_redacted",
    ],
  };
}

function validComposeWorkersSmoke() {
  const requiredWorkers = [
    "data_connector_sync",
    "workflow_resume",
    "webhook_retry",
    "notification_retry",
    "retention_enforce",
    "billing_entitlement_reconcile",
    "billing_lifecycle_enforce",
    "knowledge_extraction",
    "voice_catalog_sync",
  ];
  return {
    schemaVersion: "romeo.compose-workers-smoke.v1",
    status: "passed",
    workerCount: requiredWorkers.length,
    workers: requiredWorkers.map((name) => ({
      name,
      service: `${name.replaceAll("_", "-")}-worker`,
      iteration: 1,
      checks: {},
    })),
    loopRestartCount: 3,
    loopRestarts: [
      {
        name: "workflow_resume",
        service: "workflow-resume-worker",
        beforeRestartIterations: 1,
        afterRestartIterations: 2,
      },
      {
        name: "webhook_retry",
        service: "webhook-retry-worker",
        beforeRestartIterations: 1,
        afterRestartIterations: 2,
      },
      {
        name: "notification_retry",
        service: "notification-retry-worker",
        beforeRestartIterations: 1,
        afterRestartIterations: 2,
      },
    ],
    controlledWorkflowResume: {
      workflowId: "workflow_contract",
      workflowRunId: "workflow_run_contract",
      linkedRunId: "run_contract",
    },
    crashRecovery: {
      service: "workflow-resume-worker",
      signal: "SIGKILL",
      afterKillBaselineIterations: 2,
      afterCrashIterations: 3,
      recoveredStatus: "waiting_approval",
    },
    checks: [
      "compose_build_and_start",
      "migration_service",
      "explicit_development_seed",
      "secure_recreate_with_seeded_login_disabled",
      "admin_readiness_ready",
      "worker_commands_ran_once",
      "worker_output_json_valid",
      "worker_output_secret_redaction",
      "worker_output_raw_content_redaction",
      "workflow_resume_controlled_pending_work",
      "loop_workers_emit_after_restart",
      "workflow_resume_sigkill_recovery",
      "workflow_resume_crash_no_duplicate_linked_run",
      "compose_logs_redacted",
    ],
  };
}

function validComposeBackupRestoreSmoke() {
  return {
    schemaVersion: "romeo.compose-backup-restore-smoke.v1",
    status: "passed",
    sourceProjectName: "romeo_backup_source_contract",
    restoreProjectName: "romeo_backup_restore_contract",
    evidence: {
      backupManifest: "backups/romeo-postgres.dump.manifest.json",
      objectStoreBackupManifest: "backups/object-store/manifest.json",
      drDrill: "backups/romeo-dr-drill.json",
      objectStoreDrDrill: "backups/romeo-object-store-dr-drill.json",
      restoredSchemaValidation: "backups/restored-postgres-validation.json",
    },
    checks: [
      "source_compose_start",
      "source_migration_service",
      "explicit_development_seed",
      "source_secure_recreate_with_seeded_login_disabled",
      "source_admin_readiness_ready",
      "source_records_created",
      "postgres_backup_manifest_sha256",
      "backup_manifest_redacted",
      "object_store_backup_manifest",
      "object_store_backup_manifest_redacted",
      "isolated_object_store_restore_passed",
      "object_store_dr_drill_evidence_redacted",
      "isolated_dr_restore_passed",
      "dr_drill_evidence_redacted",
      "restored_schema_validation",
      "restored_schema_validation_redacted",
      "restored_app_readiness_ready",
      "restored_chat_readback",
      "restored_knowledge_source_readback",
      "restored_knowledge_query",
      "restored_attachment_readback",
      "source_compose_logs_redacted",
      "restore_compose_logs_redacted",
    ],
  };
}

function validKubernetesRenderSmoke() {
  return {
    schemaVersion: "romeo.kubernetes-render-smoke.v1",
    status: "passed",
    releaseName: "romeo",
    namespace: "romeo",
    checks: [
      "helm_lint",
      "helm_values_schema_rejects_invalid_postgres_mode",
      "helm_values_schema_rejects_invalid_postgres_pool_max",
      "helm_values_schema_rejects_invalid_provider_stream_timeout",
      "helm_values_schema_rejects_invalid_provider_resilience",
      "helm_values_schema_rejects_invalid_provider_routing",
      "helm_values_schema_rejects_invalid_quota_coordination",
      "helm_values_schema_rejects_invalid_edge_security",
      "helm_values_schema_rejects_invalid_file_limits",
      "helm_values_schema_rejects_invalid_http_rate_limit",
      "helm_values_schema_rejects_invalid_data_connector_retry",
      "helm_values_schema_rejects_invalid_backup_upload_timeout",
      "helm_values_schema_rejects_invalid_tool_dispatch_bounds",
      "helm_values_schema_rejects_invalid_tool_dispatch_secret_resolver",
      "default_render_contract",
      "external_postgres_render_contract",
      "cloudnativepg_render_contract",
      "enterprise_surface_render_contract",
      "secret_refs_not_inline_sensitive_values",
      "restricted_pod_security_contexts",
      "worker_cronjobs_bounded_and_scoped",
      "app_hpa_render",
      "network_policy_and_ingress_render",
      "tool_dispatch_network_policy_render",
      "browser_automation_network_policy_render",
      "network_policy_explicit_egress_examples",
      "cloudnativepg_operator_examples",
      "keda_worker_scaledjob_examples",
    ],
    variants: [
      {
        name: "default",
        kinds: { Deployment: 1, Job: 1 },
        workerCronJobs: [],
      },
      {
        name: "external_postgres",
        kinds: { Deployment: 1, Job: 1, CronJob: 8 },
        workerCronJobs: [
          "romeo-data-connector-sync",
          "romeo-workflow-resume",
          "romeo-webhook-retry",
          "romeo-notification-retry",
          "romeo-retention-enforce",
          "romeo-billing-entitlement-reconcile",
          "romeo-billing-lifecycle-enforce",
        ],
      },
      {
        name: "cloudnativepg",
        kinds: { Deployment: 1, Job: 1, CronJob: 7 },
        workerCronJobs: [
          "romeo-data-connector-sync",
          "romeo-workflow-resume",
          "romeo-webhook-retry",
          "romeo-notification-retry",
          "romeo-retention-enforce",
          "romeo-billing-entitlement-reconcile",
          "romeo-billing-lifecycle-enforce",
        ],
      },
      {
        name: "enterprise_surface",
        kinds: {
          NetworkPolicy: 3,
          HorizontalPodAutoscaler: 1,
          Ingress: 1,
        },
        workerCronJobs: [
          "romeo-tool-dispatch",
          "romeo-browser-automation",
          "romeo-data-connector-sync",
        ],
      },
      {
        name: "network_policy_egress",
        kinds: { NetworkPolicy: 2 },
        workerCronJobs: ["romeo-tool-dispatch"],
        networkPolicyEgressRules: 6,
        toolDispatchNetworkPolicyEgressRules: 3,
      },
    ],
    cloudNativePgExamples: {
      resources: [
        {
          apiVersion: "postgresql.cnpg.io/v1",
          kind: "Cluster",
          name: "romeo-pg",
        },
        {
          apiVersion: "postgresql.cnpg.io/v1",
          kind: "Cluster",
          name: "romeo-pg-restore",
        },
        {
          apiVersion: "postgresql.cnpg.io/v1",
          kind: "ScheduledBackup",
          name: "romeo-pg-daily",
        },
        {
          apiVersion: "postgresql.cnpg.io/v1",
          kind: "Backup",
          name: "romeo-pg-manual",
        },
        {
          apiVersion: "barmancloud.cnpg.io/v1",
          kind: "ObjectStore",
          name: "romeo-pg-backups",
        },
        {
          apiVersion: "barmancloud.cnpg.io/v1",
          kind: "ObjectStore",
          name: "romeo-pg-restore-backups",
        },
      ],
    },
    kedaExamples: {
      resources: [
        {
          apiVersion: "keda.sh/v1alpha1",
          kind: "ScaledJob",
          name: "romeo-webhook-retry",
        },
        {
          apiVersion: "keda.sh/v1alpha1",
          kind: "TriggerAuthentication",
          name: "romeo-webhook-retry-postgres",
        },
      ],
    },
  };
}

function validReleaseReadbackValidation() {
  const sha256 =
    "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
  const image = "registry.example.com/romeo/app:0.0.0-contract";
  const chart = { name: "romeo", version: "0.0.0-contract" };
  const assets = [
    "release-channel",
    "security-evidence",
    "sbom",
    "provenance",
    "approval",
  ].map((name) => ({ name, sha256 }));
  return {
    schemaVersion: "romeo.release-readback-validation.v1",
    status: "pass",
    mode: "live_readback",
    required: {
      packages: [
        {
          name: "@romeo/api-client",
          version: "0.0.0-contract",
          sha256,
        },
      ],
      sbom: true,
      securityEvidence: true,
      channel: true,
      images: [image],
      charts: [chart],
      assets,
    },
    checks: [
      { name: "credentialed npm registry readback", status: "pass" },
      { name: `${image} image readback exists`, status: "pass" },
      {
        name: `${image} image registry readback is verified`,
        status: "pass",
      },
      { name: `${chart.name} chart readback exists`, status: "pass" },
      {
        name: `${chart.name} chart repository readback is verified`,
        status: "pass",
      },
      ...assets.flatMap((asset) => [
        {
          name: `${asset.name} release asset readback exists`,
          status: "pass",
        },
        {
          name: `${asset.name} required release asset sha256 is valid`,
          status: "pass",
        },
        {
          name: `${asset.name} release asset readback is verified`,
          status: "pass",
        },
      ]),
    ],
    redaction: {
      tokenValuesReturned: false,
      rawReadbackBodyReturned: false,
      rawRegistryResponsesReturned: false,
      rawPackageTarballsReturned: false,
      rawOciManifestsReturned: false,
      rawHelmRepositoryBodiesReturned: false,
      rawReleaseAssetBodiesReturned: false,
      environmentReturned: false,
    },
  };
}

function validReleaseProvenance() {
  const sha256 =
    "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
  const fileEvidence = { bytes: 128, sha256 };
  return {
    schemaVersion: "romeo.release-provenance.v1",
    status: "passed",
    release: {
      name: "romeo",
      version: "0.0.0-contract",
      manifest: fileEvidence,
      channel: fileEvidence,
      securityEvidence: fileEvidence,
      sbom: fileEvidence,
      artifacts: [
        {
          name: "romeo-app",
          version: "0.0.0-contract",
          file: "romeo-app.tar.gz",
          bytes: 128,
          sha256,
        },
      ],
    },
    supplyChain: {
      sbomAttached: true,
      securityEvidenceAttached: true,
      releaseChannelAttached: true,
      signatureAttached: false,
      attestationAttached: false,
      signatureRequired: false,
      attestationRequired: false,
      ciSourceRequired: false,
    },
    redaction: {
      tokenValuesReturned: false,
      secretValuesReturned: false,
      fileBodiesReturned: false,
      rawSignatureReturned: false,
      rawAttestationReturned: false,
      rawCiRunUrlReturned: false,
      rawSourceRepoReturned: false,
      rawSourceRefReturned: false,
      environmentReturned: false,
    },
  };
}

function validReleaseApproval() {
  const sha256 =
    "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
  const fileEvidence = { bytes: 128, sha256 };
  return {
    schemaVersion: "romeo.release-approval.v1",
    status: "passed",
    release: {
      name: "romeo",
      version: "0.0.0-contract",
      manifest: fileEvidence,
      provenance: fileEvidence,
    },
    approval: {
      system: "github_environment",
      refConfigured: true,
      refHash:
        "94db76d03b0789e0feb6c4841d8a7159c1af470cd126adee6b696d234cf54ef6",
      approverCount: 2,
      minApprovers: 2,
      approverHashes: [
        "d8e8fca2dc0f896fd7cb4cb0031ba249",
        "fba6f7781e624cc481b0f2f3f89e55ab",
      ],
      approvedAt: "2026-07-02T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
    redaction: {
      rawApproverIdsReturned: false,
      rawApprovalRefReturned: false,
      secretValuesReturned: false,
      fileBodiesReturned: false,
      rawProvenanceReturned: false,
      environmentReturned: false,
    },
  };
}

function requiredCiStatusChecks() {
  return [
    "Quality Gates",
    "Core API Tests",
    "SDK Drift",
    "Compose Smoke",
    "GA Checklist Draft",
  ].map((name) => ({ name }));
}

function validBranchProtectionPolicy() {
  return {
    targetBranch: "main",
    requirePullRequest: true,
    requireConversationResolution: true,
    requireLinearHistory: true,
    requireSignedCommits: true,
    requireUpToDateBeforeMerge: true,
    dismissStaleApprovals: true,
    requireCodeOwnerReviews: true,
    restrictBypassToReleaseAdmins: true,
    requiredApprovingReviewCount: 2,
  };
}

function validBranchProtectionPlan() {
  return {
    schemaVersion: "romeo.branch-protection-plan.v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    provider: "github",
    requiredStatusChecks: requiredCiStatusChecks(),
    policy: validBranchProtectionPolicy(),
    checks: [
      { name: "required status checks planned", status: "pass" },
      { name: "pull request reviews planned", status: "pass" },
      { name: "release-admin bypass restriction planned", status: "pass" },
    ],
    blockers: [],
    redaction: {
      workflowBodyIncluded: false,
      secretValuesIncluded: false,
      tokenValuesIncluded: false,
      environmentValuesIncluded: false,
    },
  };
}

function validHostedCiRunVerification() {
  const requiredStatusCheckCount = requiredCiStatusChecks().length;
  return {
    schemaVersion: "romeo.hosted-ci-run-verification.v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    mode: "live_github_api",
    provider: "github_actions",
    target: {
      apiOrigin: "https://api.github.com",
      branch: "main",
      repositoryHash:
        "e52d9c508c502347344d8c07ad91cbd6068a471f7a9b9718c4e959f480f74d8f",
      repositorySlugReturned: false,
      workflowIdHash:
        "7db3e90c09b40f7fc669a075611d89f62876cb8b12de6c63b7f86ac0dbd0c948",
      workflowName: "Romeo CI",
    },
    plan: {
      file: "dist/ci/branch-protection-plan.json",
      sha256:
        "6db3e90c09b40f7fc669a075611d89f62876cb8b12de6c63b7f86ac0dbd0c948",
      status: "passed",
      requiredStatusCheckCount,
    },
    run: {
      conclusion: "success",
      event: "push",
      headShaHash:
        "5db3e90c09b40f7fc669a075611d89f62876cb8b12de6c63b7f86ac0dbd0c948",
      idHash:
        "4db3e90c09b40f7fc669a075611d89f62876cb8b12de6c63b7f86ac0dbd0c948",
      status: "completed",
    },
    checks: [
      { name: "workflow run completed", status: "pass" },
      { name: "workflow run conclusion successful", status: "pass" },
      { name: "all required CI jobs present", status: "pass" },
      { name: "all required CI jobs successful", status: "pass" },
      {
        name: "hosted CI job inventory read",
        status: "pass",
        jobCount: requiredStatusCheckCount,
      },
    ],
    blockers: [],
    redaction: {
      rawApiResponseReturned: false,
      rawEnvironmentValuesReturned: false,
      rawJobLogsReturned: false,
      repositorySlugReturned: false,
      runUrlReturned: false,
      tokenValuesReturned: false,
    },
  };
}

function validBranchProtectionVerification() {
  const policy = validBranchProtectionPolicy();
  const requiredStatusCheckCount = requiredCiStatusChecks().length;
  delete policy.restrictBypassToReleaseAdmins;
  return {
    schemaVersion: "romeo.branch-protection-verification.v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    mode: "live_github_api",
    provider: "github",
    target: {
      apiOrigin: "https://api.github.com",
      branch: "main",
      repositoryHash:
        "e52d9c508c502347344d8c07ad91cbd6068a471f7a9b9718c4e959f480f74d8f",
      repositorySlugReturned: false,
    },
    plan: {
      file: "dist/ci/branch-protection-plan.json",
      sha256:
        "6db3e90c09b40f7fc669a075611d89f62876cb8b12de6c63b7f86ac0dbd0c948",
      status: "passed",
      requiredStatusCheckCount,
      policy,
    },
    checks: [
      "pull request reviews required",
      "stale approval dismissal enabled",
      "code owner reviews enabled",
      "required approving review count enforced",
      "required status checks configured",
      "status checks require up-to-date branch",
      "all planned status checks required",
      "linear history required",
      "signed commits required",
      "conversation resolution required",
      "administrator enforcement enabled",
    ].map((name) => ({ name, status: "pass" })),
    blockers: [],
    redaction: {
      commandOutputReturned: false,
      rawApiResponseReturned: false,
      rawEnvironmentValuesReturned: false,
      repositorySlugReturned: false,
      tokenValuesReturned: false,
    },
  };
}

function validTargetQualityEvidence() {
  return {
    schemaVersion: "romeo.target-quality-evidence.v1",
    generatedAt: generatedAtNow(),
    status: "passed",
    mode: "live",
    target: {
      deployment: "target-api",
      origin: "https://romeo.example.com",
    },
    checks: [
      "health_read",
      "admin_analytics_summary_read",
      "admin_analytics_csv_read",
      "analytics_redaction_flags",
      "eval_release_candidate_readback",
      "eval_redaction_flags",
      "eval_gate_passed",
      "retrieval_replay_readback",
      "replay_redaction_flags",
      "retrieval_vector_route_comparison",
      "forbidden_sentinels_absent",
    ],
    health: {
      status: "ok",
      bodyBytes: 24,
    },
    analytics: {
      status: "passed",
      summaryStatus: "healthy",
      evalStatus: "passed",
      evalSuiteCount: 1,
      evalRunCount: 1,
      usageEventCount: 1,
      estimatedCostUsd: 0.01,
      providerStatus: "healthy",
      jobStatus: "healthy",
      toolCallCount: 1,
      csv: {
        bytes: 72,
        sha256:
          "e7784a63f72e5a3d7839f6d543654b2a82f21fc7ddf1c439a293b6835be9bf02",
        returned: false,
      },
      redaction: {
        rawEvalInputsReturned: true,
        rawEvalOutputsReturned: true,
        rawJobPayloadsReturned: true,
        rawProviderConfigReturned: true,
        rawToolInputsReturned: true,
        rawUsageMetadataReturned: true,
      },
    },
    evals: [
      {
        status: "passed",
        subject: {
          agentIdPresent: true,
          workspaceIdPresent: true,
          agentIdHash: "a".repeat(64),
          workspaceIdHash: "b".repeat(64),
        },
        gateStatus: "passed",
        publishBlocked: false,
        reasonCodes: [],
        suiteCount: 1,
        passedSuiteCount: 1,
        failedSuiteCount: 0,
        missingSuiteCount: 0,
        averageScore: 1,
        evaluatedAt: "2026-07-02T00:00:00.000Z",
        redaction: {
          rawEvalInputsReturned: true,
          rawEvalOutputsReturned: true,
          rawHumanRatingCommentsReturned: true,
          rawRubricTermsReturned: true,
        },
      },
    ],
    replay: {
      checked: true,
      status: "passed",
      kind: "compare",
      outcome: "unchanged",
      baselineStatus: "passed",
      candidateStatus: "passed",
      baselineCaseCount: 1,
      candidateCaseCount: 1,
      deltas: {
        averagePrecision: 0,
        averageRecall: 0,
        matchedExpectedChunkCount: 0,
      },
      routeModeCounts: {
        baseline: {
          external_vector: 0,
          legacy_rag_provider: 0,
          lexical_fallback: 0,
          pgvector: 1,
        },
        candidate: {
          external_vector: 1,
          legacy_rag_provider: 0,
          lexical_fallback: 0,
          pgvector: 0,
        },
      },
      vectorComparison: {
        required: true,
        status: "passed",
        expectedBaselineRouteMode: "pgvector",
        expectedCandidateRouteMode: "external_vector",
        baselineMatchedCount: 1,
        candidateMatchedCount: 1,
        baselineTotalRouteCount: 1,
        candidateTotalRouteCount: 1,
      },
      redaction: {
        rawQueriesReturned: true,
        rawChunkTextReturned: true,
        rawExpectedChunkIdsReturned: true,
        rawHitIdsReturned: true,
        vectorValuesReturned: true,
      },
    },
    redaction: {
      rawAnalyticsCsvReturned: false,
      rawEvalInputsReturned: false,
      rawEvalOutputsReturned: false,
      rawEvalAgentIdsReturned: false,
      rawEvalWorkspaceIdsReturned: false,
      rawReplayQueriesReturned: false,
      rawReplayHitIdsReturned: false,
      rawSecretsReturned: false,
    },
  };
}

function validTenantIsolationNegativeSuite() {
  const testFiles = [
    "src/services/authorization.test.ts",
    "src/collaboration.test.ts",
    "src/groups.test.ts",
    "src/data-connectors.test.ts",
    "src/device-authorizations.test.ts",
    "src/knowledge.test.ts",
    "src/quota.test.ts",
    "src/workflows.test.ts",
    "src/vector-isolation.test.ts",
    "src/api.test.ts",
  ];
  return {
    schemaVersion: "romeo.tenant-isolation-negative-suite.v1",
    status: "passed",
    checks: [
      "object_grant_negative_authorization",
      "cross_workspace_worker_path_denials",
      "cross_org_governed_deletion_denial",
      "share_and_folder_resource_filtering",
      "group_membership_subject_resolution",
      "connector_owner_source_isolation",
      "device_authorization_scope_bounds",
      "quota_scope_and_limit_enforcement",
      "suspended_tenant_work_boundary_enforcement",
      "service_account_scope_and_visibility_bounds",
      "external_vector_provider_model_allowlist_denial",
      "external_vector_hit_post_filtering",
    ],
    command: {
      executable: "pnpm",
      args: ["--filter", "@romeo/core", "test", "--", ...testFiles],
    },
    testFiles,
    result: {
      exitCode: 0,
      signal: null,
      durationMs: 1234,
      stdout: {
        bytes: 241,
        sha256:
          "0e0101d8eebc08a619299f6e1a083f736ba3089b1a8113e00f9b7a49be338038",
      },
      stderr: {
        bytes: 302,
        sha256:
          "819d8ec8eb632e1d1d724e0a28f7895557ec426fcfab4f49edbbfd5ca8934237",
      },
    },
  };
}

function validSupportBundleRedaction() {
  return {
    schemaVersion: "romeo.support-bundle-redaction.v1",
    status: "passed",
    checks: [
      "support_bundle_generation",
      "raw_log_content_not_included",
      "raw_evidence_content_not_included",
      "access_review_evidence_linked_without_raw_content",
      "environment_secret_values_not_included",
      "configured_secret_posture_recorded",
      "unrecognized_enum_values_not_included",
    ],
    supportBundle: {
      schemaVersion: "romeo.support-bundle.v1",
      evidenceCount: 2,
      accessReviewEvidenceCount: 1,
      logCount: 1,
      migrationCount: 1,
      configuredSecretKeys: [
        "AWS_SECRET_ACCESS_KEY",
        "DATABASE_URL",
        "LOCAL_AUTH_SECRET_ENCRYPTION_KEY",
        "MANAGED_SECRET_ENCRYPTION_KEY",
        "ROMEO_API_KEY",
        "SESSION_SECRET",
        "WEBHOOK_SIGNING_KEY",
      ],
    },
    redaction: {
      rawLogContentReturned: false,
      rawEvidenceContentReturned: false,
      accessReviewRawContentReturned: false,
      environmentSecretValuesReturned: false,
      unrecognizedEnumValuesReturned: false,
    },
  };
}

function validSupportBundle() {
  const sha = (digit) => digit.repeat(64);
  const file = (path, digit) => ({
    path,
    bytes: 128,
    sha256: sha(digit),
    modifiedAt: new Date().toISOString(),
  });
  const accessReview = {
    ...file("dist/ci/access-review-report.json", "a"),
    schemaVersion: "romeo.access-review-report.v1",
    evidenceStatus: "passed",
  };
  return {
    schemaVersion: "romeo.support-bundle.v1",
    generatedAt: new Date().toISOString(),
    status: "generated",
    runtime: {
      node: "v22.0.0",
      platform: "linux",
      arch: "x64",
    },
    package: {
      name: "romeo",
      version: "1.2.3",
      packageManager: "pnpm@10.0.0",
    },
    configuration: {
      safeEnums: {
        REPOSITORY_DRIVER: "postgres",
        TENANCY_MODE: "multi",
      },
      safeNumbers: {
        POSTGRES_POOL_MAX: 20,
      },
      urlHosts: {
        APP_ORIGIN: "romeo.example.com",
      },
      configuredSecrets: {
        DATABASE_URL: true,
        LOCAL_AUTH_SECRET_ENCRYPTION_KEY: true,
        MANAGED_SECRET_ENCRYPTION_KEY: true,
        SESSION_SECRET: true,
        WEBHOOK_SIGNING_KEY: true,
      },
    },
    deployment: [
      file("deploy/compose/compose.yml", "b"),
      file("deploy/helm/Chart.yaml", "c"),
      file("deploy/helm/values.yaml", "d"),
    ],
    migrations: {
      count: 1,
      greenfieldBaselineOnly: true,
      files: [file("packages/db/migrations/0000_greenfield_baseline.sql", "e")],
    },
    evidence: [
      {
        ...file("dist/ci/tenant-isolation-negative-suite.json", "f"),
        schemaVersion: "romeo.tenant-isolation-negative-suite.v1",
        evidenceStatus: "passed",
      },
      accessReview,
    ],
    complianceEvidence: {
      accessReview: {
        status: "present",
        count: 1,
        artifacts: [accessReview],
      },
    },
    dataRights: {
      coverageApiPath: "/api/v1/governance/data-rights/coverage",
      exportPreviewApiPath: "/api/v1/governance/data-exports/preview",
      exportExecuteApiPath: "/api/v1/governance/data-exports/execute",
      deletionPreviewApiPath: "/api/v1/governance/data-deletions/preview",
      deletionExecuteApiPath: "/api/v1/governance/data-deletions/execute",
      supportedDeletionResourceTypes: [
        "chat",
        "file_object",
        "knowledge_source",
      ],
      retentionEvidence: {
        schemaVersion: "romeo.data-rights-retention-evidence.v1",
        operationalLogEvidencePathConfigured: true,
        backupEvidencePathConfigured: true,
      },
      externalRetentionControls: ["operational_logs", "backups"],
    },
    logs: [file("external-log/romeo.log", "1")],
    redaction: {
      rawContentIncluded: false,
      secretValuesIncluded: false,
      notes: ["metadata-only synthetic support bundle"],
    },
  };
}

function validProviderResilienceSmoke() {
  return {
    schemaVersion: "romeo.provider-resilience-smoke.v1",
    status: "passed",
    checks: [
      "pre_output_retry",
      "no_retry_after_output",
      "circuit_breaker_fail_fast",
      "provider_fallback_before_output",
      "provider_kill_switch_fallback",
      "raw_provider_error_redaction",
    ],
    cases: [
      {
        name: "pre_output_retry",
        providerCallCount: 2,
        eventTypes: ["run.started", "message.delta", "run.completed"],
        terminalData: { providerRetryAttempts: 1 },
      },
      {
        name: "no_retry_after_output",
        providerCallCount: 1,
        eventTypes: ["run.started", "message.delta", "run.failed"],
        terminalData: { errorCode: "provider_stream_error" },
      },
      {
        name: "circuit_breaker_fail_fast",
        providerCallCount: 2,
        terminalData: [
          { errorCode: "provider_stream_error" },
          {
            errorCode: "provider_circuit_open",
            providerCircuit: { state: "open", consecutiveFailures: 2 },
          },
        ],
      },
      {
        name: "provider_fallback_before_output",
        providerCallCount: { primary: 1, fallback: 1 },
        terminalData: {
          providerFallback: { reason: "provider_stream_error" },
        },
      },
      {
        name: "provider_kill_switch_fallback",
        providerCallCount: { primary: 0, fallback: 1 },
        terminalData: {
          providerFallback: { reason: "provider_disabled" },
        },
      },
    ],
    redaction: {
      rawProviderErrorsReturned: false,
      rawProviderPayloadsReturned: false,
      rawProviderResponsesReturned: false,
      rawRunPromptsReturned: false,
    },
  };
}

function validJobLagSmoke() {
  return {
    schemaVersion: "romeo.job-lag-smoke.v1",
    status: "passed",
    endpoint: "/api/v1/jobs/operational-summary",
    checks: [
      "queued_lag_alert",
      "running_stale_alert",
      "recent_failed_job_alert",
      "dead_letter_alert",
      "payload_redaction",
    ],
    summary: {
      status: "critical",
      totals: {
        queued: 1,
        running: 1,
        failed: 2,
        deadLettered: 1,
        recentFailed: 2,
      },
      alerts: [
        { metric: "queued_lag_seconds" },
        { metric: "running_stale_seconds" },
        { metric: "recent_failed_jobs" },
        { metric: "dead_letter_jobs" },
      ],
    },
    redaction: {
      rawQueuedPayloadReturned: false,
      rawRunningPayloadReturned: false,
      rawFailedPayloadReturned: false,
      rawDeadLetterPayloadReturned: false,
    },
  };
}

function validOperationalMonitoringValidation() {
  const metricNames = [
    "romeo_background_job_alert",
    "romeo_background_job_dead_letter_jobs",
    "romeo_background_job_oldest_queued_seconds",
    "romeo_background_job_recent_failed_jobs",
    "romeo_background_job_status_count",
    "romeo_operational_exporter_up",
    "romeo_provider_alert",
    "romeo_provider_alert_total",
    "romeo_provider_circuit_state",
    "romeo_provider_enabled",
    "romeo_provider_fallback_available",
    "romeo_provider_kill_switch_active",
    "romeo_provider_model_count",
  ];
  return {
    schemaVersion: "romeo.operational-monitoring-validation.v1",
    status: "passed",
    checks: [
      "provider_operational_metrics",
      "background_job_operational_metrics",
      "prometheus_text_redaction",
      "prometheus_rules_parse",
      "prometheus_rules_metric_references",
      "kubernetes_exporter_example_contract",
    ],
    metricCount: 66,
    metricNames,
    alertNames: [
      "RomeoProviderCircuitOpen",
      "RomeoBackgroundJobQueuedLag",
      "RomeoBackgroundJobDeadLetters",
      "RomeoPostgresBackupJobFailed",
    ],
    referencedMetricNames: [
      "romeo_background_job_alert",
      "romeo_operational_exporter_up",
      "romeo_provider_alert",
      "romeo_provider_circuit_state",
    ],
    redaction: {
      rawProviderPayloadReturned: false,
      rawJobPayloadReturned: false,
      rawProviderUrlsReturned: false,
      prometheusTextReturned: false,
      environmentReturned: false,
    },
  };
}

function validBackupUploadFailureSmoke() {
  return {
    schemaVersion: "romeo.postgres-backup-upload-failure-smoke.v1",
    status: "passed",
    checks: [
      "upload_http_failure_exits_nonzero",
      "upload_timeout_exits_nonzero",
      "failed_upload_does_not_write_manifest",
      "upload_failure_output_redacts_presigned_secret",
    ],
    cases: [
      {
        name: "http_503",
        exitStatus: 1,
        manifestWritten: false,
        requestReceived: true,
        redactedUploadUrl: "http://127.0.0.1:3000/failure?redacted=true",
      },
      {
        name: "upload_timeout",
        exitStatus: 1,
        manifestWritten: false,
        requestReceived: true,
        redactedUploadUrl: "http://127.0.0.1:3000/timeout?redacted=true",
      },
    ],
    requestCount: 2,
    redaction: {
      rawPresignedUploadUrlReturned: false,
      rawUploadRequestBodyReturned: false,
      rawUploadResponseBodyReturned: false,
      commandOutputReturned: false,
      databaseUrlReturned: false,
      environmentReturned: false,
    },
  };
}

function validKubernetesTieredRagSmoke() {
  return {
    schemaVersion: "romeo.kubernetes-tiered-rag-smoke.v1",
    generatedAt: generatedAtNow(),
    status: "passed",
    mode: "live",
    target: {
      deployment: "kubernetes",
      namespace: "romeo-tiered-rag-contract",
      releaseName: "romeo",
      serviceName: "romeo",
      deploymentName: "romeo",
      baseUrlMode: "port-forward",
    },
    tenancyMode: "multi",
    workspaces: [
      "workspace_default",
      "workspace_contract_alpha",
      "workspace_contract_beta",
    ],
    authorizedTierCount: 4,
    skippedDeniedCount: 1,
    vectorPosture: {
      driver: "pgvector",
      isolationMode: "shared_row_scope",
      externalVectorStoreDriver: "disabled",
      externalVectorStoreRoutingActive: false,
      namespaceConfigured: false,
      namespacePolicy: "none",
      partitioningConfigured: false,
      partitioningPolicy: "none",
      planEntryCount: 4,
      vectorScopeDriverCounts: { pgvector: 4, qdrant: 0 },
      physicalIsolationPolicy: "shared_row_scope",
    },
    policyRestore: {
      requested: true,
      status: "restored",
    },
    logRedaction: {
      status: "passed",
      scannedPods: 2,
      rawCorpusSentinelsChecked: 5,
      apiKeysChecked: 2,
    },
    checks: [
      "cluster_reachable",
      "namespace_readable",
      "app_deployment_rollout_available",
      "admin_readiness_ready",
      "me_deployment_tenancy_mode_exposed",
      "workspace_create_api",
      "single_org_multiple_workspace_setup",
      "service_account_owned_workspace_corpus",
      "service_account_usage_system_actor",
      "rag_policy_temporarily_patched",
      "tiered_rag_user_private_workspace_org_shared_hits",
      "tiered_rag_vector_plan_posture_reported",
      "denied_corpus_skipped_without_id_or_content_leak",
      "tiered_rag_audit_metadata_only",
      "rag_policy_restored_or_explicitly_kept",
      "pod_logs_redacted",
    ],
  };
}

function validQdrantDrEvidence(phase) {
  const base = {
    schemaVersion: "romeo.qdrant-dr-consistency.v1",
    generatedAt: generatedAtNow(),
    status: "passed",
    mode: "live",
    phase,
    target: {
      driver: "qdrant",
      endpointConfigured: true,
      endpointValid: true,
      endpointScheme: "https",
      endpointHostSha256:
        "3d049c513786d4a9447c3300e060fad76ef6ef103a0f925fe75da2ef3ddc4c9b",
      collectionConfigured: true,
      collectionSha256:
        "905db760ea713ddb857ce76f3b77563a5c23fcebf3c826d701420ebfc73a23b4",
      credentialConfigured: true,
      unauthenticatedAllowed: false,
      namespacePolicy: "org",
      partitioningPolicy: "workspace",
      dimensions: 8,
      timeoutMs: 15000,
    },
    seed: {
      runSecretSha256:
        "f2b7e0ecf4b006c6f2e6338e2124929f3f93658383fcf592b7d3dd2521b5c901",
      deterministicScope: true,
      ...(phase === "verify-restore"
        ? {
            sourceEvidenceSha256:
              "5f2abdc4e260b6019e8822c149ebebfb1d371127fc57e185de5593e3bdad03a2",
          }
        : {}),
    },
    collection: {
      status: "green",
      optimizerStatus: "ok",
      pointsCount: 2,
      vectorsCount: 2,
      indexedVectorsCount: 2,
      segmentsCount: 1,
    },
    policy: {
      namespacePolicy: "org",
      partitioningPolicy: "workspace",
      dimensions: 8,
      filter: {
        orgFilterApplied: true,
        workspaceFilterApplied: true,
        knowledgeBaseFilterApplied: true,
        sourceFilterApplied: true,
        providerModelDimensionFilterApplied: true,
        namespaceFilterApplied: true,
        partitionFilterApplied: true,
      },
    },
    redaction: {
      apiKeyReturned: false,
      collectionReturned: false,
      endpointReturned: false,
      namespaceValuesReturned: false,
      partitionValuesReturned: false,
      payloadValuesReturned: false,
      pointIdsReturned: false,
      runSecretReturned: false,
      sourceEvidenceBodyReturned: false,
      sourceEvidencePathReturned: false,
      vectorValuesReturned: false,
    },
  };
  if (phase === "prepare-source") {
    return {
      ...base,
      prepare: {
        preparedPointCount: 2,
        scopedReadbackReturnedExpectedPoint: true,
        foreignOrgTrapExcluded: true,
        vectorsReturned: false,
      },
      checks: [
        "collection_health_readable",
        "source_synthetic_points_upserted",
        "source_scoped_readback_succeeded",
        "source_foreign_org_trap_excluded",
        "query_omitted_vectors",
        "evidence_redaction_self_check_passed",
      ],
    };
  }
  if (phase === "verify-restore") {
    return {
      ...base,
      restore: {
        sourceEvidenceMatched: true,
        scopedReadbackReturnedExpectedPoint: true,
        foreignOrgTrapExcluded: true,
        vectorsReturned: false,
        allSmokePointDeleteIssued: true,
        postDeleteResultCount: 0,
        expectedHitRemoved: true,
      },
      checks: [
        "source_evidence_matches_run_secret",
        "collection_health_readable",
        "restored_scoped_query_returned_expected_point",
        "restored_foreign_org_trap_excluded",
        "query_omitted_vectors",
        "restored_all_smoke_point_delete_issued",
        "restored_all_smoke_point_delete_verified",
        "evidence_redaction_self_check_passed",
      ],
    };
  }
  return {
    ...base,
    cleanup: {
      allSmokePointDeleteIssued: true,
      postDeleteResultCount: 0,
      expectedHitRemoved: true,
    },
    checks: [
      "collection_health_readable",
      "source_all_smoke_point_delete_issued",
      "source_all_smoke_point_delete_verified",
      "evidence_redaction_self_check_passed",
    ],
  };
}

function validQdrantLiveEvidence() {
  return {
    schemaVersion: "romeo.qdrant-live-evidence.v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    mode: "live",
    target: {
      driver: "qdrant",
      endpointConfigured: true,
      endpointValid: true,
      endpointScheme: "https",
      endpointHostSha256:
        "3d049c513786d4a9447c3300e060fad76ef6ef103a0f925fe75da2ef3ddc4c9b",
      collectionConfigured: true,
      collectionSha256:
        "905db760ea713ddb857ce76f3b77563a5c23fcebf3c826d701420ebfc73a23b4",
      credentialConfigured: true,
      unauthenticatedAllowed: false,
      namespacePolicy: "org",
      partitioningPolicy: "workspace",
      dimensions: 8,
      timeoutMs: 15000,
    },
    collection: {
      status: "green",
      optimizerStatus: "ok",
      pointsCount: 4,
      vectorsCount: 4,
      indexedVectorsCount: 4,
      segmentsCount: 1,
    },
    mutation: {
      requiresConfirmMutation: true,
      confirmed: true,
      insertedPointCount: 4,
      cleanupAttempted: true,
    },
    isolation: {
      scopedQueryResultCount: 1,
      expectedHitReturned: true,
      namespaceTrapExcluded: true,
      partitionTrapExcluded: true,
      foreignOrgTrapExcluded: true,
      vectorsReturned: false,
      payloadReturned: true,
      filter: {
        orgFilterApplied: true,
        workspaceFilterApplied: true,
        knowledgeBaseFilterApplied: true,
        sourceFilterApplied: true,
        providerModelDimensionFilterApplied: true,
        namespaceFilterApplied: true,
        partitionFilterApplied: true,
      },
    },
    deletion: {
      scopedDeleteIssued: true,
      postDeleteResultCount: 0,
      expectedHitRemoved: true,
      cleanupByPointIdAttempted: true,
    },
    checks: [
      "endpoint_shape_valid",
      "collection_health_readable",
      "synthetic_points_upserted",
      "scoped_query_returned_expected_point",
      "namespace_trap_excluded",
      "partition_trap_excluded",
      "foreign_org_trap_excluded",
      "query_omitted_vectors",
      "scoped_delete_removed_expected_point",
      "evidence_redaction_self_check_passed",
    ],
    redaction: {
      apiKeyReturned: false,
      collectionReturned: false,
      endpointReturned: false,
      evidenceFileBodyReturned: false,
      namespaceValuesReturned: false,
      partitionValuesReturned: false,
      payloadValuesReturned: false,
      pointIdsReturned: false,
      rawEvidencePathReturned: false,
      vectorValuesReturned: false,
    },
  };
}

function validKubernetesLiveSmoke() {
  return {
    schemaVersion: "romeo.kubernetes-live-smoke.v1",
    generatedAt: generatedAtNow(),
    status: "passed",
    mode: "live",
    namespace: "romeo-ga-contract",
    releaseName: "romeo",
    appName: "romeo-app",
    image: "registry.example.com/romeo/app:contract",
    target: {
      deployment: "kubernetes",
      namespace: "romeo-ga-contract",
      releaseName: "romeo",
      appName: "romeo-app",
      image: "registry.example.com/romeo/app:contract",
    },
    imagePosture: {
      appImageReviewed: true,
      dependencyImagesDigestPinned: true,
      dependencyImageCount: 4,
      rawDependencyImageRefsReturned: false,
    },
    checks: [
      "cluster_reachable",
      "ephemeral_external_dependencies_ready",
      "helm_install_with_migration_job",
      "explicit_development_seed_job",
      "secure_upgrade_with_seeded_login_disabled",
      "admin_readiness_ready",
      "unauthenticated_api_denied",
      "admin_local_password_set",
      "local_fallback_enabled",
      "oidc_unconfigured_fails_closed",
      "local_password_login_sets_session_cookie",
      "session_bootstrap_subject_readback",
      "totp_enrollment_confirmed",
      "local_login_requires_mfa_after_totp_activation",
      "invalid_mfa_code_rejected",
      "valid_mfa_code_sets_session_cookie",
      "recovery_codes_generated",
      "local_login_advertises_recovery_code_mfa",
      "recovery_code_sets_session_cookie",
      "reused_recovery_code_rejected",
      "local_auth_status_reports_recovery_code_count",
      "local_auth_status_reports_active_mfa",
      "local_auth_audit_redacted",
      "product_workflow_readback",
      "webhook_delivery_readback",
      "webhook_delivery_payload_redacted",
      "app_rollout_restart_readback",
      "attachment_byte_readback",
      "pod_logs_redacted",
    ],
    productWorkflow: {
      chatId: "chat_contract",
      sourceId: "source_contract",
      runId: "run_contract",
      webhookDeliveryId: "delivery_contract",
    },
    logRedaction: {
      status: "passed",
      scannedPodLogEntries: 4,
      generatedSecretValuesChecked: 11,
      rawAuthSentinelsChecked: 1,
      rawContentSentinelsChecked: 1,
    },
  };
}

function validKubernetesWorkersSmoke() {
  return {
    schemaVersion: "romeo.kubernetes-workers-smoke.v1",
    generatedAt: generatedAtNow(),
    status: "passed",
    mode: "live",
    namespace: "romeo-workers-contract",
    releaseName: "romeo",
    appName: "romeo",
    target: {
      deployment: "kubernetes",
      namespace: "romeo-workers-contract",
      releaseName: "romeo",
      appName: "romeo",
      workerApiKeySecretMode: "preexisting",
    },
    workerCount: 7,
    workers: [
      "data_connector_sync",
      "workflow_resume",
      "webhook_retry",
      "notification_retry",
      "retention_enforce",
      "billing_entitlement_reconcile",
      "billing_lifecycle_enforce",
    ].map((name) => ({ name, iteration: 1 })),
    controlledWorkflowResume: {
      workflowId: "workflow_contract",
      workflowRunId: "workflow_run_contract",
      linkedRunId: "run_contract",
    },
    crashRecovery: {
      termination: "forced_pod_delete",
      recoveredStatus: "waiting_approval",
      workflowId: "workflow_contract_crash",
      workflowRunId: "workflow_run_contract_crash",
      linkedRunId: "run_contract_crash",
    },
    checks: [
      "cluster_reachable",
      "app_deployment_rollout_ready",
      "admin_readiness_ready",
      "worker_api_key_secret_ready",
      "worker_cronjobs_present",
      "worker_jobs_completed",
      "worker_output_json_valid",
      "worker_output_secret_redaction",
      "worker_output_raw_content_redaction",
      "workflow_resume_controlled_pending_work",
      "workflow_resume_pod_crash_recovery",
      "workflow_resume_crash_no_duplicate_linked_run",
      "worker_logs_redacted",
      "pod_logs_redacted",
    ],
    logRedaction: {
      status: "passed",
      scannedPodLogEntries: 3,
      scannedJobLogEntries: 8,
      checkedAdminApiKey: true,
      checkedSmokeOwnedWorkerApiKey: false,
      workerApiKeySecretValueKnown: false,
      webhookSigningSecretChecked: true,
      generatedSecretValuesChecked: 2,
      rawPromptSentinelsChecked: 2,
      rawContentSentinelsChecked: 1,
    },
  };
}

function validKubernetesNetworkPolicySmoke() {
  return {
    schemaVersion: "romeo.kubernetes-networkpolicy-smoke.v1",
    generatedAt: generatedAtNow(),
    status: "passed",
    mode: "live",
    namespace: "romeo-cni-contract",
    target: {
      deployment: "kubernetes",
      enforcement: "networking.k8s.io/v1 NetworkPolicy",
      cni: "contract",
    },
    checks: [
      "cluster_reachable",
      "namespace_created",
      "baseline_allowed_endpoint_reachable_before_policy",
      "baseline_denied_endpoint_reachable_before_policy",
      "egress_policy_applied",
      "allowed_endpoint_reachable_after_policy",
      "denied_endpoint_blocked_after_policy",
      "pod_logs_redacted",
    ],
    policy: {
      selectedComponent: "app",
      allowedPodLabel: "app.kubernetes.io/name=allowed-egress",
      deniedPodLabel: "app.kubernetes.io/name=denied-egress",
      allowedPort: 8080,
    },
    logRedaction: {
      status: "passed",
      scannedPodLogEntries: 3,
      generatedSentinelChecked: true,
    },
  };
}

function validKubernetesKedaSmoke() {
  return {
    schemaVersion: "romeo.kubernetes-keda-smoke.v1",
    generatedAt: generatedAtNow(),
    status: "passed",
    mode: "live",
    target: {
      deployment: "kubernetes",
      namespace: "romeo-keda-contract",
      kedaNamespace: "keda",
      serviceName: "romeo",
      servicePort: 3000,
      scaledJobName: "romeo-webhook-retry",
      triggerAuthenticationName: "romeo-webhook-retry",
      appliedExample: false,
    },
    scaledJob: {
      name: "romeo-webhook-retry",
      minReplicaCount: 0,
      maxReplicaCount: 5,
      pollingInterval: 15,
    },
    seededDelivery: {
      subscriptionId: "webhook_subscription_contract",
      deliveryId: "webhook_delivery_contract",
      initialAttemptCount: 1,
      retriedAttemptCount: 2,
      statusAfterRetry: "failed",
    },
    kedaJob: {
      name: "romeo-webhook-retry-contract",
      succeeded: 1,
      failed: 0,
      startTime: "2026-01-01T00:00:00.000Z",
      completionTime: "2026-01-01T00:00:30.000Z",
    },
    logRedaction: {
      status: "passed",
      targetNamespaceLogEntries: 3,
      kedaOperatorLogEntries: 1,
      kedaOperatorLogsRequired: true,
      checkedAdminApiKey: true,
      checkedWorkerApiKey: true,
      checkedDatabaseUrl: true,
      checkedWebhookSigningSecret: true,
      checkedWebhookPayloadSentinel: true,
      checkedWebhookUrlSentinel: true,
      extraSecretSentinelCount: 0,
    },
    checks: [
      "cluster_reachable",
      "keda_crds_present",
      "namespace_readable",
      "scaledjob_present",
      "triggerauthentication_present",
      "worker_api_key_secret_readable",
      "postgres_secret_readable",
      "admin_readiness_ready",
      "webhook_retry_backlog_seeded_via_api",
      "webhook_delivery_due_observed",
      "keda_scaledjob_created_worker_job",
      "keda_worker_job_completed",
      "webhook_delivery_retry_readback",
      "target_namespace_logs_redacted",
      "keda_operator_logs_redacted",
      "evidence_omits_secret_values",
    ],
  };
}

function validKubernetesDrSmoke(databaseMode) {
  const connectionSource =
    databaseMode === "cloudnativepg" ? "operator_secret" : "smoke_owned_secret";
  return {
    schemaVersion: "romeo.kubernetes-dr-smoke.v1",
    generatedAt: generatedAtNow(),
    status: "passed",
    mode: "live",
    databaseMode,
    source: {
      namespace: `romeo-${databaseMode}-source`,
      databaseConnection: { source: connectionSource },
    },
    restore: {
      namespace: `romeo-${databaseMode}-restore`,
      databaseConnection: { source: connectionSource },
    },
    checks: [
      "cluster_reachable",
      "source_namespace_ready",
      "source_migration_job",
      "source_seed_job",
      "source_seeded_login_disabled",
      "source_product_records_created",
      "postgres_backup_job",
      "object_store_backup_job",
      "backup_evidence_redacted",
      "restore_namespace_ready",
      "object_store_restore_drill_job",
      "postgres_restore_drill_job",
      "restored_schema_validation_job",
      "restored_app_readiness",
      "restored_chat_readback",
      "restored_knowledge_readback",
      "restored_product_workflow_readback",
      "restored_attachment_readback",
      "pod_logs_redacted",
    ],
    evidence: {
      postgresBackupManifest: "romeo-postgres.dump.manifest.json",
      objectStoreBackupManifest: "object-store/manifest.json",
      postgresDrill: "romeo-dr-drill.json",
      objectStoreDrill: "romeo-object-store-dr-drill.json",
      restoredSchemaValidation: "restored-postgres-validation.json",
    },
    productWorkflow: {
      chatId: "chat_contract",
      sourceId: "source_contract",
      runId: "run_contract",
    },
    logRedaction: {
      status: "passed",
      sourceScannedPodLogEntries: 3,
      restoreScannedPodLogEntries: 3,
      generatedSecretValuesChecked: 9,
      rawContentSentinelsChecked: 1,
    },
  };
}

function validLiveEdgeEnforcement() {
  return {
    schemaVersion: "romeo.live-edge-enforcement.v1",
    generatedAt: generatedAtNow(),
    status: "passed",
    mode: "live",
    target: {
      deployment: "edge",
      origin: "https://romeo.example.com",
    },
    checks: [
      "security_headers_present",
      "hsts_header_present",
      "admin_edge_posture_readback",
      "waf_or_gateway_probe_blocked",
      "oversized_request_rejected",
      "public_rate_limit_enforced",
      "raw_probe_payload_not_retained",
    ],
    securityHeaders: {
      status: "passed",
      matched: [
        "x-content-type-options",
        "x-frame-options",
        "referrer-policy",
        "cross-origin-opener-policy",
        "permissions-policy",
        "strict-transport-security",
      ],
      missing: [],
      headerValuesReturned: false,
    },
    waf: {
      status: "passed",
      httpStatus: 403,
      responseBodyReturned: false,
    },
    requestBodyLimit: {
      status: "passed",
      httpStatus: 413,
      requestBodyReturned: false,
      responseBodyReturned: false,
    },
    rateLimit: {
      status: "passed",
      expectedStatus: 429,
      statuses: [200, 200, 429],
      responseBodyReturned: false,
    },
    redaction: {
      rawApiKeyReturned: false,
      rawHeaderValuesReturned: false,
      rawProbePayloadReturned: false,
      rawQueryValuesReturned: false,
      rawRequestBodiesReturned: false,
      rawResponseBodiesReturned: false,
    },
  };
}

function simple(schemaVersion) {
  return { schemaVersion, status: "passed" };
}

function generatedAtNow() {
  return new Date().toISOString();
}

function writeEvidenceSet(root, evidence) {
  for (const [path, value] of Object.entries(evidence)) {
    writeJson(join(root, path), value);
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function slug(value) {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}
