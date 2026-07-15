import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createGaEvidenceValidators } from "./lib/ga-evidence-validators.mjs";

const outputPath = argValue("--output") ?? "dist/release/ga-checklist.json";
const evidenceRoot = argValue("--evidence-root") ?? ".";
const exceptionsFile = argValue("--exceptions-file");
const strict = hasFlag("--strict");
const checklistProfile =
  argValue("--profile") ?? process.env.GA_CHECKLIST_PROFILE ?? "default-ga";
const requireFullProductEnterprise =
  checklistProfile === "full-product-enterprise" ||
  hasFlag("--require-full-product-enterprise") ||
  process.env.GA_REQUIRE_FULL_PRODUCT_ENTERPRISE === "true";
if (checklistProfile !== "default-ga" && !requireFullProductEnterprise) {
  throw new Error("--profile must be default-ga or full-product-enterprise.");
}
const requireQdrantDr =
  requireFullProductEnterprise ||
  hasFlag("--require-qdrant-dr") ||
  process.env.GA_REQUIRE_QDRANT_DR === "true";
const requireQdrantLive =
  requireFullProductEnterprise ||
  hasFlag("--require-qdrant-live") ||
  process.env.GA_REQUIRE_QDRANT_LIVE === "true";
const requireCiGovernanceLive =
  requireFullProductEnterprise ||
  hasFlag("--require-ci-governance-live") ||
  process.env.GA_REQUIRE_CI_GOVERNANCE_LIVE === "true";
const requireKeda =
  requireFullProductEnterprise ||
  hasFlag("--require-keda") ||
  process.env.GA_REQUIRE_KEDA === "true";
const requireBrowserAutomation =
  requireFullProductEnterprise ||
  hasFlag("--require-browser-automation") ||
  process.env.GA_REQUIRE_BROWSER_AUTOMATION === "true";
const requireIdentityLive =
  requireFullProductEnterprise ||
  hasFlag("--require-identity-live") ||
  process.env.GA_REQUIRE_IDENTITY_LIVE === "true";
const requireDataConnectorLive =
  requireFullProductEnterprise ||
  hasFlag("--require-data-connector-live") ||
  process.env.GA_REQUIRE_DATA_CONNECTOR_LIVE === "true";
const requireToolDispatchLive =
  requireFullProductEnterprise ||
  hasFlag("--require-tool-dispatch-live") ||
  process.env.GA_REQUIRE_TOOL_DISPATCH_LIVE === "true";
const requireVoiceProviderLive =
  requireFullProductEnterprise ||
  hasFlag("--require-voice-provider-live") ||
  process.env.GA_REQUIRE_VOICE_PROVIDER_LIVE === "true";
const requireNotificationAdapterLive =
  requireFullProductEnterprise ||
  hasFlag("--require-notification-adapter-live") ||
  process.env.GA_REQUIRE_NOTIFICATION_ADAPTER_LIVE === "true";
const requireAnalyticsAuthzLive =
  requireFullProductEnterprise ||
  hasFlag("--require-analytics-authz-live") ||
  process.env.GA_REQUIRE_ANALYTICS_AUTHZ_LIVE === "true";
const requireTargetQualityVectorComparison =
  requireFullProductEnterprise ||
  hasFlag("--require-target-quality-vector-comparison") ||
  process.env.GA_REQUIRE_TARGET_QUALITY_VECTOR_COMPARISON === "true";
const requireDataRightsRetentionLive =
  requireFullProductEnterprise ||
  hasFlag("--require-data-rights-retention-live") ||
  process.env.GA_REQUIRE_DATA_RIGHTS_RETENTION_LIVE === "true";
const requireBillingOperationsLive =
  requireFullProductEnterprise ||
  hasFlag("--require-billing-operations-live") ||
  process.env.GA_REQUIRE_BILLING_OPERATIONS_LIVE === "true";
const requireAuditIntegrityLive =
  requireFullProductEnterprise ||
  hasFlag("--require-audit-integrity-live") ||
  process.env.GA_REQUIRE_AUDIT_INTEGRITY_LIVE === "true";
const requireTenantPurgeLive =
  requireFullProductEnterprise ||
  hasFlag("--require-tenant-purge-live") ||
  process.env.GA_REQUIRE_TENANT_PURGE_LIVE === "true";
const requireSupportBundleLive =
  requireFullProductEnterprise ||
  hasFlag("--require-support-bundle-live") ||
  process.env.GA_REQUIRE_SUPPORT_BUNDLE_LIVE === "true";
const requireTargetResilienceDrills =
  requireFullProductEnterprise ||
  hasFlag("--require-target-resilience-drills") ||
  process.env.GA_REQUIRE_TARGET_RESILIENCE_DRILLS === "true";
const requirePostgresOperationsLive =
  requireFullProductEnterprise ||
  hasFlag("--require-postgres-operations-live") ||
  process.env.GA_REQUIRE_POSTGRES_OPERATIONS_LIVE === "true";
const generatedAt = new Date().toISOString();
const {
  validateKubernetesLiveSmokeEvidence,
  validateReleaseProvenanceEvidence,
  validateReleaseApprovalEvidence,
  validateReleaseReadbackValidationEvidence,
  validateKubernetesDrSmokeEvidence,
  validateKubernetesWorkerSmokeEvidence,
  validateKubernetesNetworkPolicyEvidence,
  validateKubernetesKedaSmokeEvidence,
  validateKubernetesLoadSoakEvidence,
  validateComposeProductSmokeEvidence,
  validateComposeWorkerSmokeEvidence,
  validateComposeBackupRestoreEvidence,
  validateKubernetesRenderEvidence,
  validateTenantIsolationEvidence,
  validateDocsCommandCheckEvidence,
  validateOpenApiRouteCoverageEvidence,
  validateBranchProtectionPlanEvidence,
  validateHostedCiRunEvidence,
  validateBranchProtectionVerificationEvidence,
  validateAuthProviderAcceptanceEvidence,
  validateDirectorySyncContractEvidence,
  validateScimLifecycleContractEvidence,
  validateAnalyticsAuthzContractEvidence,
  validateIdentityLiveEvidence,
  validateAnalyticsAuthzLiveEvidence,
  validateDataConnectorAcceptanceEvidence,
  validateDataConnectorLiveEvidence,
  validateModelToolOrchestrationContractEvidence,
  validateToolDispatchAcceptanceContractEvidence,
  validateToolDispatchLiveEvidence,
  validateRagVectorEnterpriseContractEvidence,
  validateVoiceProviderAcceptanceEvidence,
  validateVoiceProviderLiveEvidence,
  validateNotificationAdapterAcceptanceEvidence,
  validateNotificationAdapterLiveEvidence,
  validateNativeClientApiContractEvidence,
  validateBrowserAutomationContractEvidence,
  validateBrowserAutomationLiveEvidence,
  validateBillingOperationsEvidence,
  validateTenantPurgeEvidence,
  validateDataRightsRetentionEvidence,
  validateDataRightsRetentionContractEvidence,
  validateAuditIntegrityEvidence,
  validateSupportBundleEvidence,
  validateSupportBundleRedactionEvidence,
  validateProviderResilienceEvidence,
  validateProviderOutageEvidence,
  validateMigrationDrillEvidence,
  validateNetworkPartitionEvidence,
  validateSecretRotationDrillEvidence,
  validateJobLagSmokeEvidence,
  validateOperationalMonitoringEvidence,
  validateBackupUploadFailureEvidence,
  validatePostgresQueryPlanReviewEvidence,
  validatePostgresSlowQueryTelemetryEvidence,
  validatePostgresLockTelemetryEvidence,
  validatePostgresArchivalPartitioningDecisionEvidence,
  validateTargetQualityEvidence,
  validateKubernetesTieredRagSmokeEvidence,
  validateQdrantLiveEvidence,
  validateQdrantDrConsistencyEvidence,
  validateLiveAlertFiringEvidence,
  validateLiveEdgeEnforcementEvidence,
} = createGaEvidenceValidators({
  generatedAt,
  requireTargetQualityVectorComparison,
});
const exceptions =
  exceptionsFile === undefined ? [] : readExceptions(exceptionsFile);
const exceptionByGate = new Map(exceptions.map((item) => [item.gateId, item]));
const gates = gateDefinitions().map(evaluateGate);
const summary = summarize(gates);
const sanitizedExceptions = sanitizeExceptions(exceptions, gates);
const checklist = {
  schemaVersion: "romeo.ga-checklist.v1",
  generatedAt,
  status: summary.blocked === 0 ? "passed" : "blocked",
  strict,
  target: {
    profile: requireFullProductEnterprise
      ? "full-product-enterprise"
      : "default-ga",
    fullProductEnterpriseRequired: requireFullProductEnterprise,
    deploymentTiers: ["compose", "kubernetes"],
    postgresModes: ["cloudnativepg", "external-hosted-postgres"],
    qdrantLiveRequired: requireQdrantLive,
    qdrantDrRequired: requireQdrantDr,
    ciGovernanceLiveRequired: requireCiGovernanceLive,
    kedaRequired: requireKeda,
    browserAutomationRequired: requireBrowserAutomation,
    identityLiveRequired: requireIdentityLive,
    dataConnectorLiveRequired: requireDataConnectorLive,
    toolDispatchLiveRequired: requireToolDispatchLive,
    voiceProviderLiveRequired: requireVoiceProviderLive,
    notificationAdapterLiveRequired: requireNotificationAdapterLive,
    analyticsAuthzLiveRequired: requireAnalyticsAuthzLive,
    targetQualityVectorComparisonRequired: requireTargetQualityVectorComparison,
    dataRightsRetentionLiveRequired: requireDataRightsRetentionLive,
    billingOperationsLiveRequired: requireBillingOperationsLive,
    auditIntegrityLiveRequired: requireAuditIntegrityLive,
    tenantPurgeLiveRequired: requireTenantPurgeLive,
    supportBundleLiveRequired: requireSupportBundleLive,
    targetResilienceDrillsRequired: requireTargetResilienceDrills,
    postgresOperationsLiveRequired: requirePostgresOperationsLive,
  },
  summary,
  gates,
  exceptions: sanitizedExceptions,
};

writeJson(outputPath, checklist);
if (strict && checklist.status !== "passed") {
  console.error(
    `GA checklist is blocked: ${summary.blocked} gate(s) require evidence or approved exceptions.`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `Wrote Romeo GA checklist to ${outputPath} with status ${checklist.status}.`,
  );
}

function gateDefinitions() {
  return [
    gate({
      id: "phase19.greenfield_baseline_review",
      phase: "19",
      title: "Greenfield baseline migration review",
      evidence: [
        evidence("dist/ci/greenfield-baseline-review.json", {
          schemaVersion: "romeo.greenfield-baseline-review.v1",
          statuses: ["passed"],
        }),
      ],
      exceptionAllowed: false,
      securityCritical: true,
    }),
    gate({
      id: "phase19.postgres_schema_validation",
      phase: "19",
      title: "Live Postgres schema validation",
      evidence: [
        evidence("dist/ci/postgres-schema-validation.json", {
          schemaVersion: "romeo.postgres-schema-validation.v1",
          statuses: ["passed"],
        }),
      ],
      exceptionAllowed: false,
      securityCritical: true,
    }),
    gate({
      id: "phase19.repository_conformance",
      phase: "19",
      title: "Repository conformance coverage",
      evidence: [
        evidence("dist/ci/repository-conformance.json", {
          schemaVersion: "romeo.repository-conformance-coverage.v1",
          statuses: ["passed"],
        }),
      ],
      exceptionAllowed: false,
      securityCritical: true,
    }),
    gate({
      id: "phase20.compose_product_smoke",
      phase: "20",
      title: "Compose product workflow smoke",
      evidence: [
        evidence("dist/ci/compose-smoke.json", {
          schemaVersion: "romeo.compose-smoke.v1",
          statuses: ["passed"],
          validator: validateComposeProductSmokeEvidence,
        }),
      ],
      exceptionAllowed: false,
    }),
    gate({
      id: "phase20.compose_workers_smoke",
      phase: "20",
      title: "Compose worker smoke and restart evidence",
      evidence: [
        evidence("dist/ci/compose-workers-smoke.json", {
          schemaVersion: "romeo.compose-workers-smoke.v1",
          statuses: ["passed"],
          validator: validateComposeWorkerSmokeEvidence,
        }),
      ],
      exceptionAllowed: false,
    }),
    gate({
      id: "phase20.compose_backup_restore",
      phase: "20",
      title: "Compose database and object-store DR smoke",
      evidence: [
        evidence("dist/ci/compose-backup-restore-smoke.json", {
          schemaVersion: "romeo.compose-backup-restore-smoke.v1",
          statuses: ["passed"],
          validator: validateComposeBackupRestoreEvidence,
        }),
      ],
      exceptionAllowed: false,
      securityCritical: true,
    }),
    gate({
      id: "phase21.kubernetes_render_contract",
      phase: "21",
      title: "Kubernetes Helm render contract",
      evidence: [
        evidence("dist/ci/kubernetes-render-smoke.json", {
          schemaVersion: "romeo.kubernetes-render-smoke.v1",
          statuses: ["passed"],
          validator: validateKubernetesRenderEvidence,
        }),
      ],
      exceptionAllowed: false,
    }),
    gate({
      id: "phase21.kubernetes_live_smoke",
      phase: "21",
      title: "Kubernetes live namespace smoke",
      evidence: [
        evidence("dist/ci/kubernetes-live-smoke.json", {
          schemaVersion: "romeo.kubernetes-live-smoke.v1",
          statuses: ["passed"],
          validator: validateKubernetesLiveSmokeEvidence,
        }),
      ],
      exceptionAllowed: false,
      environmentRequired: true,
    }),
    gate({
      id: "phase21.kubernetes_networkpolicy_enforcement",
      phase: "21",
      title: "Kubernetes NetworkPolicy CNI enforcement",
      evidence: [
        evidence("dist/ci/kubernetes-networkpolicy-smoke.json", {
          schemaVersion: "romeo.kubernetes-networkpolicy-smoke.v1",
          statuses: ["passed"],
          validator: validateKubernetesNetworkPolicyEvidence,
        }),
      ],
      exceptionAllowed: false,
      environmentRequired: true,
      securityCritical: true,
    }),
    ...(requireKeda
      ? [
          gate({
            id: "phase21.kubernetes_keda_scaler",
            phase: "21",
            title: "Kubernetes KEDA webhook-retry scaler evidence",
            evidence: [
              evidence("dist/ci/kubernetes-keda-smoke.json", {
                schemaVersion: "romeo.kubernetes-keda-smoke.v1",
                statuses: ["passed"],
                validator: validateKubernetesKedaSmokeEvidence,
              }),
            ],
            exceptionAllowed: false,
            environmentRequired: true,
          }),
        ]
      : []),
    gate({
      id: "phase21.kubernetes_dr_modes",
      phase: "21",
      title: "Kubernetes CloudNativePG and external Postgres DR evidence",
      evidence: [
        evidence("dist/ci/kubernetes-cloudnativepg-dr.json", {
          schemaVersion: "romeo.kubernetes-dr-smoke.v1",
          statuses: ["passed"],
          validator: (content) =>
            validateKubernetesDrSmokeEvidence(content, "cloudnativepg"),
        }),
        evidence("dist/ci/kubernetes-external-postgres-dr.json", {
          schemaVersion: "romeo.kubernetes-dr-smoke.v1",
          statuses: ["passed"],
          validator: (content) =>
            validateKubernetesDrSmokeEvidence(content, "external-postgres"),
        }),
      ],
      exceptionAllowed: false,
      environmentRequired: true,
      securityCritical: true,
    }),
    gate({
      id: "phase25.kubernetes_workers_smoke",
      phase: "25",
      title: "Kubernetes worker CronJob and crash-recovery smoke",
      evidence: [
        evidence("dist/ci/kubernetes-workers-smoke.json", {
          schemaVersion: "romeo.kubernetes-workers-smoke.v1",
          statuses: ["passed"],
          validator: validateKubernetesWorkerSmokeEvidence,
        }),
      ],
      exceptionAllowed: false,
      environmentRequired: true,
    }),
    gate({
      id: "phase22.openapi_route_coverage",
      phase: "22",
      title: "Native and opt-in bridge OpenAPI route coverage",
      evidence: [
        evidence("dist/ci/openapi-route-coverage.json", {
          schemaVersion: "romeo.openapi-route-coverage.v1",
          statuses: ["passed"],
          validator: (content) =>
            validateOpenApiRouteCoverageEvidence(content, false),
        }),
        evidence("dist/ci/openapi-route-coverage-openwebui.json", {
          schemaVersion: "romeo.openapi-route-coverage.v1",
          statuses: ["passed"],
          validator: (content) =>
            validateOpenApiRouteCoverageEvidence(content, true),
        }),
      ],
      exceptionAllowed: false,
      securityCritical: true,
    }),
    gate({
      id: "phase22.release_security",
      phase: "22",
      title: "Release security evidence",
      evidence: [
        evidence("dist/release/security-evidence.json", {
          schemaVersion: "romeo.security-evidence.v1",
          statuses: ["pass"],
        }),
        evidence("dist/release/sbom.cdx.json", {
          validator: (content) =>
            content.bomFormat === "CycloneDX"
              ? { status: "pass" }
              : { status: "fail", reason: "not_cyclonedx" },
        }),
        evidence("dist/release/release-provenance.json", {
          schemaVersion: "romeo.release-provenance.v1",
          statuses: ["passed"],
          validator: validateReleaseProvenanceEvidence,
        }),
        evidence("dist/release/release-approval.json", {
          schemaVersion: "romeo.release-approval.v1",
          statuses: ["passed"],
          validator: validateReleaseApprovalEvidence,
        }),
      ],
      exceptionAllowed: false,
      securityCritical: true,
    }),
    ...(requireCiGovernanceLive
      ? [
          gate({
            id: "phase22.ci_governance_live",
            phase: "22",
            title: "Hosted CI and branch-protection governance evidence",
            evidence: [
              evidence("dist/ci/branch-protection-plan.json", {
                schemaVersion: "romeo.branch-protection-plan.v1",
                statuses: ["passed"],
                validator: validateBranchProtectionPlanEvidence,
              }),
              evidence("dist/ci/hosted-ci-run-verification.json", {
                schemaVersion: "romeo.hosted-ci-run-verification.v1",
                statuses: ["passed"],
                validator: validateHostedCiRunEvidence,
              }),
              evidence("dist/ci/branch-protection-verification.json", {
                schemaVersion: "romeo.branch-protection-verification.v1",
                statuses: ["passed"],
                validator: validateBranchProtectionVerificationEvidence,
              }),
            ],
            exceptionAllowed: false,
            environmentRequired: true,
            securityCritical: true,
          }),
        ]
      : []),
    gate({
      id: "phase22.credentialed_release_readback",
      phase: "22",
      title: "Credentialed release publish and readback",
      evidence: [
        evidence("dist/release/readback-validation.json", {
          schemaVersion: "romeo.release-readback-validation.v1",
          statuses: ["pass"],
          validator: validateReleaseReadbackValidationEvidence,
        }),
      ],
      exceptionAllowed: false,
      environmentRequired: true,
      securityCritical: true,
    }),
    gate({
      id: "phase23.enterprise_identity_contracts",
      phase: "23",
      title: "Enterprise identity provider, directory-sync, and SCIM contracts",
      evidence: [
        evidence("dist/ci/auth-provider-acceptance-contract-smoke.json", {
          schemaVersion: "romeo.auth-provider-acceptance-contract-smoke.v1",
          statuses: ["passed"],
          validator: validateAuthProviderAcceptanceEvidence,
        }),
        evidence("dist/ci/directory-sync-contract-smoke.json", {
          schemaVersion: "romeo.directory-sync-contract-smoke.v1",
          statuses: ["passed"],
          validator: validateDirectorySyncContractEvidence,
        }),
        evidence("dist/ci/scim-lifecycle-contract-smoke.json", {
          schemaVersion: "romeo.scim-lifecycle-contract-smoke.v1",
          statuses: ["passed"],
          validator: validateScimLifecycleContractEvidence,
        }),
      ],
      exceptionAllowed: false,
      securityCritical: true,
    }),
    ...(requireIdentityLive
      ? [
          gate({
            id: "phase23.identity_live",
            phase: "23",
            title:
              "Target enterprise identity, directory, and access-review evidence",
            evidence: [
              evidence("dist/ci/identity-live-evidence.json", {
                schemaVersion: "romeo.identity-live-evidence.v1",
                statuses: ["passed"],
                validator: validateIdentityLiveEvidence,
              }),
            ],
            exceptionAllowed: false,
            environmentRequired: true,
            securityCritical: true,
          }),
        ]
      : []),
    gate({
      id: "phase32.backend_capability_contracts",
      phase: "32",
      title: "Backend capability acceptance contracts",
      evidence: [
        evidence("dist/ci/analytics-authz-contract-smoke.json", {
          schemaVersion: "romeo.analytics-authz-contract-smoke.v1",
          statuses: ["passed"],
          validator: validateAnalyticsAuthzContractEvidence,
        }),
        evidence("dist/ci/data-connector-acceptance-contract-smoke.json", {
          schemaVersion: "romeo.data-connector-acceptance-contract-smoke.v1",
          statuses: ["passed"],
          validator: validateDataConnectorAcceptanceEvidence,
        }),
        evidence("dist/ci/tool-dispatch-acceptance-contract-smoke.json", {
          schemaVersion: "romeo.tool-dispatch-acceptance-contract-smoke.v1",
          statuses: ["passed"],
          validator: validateToolDispatchAcceptanceContractEvidence,
        }),
        evidence("dist/ci/model-tool-orchestration-contract-smoke.json", {
          schemaVersion: "romeo.model-tool-orchestration-contract-smoke.v1",
          statuses: ["passed"],
          validator: validateModelToolOrchestrationContractEvidence,
        }),
        evidence("dist/ci/rag-vector-enterprise-contract-smoke.json", {
          schemaVersion: "romeo.rag-vector-enterprise-contract-smoke.v1",
          statuses: ["passed"],
          validator: validateRagVectorEnterpriseContractEvidence,
        }),
        evidence("dist/ci/voice-provider-acceptance-contract-smoke.json", {
          schemaVersion: "romeo.voice-provider-acceptance-contract-smoke.v1",
          statuses: ["passed"],
          validator: validateVoiceProviderAcceptanceEvidence,
        }),
        evidence(
          "dist/ci/notification-adapter-acceptance-contract-smoke.json",
          {
            schemaVersion:
              "romeo.notification-adapter-acceptance-contract-smoke.v1",
            statuses: ["passed"],
            validator: validateNotificationAdapterAcceptanceEvidence,
          },
        ),
        evidence("dist/ci/native-client-api-contract-smoke.json", {
          schemaVersion: "romeo.native-client-api-contract-smoke.v1",
          statuses: ["passed"],
          validator: validateNativeClientApiContractEvidence,
        }),
        evidence("dist/ci/browser-automation-contract-smoke.json", {
          schemaVersion: "romeo.browser-automation-contract-smoke.v1",
          statuses: ["passed"],
          validator: validateBrowserAutomationContractEvidence,
        }),
      ],
      exceptionAllowed: false,
      securityCritical: true,
    }),
    ...(requireAnalyticsAuthzLive
      ? [
          gate({
            id: "phase32.analytics_authz_live",
            phase: "32",
            title: "Target analytics authorization and export evidence",
            evidence: [
              evidence("dist/ci/analytics-authz-live-evidence.json", {
                schemaVersion: "romeo.analytics-authz-live-evidence.v1",
                statuses: ["passed"],
                validator: validateAnalyticsAuthzLiveEvidence,
              }),
            ],
            exceptionAllowed: false,
            environmentRequired: true,
            securityCritical: true,
          }),
        ]
      : []),
    ...(requireDataConnectorLive
      ? [
          gate({
            id: "phase31.data_connector_live_worker",
            phase: "31",
            title: "Live outbound data connector worker and CNI evidence",
            evidence: [
              evidence("dist/ci/data-connector-live-evidence.json", {
                schemaVersion: "romeo.data-connector-live-evidence.v1",
                statuses: ["passed"],
                validator: validateDataConnectorLiveEvidence,
              }),
            ],
            exceptionAllowed: false,
            environmentRequired: true,
            securityCritical: true,
          }),
        ]
      : []),
    ...(requireToolDispatchLive
      ? [
          gate({
            id: "phase25.tool_dispatch_live_worker",
            phase: "25",
            title: "Live tool-dispatch worker and egress evidence",
            evidence: [
              evidence("dist/ci/tool-dispatch-live-evidence.json", {
                schemaVersion: "romeo.tool-dispatch-live-evidence.v1",
                statuses: ["passed"],
                validator: validateToolDispatchLiveEvidence,
              }),
            ],
            exceptionAllowed: false,
            environmentRequired: true,
            securityCritical: true,
          }),
        ]
      : []),
    ...(requireVoiceProviderLive
      ? [
          gate({
            id: "phase32.voice_provider_live",
            phase: "32",
            title: "Target voice provider live TTS/STT evidence",
            evidence: [
              evidence("dist/ci/voice-provider-live-evidence.json", {
                schemaVersion: "romeo.voice-provider-live-evidence.v1",
                statuses: ["passed"],
                validator: validateVoiceProviderLiveEvidence,
              }),
            ],
            exceptionAllowed: false,
            environmentRequired: true,
            securityCritical: true,
          }),
        ]
      : []),
    ...(requireNotificationAdapterLive
      ? [
          gate({
            id: "phase32.notification_adapter_live",
            phase: "32",
            title: "Target notification adapter live egress evidence",
            evidence: [
              evidence("dist/ci/notification-adapter-live-evidence.json", {
                schemaVersion: "romeo.notification-adapter-live-evidence.v1",
                statuses: ["passed"],
                validator: validateNotificationAdapterLiveEvidence,
              }),
            ],
            exceptionAllowed: false,
            environmentRequired: true,
            securityCritical: true,
          }),
        ]
      : []),
    ...(requireBrowserAutomation
      ? [
          gate({
            id: "phase31.browser_automation_live_runner",
            phase: "31",
            title: "Live browser automation runner and sandbox evidence",
            evidence: [
              evidence("dist/ci/browser-automation-live-evidence.json", {
                schemaVersion: "romeo.browser-automation-live-evidence.v1",
                statuses: ["passed"],
                validator: validateBrowserAutomationLiveEvidence,
              }),
            ],
            exceptionAllowed: false,
            environmentRequired: true,
            securityCritical: true,
          }),
        ]
      : []),
    gate({
      id: "phase32.target_quality_evidence",
      phase: "32",
      title: "Target-deployment quality evidence",
      evidence: [
        evidence("dist/ci/target-quality-evidence.json", {
          schemaVersion: "romeo.target-quality-evidence.v1",
          statuses: ["passed"],
          validator: validateTargetQualityEvidence,
        }),
      ],
      exceptionAllowed: false,
      environmentRequired: true,
      securityCritical: true,
    }),
    gate({
      id: "phase33.tenant_isolation_negative_suite",
      phase: "33",
      title: "Tenant isolation negative suite",
      evidence: [
        evidence("dist/ci/tenant-isolation-negative-suite.json", {
          schemaVersion: "romeo.tenant-isolation-negative-suite.v1",
          statuses: ["passed"],
          validator: validateTenantIsolationEvidence,
        }),
      ],
      exceptionAllowed: true,
      securityCritical: true,
    }),
    gate({
      id: "phase33.data_rights_retention_contract",
      phase: "33",
      title: "Data-rights retention evidence contract",
      evidence: [
        evidence("dist/ci/data-rights-retention-contract-smoke.json", {
          schemaVersion: "romeo.data-rights-retention-contract-smoke.v1",
          statuses: ["passed"],
          validator: validateDataRightsRetentionContractEvidence,
        }),
      ],
      exceptionAllowed: false,
      securityCritical: true,
    }),
    ...(requireBillingOperationsLive
      ? [
          gate({
            id: "phase33.billing_operations_live",
            phase: "33",
            title: "Target billing operations worker cadence and alerting",
            evidence: [
              evidence("dist/ci/billing-operations-evidence.json", {
                schemaVersion: "romeo.billing-operations-evidence.v1",
                statuses: ["passed"],
                validator: validateBillingOperationsEvidence,
              }),
            ],
            exceptionAllowed: false,
            environmentRequired: true,
            securityCritical: true,
          }),
        ]
      : []),
    ...(requireAuditIntegrityLive
      ? [
          gate({
            id: "phase33.audit_integrity_live",
            phase: "33",
            title: "Target audit integrity, SIEM export, and WORM evidence",
            evidence: [
              evidence("dist/ci/audit-integrity-evidence.json", {
                schemaVersion: "romeo.audit-integrity-evidence.v1",
                statuses: ["passed"],
                validator: validateAuditIntegrityEvidence,
              }),
            ],
            exceptionAllowed: false,
            environmentRequired: true,
            securityCritical: true,
          }),
        ]
      : []),
    ...(requireTenantPurgeLive
      ? [
          gate({
            id: "phase33.tenant_purge_live",
            phase: "33",
            title: "Target tenant purge and external storage-class evidence",
            evidence: [
              evidence("dist/ci/tenant-purge-evidence.json", {
                schemaVersion: "romeo.tenant-purge-evidence.v1",
                statuses: ["passed"],
                validator: validateTenantPurgeEvidence,
              }),
            ],
            exceptionAllowed: false,
            environmentRequired: true,
            securityCritical: true,
          }),
        ]
      : []),
    ...(requireDataRightsRetentionLive
      ? [
          gate({
            id: "phase33.data_rights_retention_live",
            phase: "33",
            title: "Target data-rights retention evidence",
            evidence: [
              evidence(
                "dist/ci/data-rights-operational-log-retention-evidence.json",
                {
                  schemaVersion: "romeo.data-rights-retention-evidence.v1",
                  statuses: ["passed"],
                  validator: (content) =>
                    validateDataRightsRetentionEvidence(
                      content,
                      "operational_logs",
                    ),
                },
              ),
              evidence("dist/ci/data-rights-backup-retention-evidence.json", {
                schemaVersion: "romeo.data-rights-retention-evidence.v1",
                statuses: ["passed"],
                validator: (content) =>
                  validateDataRightsRetentionEvidence(content, "backups"),
              }),
            ],
            exceptionAllowed: false,
            environmentRequired: true,
            securityCritical: true,
          }),
        ]
      : []),
    gate({
      id: "phase32.kubernetes_tiered_rag_smoke",
      phase: "32",
      title: "Kubernetes tiered RAG isolation smoke",
      evidence: [
        evidence("dist/ci/kubernetes-tiered-rag-smoke.json", {
          schemaVersion: "romeo.kubernetes-tiered-rag-smoke.v1",
          statuses: ["passed"],
          validator: validateKubernetesTieredRagSmokeEvidence,
        }),
      ],
      exceptionAllowed: false,
      environmentRequired: true,
      securityCritical: true,
    }),
    ...(requireQdrantLive
      ? [
          gate({
            id: "phase32.qdrant_live_evidence",
            phase: "32",
            title: "Live Qdrant external-vector isolation evidence",
            evidence: [
              evidence("dist/ci/qdrant-live-evidence.json", {
                schemaVersion: "romeo.qdrant-live-evidence.v1",
                statuses: ["passed"],
                validator: validateQdrantLiveEvidence,
              }),
            ],
            exceptionAllowed: false,
            environmentRequired: true,
            securityCritical: true,
          }),
        ]
      : []),
    ...(requireQdrantDr
      ? [
          gate({
            id: "phase32.qdrant_dr_consistency",
            phase: "32",
            title: "Qdrant external-vector restored-stack consistency",
            evidence: [
              evidence("dist/ci/qdrant-dr-source.json", {
                schemaVersion: "romeo.qdrant-dr-consistency.v1",
                statuses: ["passed"],
                validator: (content) =>
                  validateQdrantDrConsistencyEvidence(
                    content,
                    "prepare-source",
                  ),
              }),
              evidence("dist/ci/qdrant-dr-restore.json", {
                schemaVersion: "romeo.qdrant-dr-consistency.v1",
                statuses: ["passed"],
                validator: (content) =>
                  validateQdrantDrConsistencyEvidence(
                    content,
                    "verify-restore",
                  ),
              }),
              evidence("dist/ci/qdrant-dr-source-cleanup.json", {
                schemaVersion: "romeo.qdrant-dr-consistency.v1",
                statuses: ["passed"],
                validator: (content) =>
                  validateQdrantDrConsistencyEvidence(
                    content,
                    "cleanup-source",
                  ),
              }),
            ],
            exceptionAllowed: false,
            environmentRequired: true,
            securityCritical: true,
          }),
        ]
      : []),
    gate({
      id: "phase33.live_edge_enforcement",
      phase: "33",
      title: "Live edge, WAF, body-limit, and public rate-limit enforcement",
      evidence: [
        evidence("dist/ci/live-edge-enforcement.json", {
          schemaVersion: "romeo.live-edge-enforcement.v1",
          statuses: ["passed"],
          validator: validateLiveEdgeEnforcementEvidence,
        }),
      ],
      exceptionAllowed: false,
      environmentRequired: true,
      securityCritical: true,
    }),
    gate({
      id: "phase34.provider_resilience_smoke",
      phase: "34",
      title: "Provider resilience smoke",
      evidence: [
        evidence("dist/ci/provider-resilience-smoke.json", {
          schemaVersion: "romeo.provider-resilience-smoke.v1",
          statuses: ["passed"],
          validator: validateProviderResilienceEvidence,
        }),
      ],
      exceptionAllowed: false,
    }),
    ...(requireTargetResilienceDrills
      ? [
          gate({
            id: "phase34.target_resilience_drills",
            phase: "34",
            title:
              "Target provider outage, migration, network, and secret-rotation drills",
            evidence: [
              evidence("dist/ci/provider-outage-evidence.json", {
                schemaVersion: "romeo.provider-outage-evidence.v1",
                statuses: ["passed"],
                validator: validateProviderOutageEvidence,
              }),
              evidence("dist/ci/migration-drill-evidence.json", {
                schemaVersion: "romeo.migration-drill-evidence.v1",
                statuses: ["passed"],
                validator: validateMigrationDrillEvidence,
              }),
              evidence("dist/ci/network-partition-evidence.json", {
                schemaVersion: "romeo.network-partition-evidence.v1",
                statuses: ["passed"],
                validator: validateNetworkPartitionEvidence,
              }),
              evidence("dist/ci/secret-rotation-drill-evidence.json", {
                schemaVersion: "romeo.secret-rotation-drill-evidence.v1",
                statuses: ["passed"],
                validator: validateSecretRotationDrillEvidence,
              }),
            ],
            exceptionAllowed: false,
            environmentRequired: true,
            securityCritical: true,
          }),
        ]
      : []),
    gate({
      id: "phase34.job_lag_smoke",
      phase: "34",
      title: "Background job lag smoke",
      evidence: [
        evidence("dist/ci/job-lag-smoke.json", {
          schemaVersion: "romeo.job-lag-smoke.v1",
          statuses: ["passed"],
          validator: validateJobLagSmokeEvidence,
        }),
      ],
      exceptionAllowed: false,
    }),
    gate({
      id: "phase34.operational_monitoring_contract",
      phase: "34",
      title: "Operational monitoring exporter and alert contract",
      evidence: [
        evidence("dist/ci/operational-monitoring-validation.json", {
          schemaVersion: "romeo.operational-monitoring-validation.v1",
          statuses: ["passed"],
          validator: validateOperationalMonitoringEvidence,
        }),
      ],
      exceptionAllowed: false,
    }),
    gate({
      id: "phase34.backup_upload_failure_smoke",
      phase: "34",
      title: "Backup upload failure smoke",
      evidence: [
        evidence("dist/ci/postgres-backup-upload-failure-smoke.json", {
          schemaVersion: "romeo.postgres-backup-upload-failure-smoke.v1",
          statuses: ["passed"],
          validator: validateBackupUploadFailureEvidence,
        }),
      ],
      exceptionAllowed: false,
      securityCritical: true,
    }),
    ...(requirePostgresOperationsLive
      ? [
          gate({
            id: "phase34.postgres_operations_live",
            phase: "34",
            title: "Target Postgres operational evidence",
            evidence: [
              evidence("dist/ci/postgres-query-plan-review.json", {
                schemaVersion: "romeo.postgres-query-plan-review.v1",
                statuses: ["passed"],
                validator: validatePostgresQueryPlanReviewEvidence,
              }),
              evidence("dist/ci/postgres-slow-query-telemetry.json", {
                schemaVersion: "romeo.postgres-slow-query-telemetry.v1",
                statuses: ["passed"],
                validator: validatePostgresSlowQueryTelemetryEvidence,
              }),
              evidence("dist/ci/postgres-lock-telemetry.json", {
                schemaVersion: "romeo.postgres-lock-telemetry.v1",
                statuses: ["passed"],
                validator: validatePostgresLockTelemetryEvidence,
              }),
              evidence("dist/ci/postgres-archival-partitioning-decision.json", {
                schemaVersion:
                  "romeo.postgres-archival-partitioning-decision.v1",
                statuses: ["accepted"],
                validator: validatePostgresArchivalPartitioningDecisionEvidence,
              }),
            ],
            exceptionAllowed: false,
            environmentRequired: true,
            securityCritical: true,
          }),
        ]
      : []),
    gate({
      id: "phase34.live_alert_firing",
      phase: "34",
      title:
        "Live provider, queue-lag, dead-letter, and backup-failure alert firing",
      evidence: [
        evidence("dist/ci/live-alert-firing.json", {
          schemaVersion: "romeo.live-alert-firing.v1",
          statuses: ["passed"],
          validator: validateLiveAlertFiringEvidence,
        }),
      ],
      exceptionAllowed: false,
      environmentRequired: true,
    }),
    gate({
      id: "phase34.kubernetes_load_soak",
      phase: "34",
      title: "Kubernetes load and soak evidence for selected tier",
      evidence: [
        evidence("dist/ci/kubernetes-load-soak.json", {
          schemaVersion: "romeo.kubernetes-load-soak.v1",
          statuses: ["passed"],
          validator: validateKubernetesLoadSoakEvidence,
        }),
      ],
      exceptionAllowed: false,
      environmentRequired: true,
    }),
    gate({
      id: "phase35.docs_command_check",
      phase: "35",
      title: "Operator documentation command check",
      evidence: [
        evidence("dist/ci/docs-command-check.json", {
          schemaVersion: "romeo.docs-command-check.v1",
          statuses: ["passed"],
          validator: validateDocsCommandCheckEvidence,
        }),
      ],
      exceptionAllowed: true,
    }),
    ...(requireSupportBundleLive
      ? [
          gate({
            id: "phase35.support_bundle_live",
            phase: "35",
            title: "Target support bundle evidence",
            evidence: [
              evidence("dist/ci/support-bundle.json", {
                schemaVersion: "romeo.support-bundle.v1",
                statuses: ["generated"],
                validator: validateSupportBundleEvidence,
              }),
            ],
            exceptionAllowed: false,
            environmentRequired: true,
            securityCritical: true,
          }),
        ]
      : []),
    gate({
      id: "phase35.support_bundle_redaction",
      phase: "35",
      title: "Support bundle redaction evidence",
      evidence: [
        evidence("dist/ci/support-bundle-redaction.json", {
          schemaVersion: "romeo.support-bundle-redaction.v1",
          statuses: ["passed"],
          validator: validateSupportBundleRedactionEvidence,
        }),
      ],
      exceptionAllowed: true,
      securityCritical: true,
    }),
  ];
}

function gate(input) {
  return {
    exceptionAllowed: true,
    environmentRequired: false,
    securityCritical: false,
    ...input,
  };
}

function evidence(path, options = {}) {
  return { path, statuses: ["passed", "pass"], ...options };
}

function evaluateGate(definition) {
  const evidenceResults = definition.evidence.map(evaluateEvidence);
  const satisfied = evidenceResults.every(
    (item) => item.status === "satisfied",
  );
  const exception = exceptionByGate.get(definition.id);
  const exceptionResult =
    exception === undefined
      ? undefined
      : validateException(definition, exception);
  const excepted =
    !satisfied &&
    exceptionResult !== undefined &&
    exceptionResult.status === "valid";
  const status = satisfied ? "satisfied" : excepted ? "excepted" : "blocked";
  return {
    id: definition.id,
    phase: definition.phase,
    title: definition.title,
    status,
    requiredForGa: true,
    exceptionAllowed: definition.exceptionAllowed,
    environmentRequired: definition.environmentRequired,
    securityCritical: definition.securityCritical,
    evidence: evidenceResults,
    ...(exceptionResult === undefined ? {} : { exception: exceptionResult }),
  };
}

function evaluateEvidence(item) {
  const absolute = resolve(evidenceRoot, item.path);
  if (!existsSync(absolute)) {
    return { path: item.path, status: "missing" };
  }
  let content;
  try {
    content = JSON.parse(readFileSync(absolute, "utf8"));
  } catch {
    return { path: item.path, status: "invalid_json" };
  }

  const failures = [];
  if (
    item.schemaVersion !== undefined &&
    content.schemaVersion !== item.schemaVersion
  ) {
    failures.push(
      `schema:${String(content.schemaVersion ?? "missing")}!=${item.schemaVersion}`,
    );
  }
  if (
    item.statuses !== undefined &&
    content.status !== undefined &&
    !item.statuses.includes(content.status)
  ) {
    failures.push(`status:${content.status}`);
  }
  if (item.validator !== undefined) {
    const result = item.validator(content);
    if (result.status !== "pass") failures.push(result.reason);
  }
  return failures.length === 0
    ? {
        path: item.path,
        status: "satisfied",
        schemaVersion: content.schemaVersion,
        evidenceStatus: content.status,
      }
    : {
        path: item.path,
        status: "failed",
        schemaVersion: content.schemaVersion,
        evidenceStatus: content.status,
        failures,
      };
}

function validateException(gate, exception) {
  const failures = [];
  for (const field of [
    "owner",
    "approvedBy",
    "expiresAt",
    "rationale",
    "riskAcceptance",
  ]) {
    if (typeof exception[field] !== "string" || exception[field].length === 0) {
      failures.push(`missing_${field}`);
    }
  }
  if (
    typeof exception.expiresAt === "string" &&
    Number.isNaN(Date.parse(exception.expiresAt))
  ) {
    failures.push("invalid_expiresAt");
  } else if (
    typeof exception.expiresAt === "string" &&
    Date.parse(exception.expiresAt) <= Date.parse(generatedAt)
  ) {
    failures.push("expired");
  }
  if (gate.exceptionAllowed === false)
    failures.push("gate_not_exception_allowed");
  if (gate.securityCritical && exception.seniorApproval !== true) {
    failures.push("security_exception_requires_senior_approval");
  }
  return {
    gateId: gate.id,
    status: failures.length === 0 ? "valid" : "invalid",
    ...(typeof exception.expiresAt === "string" &&
    !Number.isNaN(Date.parse(exception.expiresAt))
      ? { expiresAt: exception.expiresAt }
      : {}),
    seniorApproval: exception.seniorApproval === true,
    failures,
  };
}

function sanitizeExceptions(rawExceptions, evaluatedGates) {
  const byGate = new Map(
    evaluatedGates
      .filter((gate) => gate.exception !== undefined)
      .map((gate) => [gate.id, gate.exception]),
  );
  return rawExceptions.map((exception) => {
    const gateId = safeGateId(exception?.gateId);
    const gateException = byGate.get(gateId);
    if (gateException !== undefined) {
      return sanitizeExceptionResult(gateException);
    }
    return removeUndefined({
      gateId,
      status: "invalid",
      expiresAt: safeTimestamp(exception?.expiresAt),
      seniorApproval: exception?.seniorApproval === true,
      failures: [
        gateId === "invalid_gate_id" ? "invalid_gate_id" : "unknown_gate",
      ],
    });
  });
}

function sanitizeExceptionResult(exception) {
  return removeUndefined({
    gateId: safeGateId(exception.gateId),
    status: exception.status === "valid" ? "valid" : "invalid",
    expiresAt: safeTimestamp(exception.expiresAt),
    seniorApproval: exception.seniorApproval === true,
    failures: Array.isArray(exception.failures)
      ? exception.failures.filter((failure) => typeof failure === "string")
      : [],
  });
}

function safeGateId(value) {
  return typeof value === "string" && /^[a-z0-9._:-]{1,120}$/u.test(value)
    ? value
    : "invalid_gate_id";
}

function safeTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
    ? value
    : undefined;
}

function removeUndefined(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}

function summarize(gates) {
  return {
    total: gates.length,
    satisfied: gates.filter((gate) => gate.status === "satisfied").length,
    excepted: gates.filter((gate) => gate.status === "excepted").length,
    blocked: gates.filter((gate) => gate.status === "blocked").length,
    environmentRequired: gates.filter(
      (gate) => gate.status === "blocked" && gate.environmentRequired,
    ).length,
    securityCriticalBlocked: gates.filter(
      (gate) => gate.status === "blocked" && gate.securityCritical,
    ).length,
  };
}

function readExceptions(path) {
  const content = JSON.parse(readFileSync(path, "utf8"));
  if (content.schemaVersion !== "romeo.ga-exceptions.v1") {
    throw new Error(
      "--exceptions-file must use schema romeo.ga-exceptions.v1.",
    );
  }
  if (!Array.isArray(content.exceptions)) {
    throw new Error("--exceptions-file must contain an exceptions array.");
  }
  return content.exceptions;
}

function writeJson(path, value) {
  const absolute = resolve(process.cwd(), path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}
