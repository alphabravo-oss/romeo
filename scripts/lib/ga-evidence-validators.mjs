export function createGaEvidenceValidators({
  generatedAt,
  requireTargetQualityVectorComparison = false,
}) {
  return {
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
    validateToolDispatchAcceptanceContractEvidence,
    validateModelToolOrchestrationContractEvidence,
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
    validateAuditIntegrityEvidence,
    validateTenantPurgeEvidence,
    validateDataRightsRetentionEvidence,
    validateDataRightsRetentionContractEvidence,
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
  };

  function pass() {
    return { status: "pass" };
  }

  function fail(reason) {
    return { status: "fail", reason };
  }

  function hasPassedCheck(content, name) {
    const checks = Array.isArray(content.checks) ? content.checks : [];
    return checks.some(
      (check) =>
        check === name ||
        (check?.name === name &&
          (check.status === "pass" || check.status === "passed")),
    );
  }

  function validateKubernetesLiveSmokeEvidence(content) {
    if (content.mode !== "live") return fail("kubernetes_live_smoke_not_live");
    const freshness = validateFreshLiveGeneratedAt(
      content,
      "kubernetes_live_smoke",
    );
    if (freshness !== undefined) return freshness;
    if (content.target?.deployment !== "kubernetes") {
      return fail("kubernetes_live_smoke_not_kubernetes");
    }
    for (const field of ["namespace", "releaseName", "appName", "image"]) {
      if (typeof content.target?.[field] !== "string") {
        return fail(`kubernetes_live_smoke_missing_target_${field}`);
      }
    }
    if (content.imagePosture?.appImageReviewed !== true) {
      return fail("kubernetes_live_smoke_app_image_not_reviewed");
    }
    if (content.imagePosture?.dependencyImagesDigestPinned !== true) {
      return fail("kubernetes_live_smoke_dependency_images_not_pinned");
    }
    const requiredChecks = [
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
    ];
    const checks = new Set(Array.isArray(content.checks) ? content.checks : []);
    for (const check of requiredChecks) {
      if (!checks.has(check)) {
        return fail(`kubernetes_live_smoke_missing_check:${check}`);
      }
    }
    for (const field of ["chatId", "sourceId", "runId", "webhookDeliveryId"]) {
      if (typeof content.productWorkflow?.[field] !== "string") {
        return fail(`kubernetes_live_smoke_missing_readback_${field}`);
      }
    }
    if (content.logRedaction?.status !== "passed") {
      return fail("kubernetes_live_smoke_log_redaction_missing");
    }
    if (
      !Number.isInteger(content.logRedaction.scannedPodLogEntries) ||
      content.logRedaction.scannedPodLogEntries < 1
    ) {
      return fail("kubernetes_live_smoke_log_redaction_missing_pod_scan");
    }
    if (
      !Number.isInteger(content.logRedaction.generatedSecretValuesChecked) ||
      content.logRedaction.generatedSecretValuesChecked < 8
    ) {
      return fail(
        "kubernetes_live_smoke_log_redaction_missing_generated_secrets",
      );
    }
    if (
      !Number.isInteger(content.logRedaction.rawAuthSentinelsChecked) ||
      content.logRedaction.rawAuthSentinelsChecked < 1
    ) {
      return fail("kubernetes_live_smoke_log_redaction_missing_auth_sentinel");
    }
    if (
      !Number.isInteger(content.logRedaction.rawContentSentinelsChecked) ||
      content.logRedaction.rawContentSentinelsChecked < 1
    ) {
      return fail(
        "kubernetes_live_smoke_log_redaction_missing_content_sentinel",
      );
    }
    return pass();
  }

  function validateReleaseProvenanceEvidence(content) {
    if (content.status !== "passed")
      return fail("release_provenance_not_passed");
    if (content.release?.name !== "romeo") {
      return fail("release_provenance_wrong_release");
    }
    for (const field of ["manifest", "channel", "securityEvidence", "sbom"]) {
      const evidence = content.release?.[field];
      if (
        typeof evidence?.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/u.test(evidence.sha256) ||
        !Number.isInteger(evidence.bytes) ||
        evidence.bytes <= 0
      ) {
        return fail(`release_provenance_missing_${field}`);
      }
    }
    if (
      !Array.isArray(content.release?.artifacts) ||
      content.release.artifacts.length < 1
    ) {
      return fail("release_provenance_missing_artifacts");
    }
    if (
      content.supplyChain?.sbomAttached !== true ||
      content.supplyChain?.securityEvidenceAttached !== true ||
      content.supplyChain?.releaseChannelAttached !== true
    ) {
      return fail("release_provenance_supply_chain_incomplete");
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "tokenValuesReturned",
        "secretValuesReturned",
        "fileBodiesReturned",
        "rawSignatureReturned",
        "rawAttestationReturned",
        "rawCiRunUrlReturned",
        "rawSourceRepoReturned",
        "rawSourceRefReturned",
        "environmentReturned",
      ])
    ) {
      return fail("release_provenance_redaction_missing");
    }
    return pass();
  }

  function validateReleaseApprovalEvidence(content) {
    if (content.status !== "passed") return fail("release_approval_not_passed");
    if (content.release?.name !== "romeo") {
      return fail("release_approval_wrong_release");
    }
    for (const field of ["manifest", "provenance"]) {
      const evidence = content.release?.[field];
      if (
        typeof evidence?.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/u.test(evidence.sha256) ||
        !Number.isInteger(evidence.bytes) ||
        evidence.bytes <= 0
      ) {
        return fail(`release_approval_missing_${field}`);
      }
    }
    const approverCount = content.approval?.approverCount;
    const minApprovers = content.approval?.minApprovers;
    const requiredApprovers = Math.max(
      Number.isInteger(minApprovers) ? minApprovers : 2,
      2,
    );
    if (!Number.isInteger(approverCount) || approverCount < requiredApprovers) {
      return fail("release_approval_approver_count_insufficient");
    }
    if (content.approval?.refConfigured !== true) {
      return fail("release_approval_reference_missing");
    }
    if (!validTimestamp(content.approval?.approvedAt)) {
      return fail("release_approval_approved_at_invalid");
    }
    if (content.approval?.expiresAt !== undefined) {
      if (!validTimestamp(content.approval.expiresAt)) {
        return fail("release_approval_expires_at_invalid");
      }
      if (Date.parse(content.approval.expiresAt) <= Date.parse(generatedAt)) {
        return fail("release_approval_expired");
      }
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "rawApproverIdsReturned",
        "rawApprovalRefReturned",
        "secretValuesReturned",
        "fileBodiesReturned",
        "rawProvenanceReturned",
        "environmentReturned",
      ])
    ) {
      return fail("release_approval_redaction_missing");
    }
    return pass();
  }

  function validateReleaseReadbackValidationEvidence(content) {
    if (content.mode === "planned_readback") {
      return fail("planned_readback_is_not_credentialed");
    }
    if (content.mode !== "live_readback") {
      return fail("release_readback_not_live");
    }
    if (!hasPassedCheck(content, "credentialed npm registry readback")) {
      return fail("release_readback_npm_not_credentialed");
    }
    const required = content.required ?? {};
    if (!Array.isArray(required.packages) || required.packages.length < 1) {
      return fail("release_readback_required_packages_missing");
    }
    if (!Array.isArray(required.images) || required.images.length < 1) {
      return fail("release_readback_required_image_missing");
    }
    for (const image of required.images) {
      if (typeof image !== "string" || image.length === 0) {
        return fail("release_readback_required_image_invalid");
      }
      if (
        !hasPassedCheck(content, `${image} image registry readback is verified`)
      ) {
        return fail(`release_readback_image_not_verified:${image}`);
      }
    }
    if (!Array.isArray(required.charts) || required.charts.length < 1) {
      return fail("release_readback_required_chart_missing");
    }
    for (const chart of required.charts) {
      const name = chart?.name;
      const version = chart?.version;
      if (typeof name !== "string" || typeof version !== "string") {
        return fail("release_readback_required_chart_invalid");
      }
      if (
        !hasPassedCheck(
          content,
          `${name} chart repository readback is verified`,
        )
      ) {
        return fail(`release_readback_chart_not_verified:${name}`);
      }
    }
    const requiredAssets = new Map(
      Array.isArray(required.assets)
        ? required.assets
            .filter((asset) => typeof asset?.name === "string")
            .map((asset) => [asset.name, asset])
        : [],
    );
    for (const name of [
      "release-channel",
      "security-evidence",
      "sbom",
      "provenance",
      "approval",
    ]) {
      const asset = requiredAssets.get(name);
      if (asset === undefined) {
        return fail(`release_readback_missing_required_asset:${name}`);
      }
      if (
        typeof asset.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/u.test(asset.sha256)
      ) {
        return fail(`release_readback_asset_digest_invalid:${name}`);
      }
      if (
        !hasPassedCheck(content, `${name} release asset readback is verified`)
      ) {
        return fail(`release_readback_asset_not_verified:${name}`);
      }
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "tokenValuesReturned",
        "rawReadbackBodyReturned",
        "rawRegistryResponsesReturned",
        "rawPackageTarballsReturned",
        "rawOciManifestsReturned",
        "rawHelmRepositoryBodiesReturned",
        "rawReleaseAssetBodiesReturned",
        "environmentReturned",
      ])
    ) {
      return fail("release_readback_redaction_missing");
    }
    return pass();
  }

  function validateKubernetesDrSmokeEvidence(content, expectedDatabaseMode) {
    if (content.mode !== "live") return fail("kubernetes_dr_not_live");
    const freshness = validateFreshLiveGeneratedAt(content, "kubernetes_dr");
    if (freshness !== undefined) return freshness;
    if (content.databaseMode !== expectedDatabaseMode) {
      return fail(`kubernetes_dr_wrong_database_mode:${expectedDatabaseMode}`);
    }
    const sourceNamespace = content.source?.namespace;
    const restoreNamespace = content.restore?.namespace;
    if (typeof sourceNamespace !== "string" || sourceNamespace.length === 0) {
      return fail("kubernetes_dr_missing_source_namespace");
    }
    if (typeof restoreNamespace !== "string" || restoreNamespace.length === 0) {
      return fail("kubernetes_dr_missing_restore_namespace");
    }
    if (sourceNamespace === restoreNamespace) {
      return fail("kubernetes_dr_namespaces_not_isolated");
    }
    const sourceConnection = content.source?.databaseConnection;
    const restoreConnection = content.restore?.databaseConnection;
    if (sourceConnection?.source === undefined) {
      return fail("kubernetes_dr_missing_source_database_connection");
    }
    if (restoreConnection?.source === undefined) {
      return fail("kubernetes_dr_missing_restore_database_connection");
    }
    if (
      expectedDatabaseMode === "cloudnativepg" &&
      (sourceConnection.source !== "operator_secret" ||
        restoreConnection.source !== "operator_secret")
    ) {
      return fail("kubernetes_dr_cloudnativepg_requires_operator_secrets");
    }
    if (
      expectedDatabaseMode === "external-postgres" &&
      (sourceConnection.source !== "smoke_owned_secret" ||
        restoreConnection.source !== "smoke_owned_secret")
    ) {
      return fail("kubernetes_dr_external_requires_smoke_owned_secrets");
    }
    const requiredChecks = [
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
    ];
    const checks = new Set(Array.isArray(content.checks) ? content.checks : []);
    for (const check of requiredChecks) {
      if (!checks.has(check))
        return fail(`kubernetes_dr_missing_check:${check}`);
    }
    for (const field of [
      "postgresBackupManifest",
      "objectStoreBackupManifest",
      "postgresDrill",
      "objectStoreDrill",
      "restoredSchemaValidation",
    ]) {
      if (typeof content.evidence?.[field] !== "string") {
        return fail(`kubernetes_dr_missing_evidence_${field}`);
      }
    }
    for (const field of ["chatId", "sourceId", "runId"]) {
      if (typeof content.productWorkflow?.[field] !== "string") {
        return fail(`kubernetes_dr_missing_readback_${field}`);
      }
    }
    if (content.logRedaction?.status !== "passed") {
      return fail("kubernetes_dr_log_redaction_missing");
    }
    if (
      !Number.isInteger(content.logRedaction.sourceScannedPodLogEntries) ||
      content.logRedaction.sourceScannedPodLogEntries < 1
    ) {
      return fail("kubernetes_dr_log_redaction_missing_source_pod_scan");
    }
    if (
      !Number.isInteger(content.logRedaction.restoreScannedPodLogEntries) ||
      content.logRedaction.restoreScannedPodLogEntries < 1
    ) {
      return fail("kubernetes_dr_log_redaction_missing_restore_pod_scan");
    }
    if (
      !Number.isInteger(content.logRedaction.generatedSecretValuesChecked) ||
      content.logRedaction.generatedSecretValuesChecked < 8
    ) {
      return fail("kubernetes_dr_log_redaction_missing_generated_secrets");
    }
    if (
      !Number.isInteger(content.logRedaction.rawContentSentinelsChecked) ||
      content.logRedaction.rawContentSentinelsChecked < 1
    ) {
      return fail("kubernetes_dr_log_redaction_missing_content_sentinel");
    }
    return pass();
  }

  function validateKubernetesWorkerSmokeEvidence(content) {
    if (content.mode !== "live") return fail("kubernetes_workers_not_live");
    const freshness = validateFreshLiveGeneratedAt(
      content,
      "kubernetes_workers",
    );
    if (freshness !== undefined) return freshness;
    if (content.target?.deployment !== "kubernetes") {
      return fail("kubernetes_workers_not_kubernetes");
    }
    const requiredWorkers = [
      "data_connector_sync",
      "workflow_resume",
      "webhook_retry",
      "notification_retry",
      "retention_enforce",
      "billing_entitlement_reconcile",
      "billing_lifecycle_enforce",
    ];
    const workerNames = new Set(
      Array.isArray(content.workers)
        ? content.workers.map((worker) => worker.name)
        : [],
    );
    for (const worker of requiredWorkers) {
      if (!workerNames.has(worker)) {
        return fail(`kubernetes_workers_missing_worker:${worker}`);
      }
    }
    const checks = new Set(Array.isArray(content.checks) ? content.checks : []);
    for (const check of [
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
    ]) {
      if (!checks.has(check)) {
        return fail(`kubernetes_workers_missing_check:${check}`);
      }
    }
    if (content.logRedaction?.status !== "passed") {
      return fail("kubernetes_workers_log_redaction_missing");
    }
    if (
      !Number.isInteger(content.logRedaction.scannedPodLogEntries) ||
      content.logRedaction.scannedPodLogEntries < 1
    ) {
      return fail("kubernetes_workers_log_redaction_missing_pod_scan");
    }
    if (
      !Number.isInteger(content.logRedaction.scannedJobLogEntries) ||
      content.logRedaction.scannedJobLogEntries < content.workerCount
    ) {
      return fail("kubernetes_workers_log_redaction_missing_job_scan");
    }
    if (content.logRedaction.checkedAdminApiKey !== true) {
      return fail("kubernetes_workers_log_redaction_missing_admin_api_key");
    }
    if (
      content.target?.workerApiKeySecretMode === "applied_by_smoke" &&
      content.logRedaction.checkedSmokeOwnedWorkerApiKey !== true
    ) {
      return fail("kubernetes_workers_log_redaction_missing_worker_api_key");
    }
    if (content.logRedaction.webhookSigningSecretChecked !== true) {
      return fail(
        "kubernetes_workers_log_redaction_missing_webhook_signing_secret",
      );
    }
    if (
      !Number.isInteger(content.logRedaction.rawPromptSentinelsChecked) ||
      content.logRedaction.rawPromptSentinelsChecked < 2
    ) {
      return fail("kubernetes_workers_log_redaction_missing_prompt_sentinels");
    }
    if (
      !Number.isInteger(content.logRedaction.rawContentSentinelsChecked) ||
      content.logRedaction.rawContentSentinelsChecked < 1
    ) {
      return fail("kubernetes_workers_log_redaction_missing_content_sentinels");
    }
    if (content.crashRecovery?.recoveredStatus !== "waiting_approval") {
      return fail("kubernetes_workers_crash_recovery_not_recovered");
    }
    if (content.crashRecovery?.termination !== "forced_pod_delete") {
      return fail("kubernetes_workers_crash_termination_missing");
    }
    for (const field of ["workflowId", "workflowRunId", "linkedRunId"]) {
      if (typeof content.controlledWorkflowResume?.[field] !== "string") {
        return fail(`kubernetes_workers_missing_controlled_${field}`);
      }
    }
    return pass();
  }

  function validateKubernetesNetworkPolicyEvidence(content) {
    if (content.mode !== "live") return fail("networkpolicy_not_live");
    const freshness = validateFreshLiveGeneratedAt(content, "networkpolicy");
    if (freshness !== undefined) return freshness;
    if (content.target?.deployment !== "kubernetes") {
      return fail("networkpolicy_not_kubernetes");
    }
    if (content.target?.enforcement !== "networking.k8s.io/v1 NetworkPolicy") {
      return fail("networkpolicy_enforcement_contract_missing");
    }
    const requiredChecks = [
      "cluster_reachable",
      "namespace_created",
      "baseline_allowed_endpoint_reachable_before_policy",
      "baseline_denied_endpoint_reachable_before_policy",
      "egress_policy_applied",
      "allowed_endpoint_reachable_after_policy",
      "denied_endpoint_blocked_after_policy",
      "pod_logs_redacted",
    ];
    const checks = new Set(Array.isArray(content.checks) ? content.checks : []);
    for (const check of requiredChecks) {
      if (!checks.has(check)) {
        return fail(`networkpolicy_missing_check:${check}`);
      }
    }
    if (content.policy?.selectedComponent !== "app") {
      return fail("networkpolicy_unexpected_selected_component");
    }
    if (content.logRedaction?.status !== "passed") {
      return fail("networkpolicy_log_redaction_missing");
    }
    if (
      !Number.isInteger(content.logRedaction.scannedPodLogEntries) ||
      content.logRedaction.scannedPodLogEntries < 1
    ) {
      return fail("networkpolicy_log_redaction_missing_pod_scan");
    }
    if (content.logRedaction.generatedSentinelChecked !== true) {
      return fail("networkpolicy_log_redaction_missing_generated_sentinel");
    }
    return pass();
  }

  function validateKubernetesKedaSmokeEvidence(content) {
    if (content.mode !== "live") return fail("keda_not_live");
    const freshness = validateFreshLiveGeneratedAt(content, "keda");
    if (freshness !== undefined) return freshness;
    if (content.target?.deployment !== "kubernetes") {
      return fail("keda_not_kubernetes");
    }
    for (const field of [
      "namespace",
      "kedaNamespace",
      "scaledJobName",
      "triggerAuthenticationName",
    ]) {
      if (typeof content.target?.[field] !== "string") {
        return fail(`keda_missing_target_${field}`);
      }
    }
    const requiredChecks = [
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
    ];
    const checks = new Set(Array.isArray(content.checks) ? content.checks : []);
    for (const check of requiredChecks) {
      if (!checks.has(check)) return fail(`keda_missing_check:${check}`);
    }
    if (
      !Number.isInteger(content.seededDelivery?.initialAttemptCount) ||
      !Number.isInteger(content.seededDelivery?.retriedAttemptCount) ||
      content.seededDelivery.retriedAttemptCount <=
        content.seededDelivery.initialAttemptCount
    ) {
      return fail("keda_delivery_retry_not_observed");
    }
    if ((content.kedaJob?.succeeded ?? 0) < 1) {
      return fail("keda_worker_job_not_succeeded");
    }
    if ((content.kedaJob?.failed ?? 0) > 0) {
      return fail("keda_worker_job_failed");
    }
    if (content.logRedaction?.status !== "passed") {
      return fail("keda_log_redaction_missing");
    }
    if (
      !Number.isInteger(content.logRedaction.targetNamespaceLogEntries) ||
      content.logRedaction.targetNamespaceLogEntries < 1
    ) {
      return fail("keda_log_redaction_missing_target_log_scan");
    }
    if (
      !Number.isInteger(content.logRedaction.kedaOperatorLogEntries) ||
      content.logRedaction.kedaOperatorLogEntries < 1
    ) {
      return fail("keda_log_redaction_missing_operator_log_scan");
    }
    if (
      !Number.isInteger(content.logRedaction.extraSecretSentinelCount) ||
      content.logRedaction.extraSecretSentinelCount < 0
    ) {
      return fail("keda_log_redaction_missing_extra_secret_sentinel_count");
    }
    for (const field of [
      "checkedAdminApiKey",
      "checkedWorkerApiKey",
      "checkedDatabaseUrl",
      "checkedWebhookSigningSecret",
      "checkedWebhookPayloadSentinel",
      "checkedWebhookUrlSentinel",
    ]) {
      if (content.logRedaction?.[field] !== true) {
        return fail(`keda_log_redaction_missing_${field}`);
      }
    }
    return pass();
  }

  function validateKubernetesLoadSoakEvidence(content) {
    if (content.mode !== "live") return fail("load_soak_not_live");
    const freshness = validateFreshLiveGeneratedAt(content, "load_soak");
    if (freshness !== undefined) return freshness;
    if (content.target?.deployment !== "kubernetes") {
      return fail("load_soak_not_kubernetes");
    }
    for (const field of [
      "namespace",
      "releaseName",
      "serviceName",
      "deploymentName",
    ]) {
      if (typeof content.target?.[field] !== "string") {
        return fail(`load_soak_missing_target_${field}`);
      }
    }
    if (!["small", "enterprise"].includes(content.tier)) {
      return fail("load_soak_tier_not_ga_scale");
    }
    if (!Number.isInteger(content.loadRuns) || content.loadRuns < 2) {
      return fail("load_soak_requires_repeated_runs");
    }
    if (
      !Number.isInteger(content.soak?.requestedSeconds) ||
      content.soak.requestedSeconds < 60
    ) {
      return fail("load_soak_requested_duration_too_short");
    }
    if (content.soak?.passed !== true) {
      return fail("load_soak_duration_not_observed");
    }
    const checks = new Set(Array.isArray(content.checks) ? content.checks : []);
    for (const check of [
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
    ]) {
      if (!checks.has(check)) return fail(`load_soak_missing_check:${check}`);
    }
    if (content.logRedaction?.status !== "passed") {
      return fail("load_soak_log_redaction_missing");
    }
    if (
      !Number.isInteger(content.logRedaction.scannedPods) ||
      content.logRedaction.scannedPods < 1
    ) {
      return fail("load_soak_log_redaction_missing_pod_scan");
    }
    if (content.logRedaction.apiKeyChecked !== true) {
      return fail("load_soak_log_redaction_missing_api_key");
    }
    if (
      !Number.isInteger(content.logRedaction.rawFixtureSentinelsChecked) ||
      content.logRedaction.rawFixtureSentinelsChecked < content.loadRuns
    ) {
      return fail("load_soak_log_redaction_missing_fixture_sentinels");
    }
    if (
      !Array.isArray(content.loadEvidence) ||
      content.loadEvidence.length !== content.loadRuns ||
      content.loadEvidence.some(
        (run) =>
          run?.status !== "passed" ||
          run?.mode !== "live" ||
          !positiveInteger(run?.latencyMs?.count),
      )
    ) {
      return fail("load_soak_run_summary_invalid");
    }
    if (JSON.stringify(content.kubernetes?.pods ?? []).includes('"imageID"')) {
      return fail("load_soak_raw_image_id_returned");
    }
    return pass();
  }

  function validateComposeProductSmokeEvidence(content) {
    const requiredChecks = [
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
    ];
    const checks = new Set(Array.isArray(content.checks) ? content.checks : []);
    for (const check of requiredChecks) {
      if (!checks.has(check))
        return fail(`compose_smoke_missing_check:${check}`);
    }
    if (
      typeof content.projectName !== "string" ||
      !content.projectName.startsWith("romeo_smoke_")
    ) {
      return fail("compose_smoke_project_missing");
    }
    if (JSON.stringify(content).includes("RAW_")) {
      return fail("compose_smoke_raw_sentinel_leaked");
    }
    return pass();
  }

  function validateComposeWorkerSmokeEvidence(content) {
    const requiredChecks = [
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
    ];
    const checks = new Set(Array.isArray(content.checks) ? content.checks : []);
    for (const check of requiredChecks) {
      if (!checks.has(check)) {
        return fail(`compose_workers_missing_check:${check}`);
      }
    }

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
    const workers = new Map(
      Array.isArray(content.workers)
        ? content.workers
            .filter((worker) => typeof worker?.name === "string")
            .map((worker) => [worker.name, worker])
        : [],
    );
    if (!Number.isInteger(content.workerCount) || content.workerCount < 9) {
      return fail("compose_workers_count_low");
    }
    for (const worker of requiredWorkers) {
      const evidence = workers.get(worker);
      if (evidence === undefined) {
        return fail(`compose_workers_missing_worker:${worker}`);
      }
      if (!Number.isInteger(evidence.iteration) || evidence.iteration < 1) {
        return fail(`compose_workers_iteration_missing:${worker}`);
      }
      if (
        typeof evidence.service !== "string" ||
        evidence.service.length === 0
      ) {
        return fail(`compose_workers_service_missing:${worker}`);
      }
    }

    const loopRestarts = new Map(
      Array.isArray(content.loopRestarts)
        ? content.loopRestarts
            .filter((item) => typeof item?.name === "string")
            .map((item) => [item.name, item])
        : [],
    );
    if (
      !Number.isInteger(content.loopRestartCount) ||
      content.loopRestartCount < 3
    ) {
      return fail("compose_workers_loop_restart_count_low");
    }
    for (const worker of [
      "workflow_resume",
      "webhook_retry",
      "notification_retry",
    ]) {
      const restart = loopRestarts.get(worker);
      if (restart === undefined) {
        return fail(`compose_workers_missing_loop_restart:${worker}`);
      }
      if (
        !Number.isInteger(restart.beforeRestartIterations) ||
        !Number.isInteger(restart.afterRestartIterations) ||
        restart.afterRestartIterations <= restart.beforeRestartIterations
      ) {
        return fail(`compose_workers_loop_restart_not_progressed:${worker}`);
      }
    }

    for (const field of ["workflowId", "workflowRunId", "linkedRunId"]) {
      if (typeof content.controlledWorkflowResume?.[field] !== "string") {
        return fail(`compose_workers_controlled_resume_missing:${field}`);
      }
    }
    if (
      content.crashRecovery?.signal !== "SIGKILL" ||
      content.crashRecovery?.recoveredStatus !== "waiting_approval" ||
      !Number.isInteger(content.crashRecovery?.afterCrashIterations) ||
      !Number.isInteger(content.crashRecovery?.afterKillBaselineIterations) ||
      content.crashRecovery.afterCrashIterations <=
        content.crashRecovery.afterKillBaselineIterations
    ) {
      return fail("compose_workers_crash_recovery_incomplete");
    }
    if (JSON.stringify(content).includes("RAW_")) {
      return fail("compose_workers_raw_sentinel_leaked");
    }
    return pass();
  }

  function validateComposeBackupRestoreEvidence(content) {
    const requiredChecks = [
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
    ];
    const checks = new Set(Array.isArray(content.checks) ? content.checks : []);
    for (const check of requiredChecks) {
      if (!checks.has(check)) {
        return fail(`compose_backup_restore_missing_check:${check}`);
      }
    }
    if (
      typeof content.sourceProjectName !== "string" ||
      typeof content.restoreProjectName !== "string" ||
      content.sourceProjectName === content.restoreProjectName
    ) {
      return fail("compose_backup_restore_projects_not_isolated");
    }
    for (const field of [
      "backupManifest",
      "objectStoreBackupManifest",
      "drDrill",
      "objectStoreDrDrill",
      "restoredSchemaValidation",
    ]) {
      const value = content.evidence?.[field];
      if (typeof value !== "string" || value.length === 0) {
        return fail(`compose_backup_restore_missing_evidence:${field}`);
      }
      if (value.startsWith("/") || value.includes("..")) {
        return fail(`compose_backup_restore_unsafe_evidence_path:${field}`);
      }
    }
    if (JSON.stringify(content).includes("RAW_")) {
      return fail("compose_backup_restore_raw_sentinel_leaked");
    }
    return pass();
  }

  function validateKubernetesRenderEvidence(content) {
    const requiredChecks = [
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
    ];
    const checks = new Set(Array.isArray(content.checks) ? content.checks : []);
    for (const check of requiredChecks) {
      if (!checks.has(check))
        return fail(`kubernetes_render_missing_check:${check}`);
    }
    const variants = new Map(
      Array.isArray(content.variants)
        ? content.variants
            .filter((variant) => typeof variant?.name === "string")
            .map((variant) => [variant.name, variant])
        : [],
    );
    for (const name of [
      "default",
      "external_postgres",
      "cloudnativepg",
      "enterprise_surface",
      "network_policy_egress",
    ]) {
      if (!variants.has(name))
        return fail(`kubernetes_render_missing_variant:${name}`);
    }
    const externalPostgres = variants.get("external_postgres");
    const cloudnativepg = variants.get("cloudnativepg");
    const enterprise = variants.get("enterprise_surface");
    const networkPolicy = variants.get("network_policy_egress");
    for (const [name, variant] of [
      ["external_postgres", externalPostgres],
      ["cloudnativepg", cloudnativepg],
    ]) {
      if (
        (variant?.kinds?.Deployment ?? 0) < 1 ||
        (variant?.kinds?.Job ?? 0) < 1
      ) {
        return fail(`kubernetes_render_core_resources_missing:${name}`);
      }
      if (
        !Array.isArray(variant.workerCronJobs) ||
        variant.workerCronJobs.length < 7
      ) {
        return fail(`kubernetes_render_worker_cronjobs_low:${name}`);
      }
    }
    if (
      (enterprise?.kinds?.NetworkPolicy ?? 0) < 3 ||
      (enterprise?.kinds?.HorizontalPodAutoscaler ?? 0) < 1 ||
      (enterprise?.kinds?.Ingress ?? 0) < 1 ||
      !Array.isArray(enterprise?.workerCronJobs) ||
      !enterprise.workerCronJobs.includes("romeo-tool-dispatch") ||
      !enterprise.workerCronJobs.includes("romeo-browser-automation")
    ) {
      return fail("kubernetes_render_enterprise_surface_incomplete");
    }
    if (
      (networkPolicy?.networkPolicyEgressRules ?? 0) < 1 ||
      (networkPolicy?.toolDispatchNetworkPolicyEgressRules ?? 0) < 1
    ) {
      return fail("kubernetes_render_explicit_egress_missing");
    }
    const cloudNativeResources = new Set(
      Array.isArray(content.cloudNativePgExamples?.resources)
        ? content.cloudNativePgExamples.resources.map(
            (item) => `${item.apiVersion}:${item.kind}:${item.name}`,
          )
        : [],
    );
    for (const resource of [
      "postgresql.cnpg.io/v1:Cluster:romeo-pg",
      "postgresql.cnpg.io/v1:Cluster:romeo-pg-restore",
      "postgresql.cnpg.io/v1:ScheduledBackup:romeo-pg-daily",
      "postgresql.cnpg.io/v1:Backup:romeo-pg-manual",
      "barmancloud.cnpg.io/v1:ObjectStore:romeo-pg-backups",
      "barmancloud.cnpg.io/v1:ObjectStore:romeo-pg-restore-backups",
    ]) {
      if (!cloudNativeResources.has(resource)) {
        return fail(
          `kubernetes_render_missing_cloudnativepg_example:${resource}`,
        );
      }
    }
    const kedaResources = new Set(
      Array.isArray(content.kedaExamples?.resources)
        ? content.kedaExamples.resources.map(
            (item) => `${item.apiVersion}:${item.kind}:${item.name}`,
          )
        : [],
    );
    for (const resource of [
      "keda.sh/v1alpha1:ScaledJob:romeo-webhook-retry",
      "keda.sh/v1alpha1:TriggerAuthentication:romeo-webhook-retry-postgres",
    ]) {
      if (!kedaResources.has(resource)) {
        return fail(`kubernetes_render_missing_keda_example:${resource}`);
      }
    }
    return pass();
  }

  function validateTenantIsolationEvidence(content) {
    const requiredChecks = [
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
    ];
    const checks = new Set(Array.isArray(content.checks) ? content.checks : []);
    for (const check of requiredChecks) {
      if (!checks.has(check)) {
        return fail(`tenant_isolation_missing_check:${check}`);
      }
    }

    const expectedTestFiles = [
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
    const testFiles = new Set(
      Array.isArray(content.testFiles) ? content.testFiles : [],
    );
    for (const file of expectedTestFiles) {
      if (!testFiles.has(file))
        return fail(`tenant_isolation_missing_test:${file}`);
    }

    if (content.command?.executable !== "pnpm") {
      return fail("tenant_isolation_unexpected_command");
    }
    const args = Array.isArray(content.command?.args)
      ? content.command.args
      : [];
    for (const arg of ["--filter", "@romeo/core", "test", "--"]) {
      if (!args.includes(arg))
        return fail(`tenant_isolation_missing_arg:${arg}`);
    }
    for (const file of expectedTestFiles) {
      if (!args.includes(file))
        return fail(`tenant_isolation_missing_arg:${file}`);
    }

    if (content.result?.exitCode !== 0) {
      return fail("tenant_isolation_test_exit_not_zero");
    }
    if (
      content.result?.signal !== undefined &&
      content.result.signal !== null
    ) {
      return fail("tenant_isolation_unexpected_signal");
    }
    if (
      !Number.isInteger(content.result?.durationMs) ||
      content.result.durationMs <= 0
    ) {
      return fail("tenant_isolation_duration_missing");
    }
    for (const stream of ["stdout", "stderr"]) {
      const summary = content.result?.[stream];
      if (typeof summary === "string") {
        return fail(`tenant_isolation_raw_${stream}_present`);
      }
      if (!Number.isInteger(summary?.bytes) || summary.bytes < 0) {
        return fail(`tenant_isolation_${stream}_summary_missing`);
      }
      if (
        typeof summary.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/u.test(summary.sha256)
      ) {
        return fail(`tenant_isolation_${stream}_hash_missing`);
      }
    }
    return pass();
  }

  function validateDocsCommandCheckEvidence(content) {
    if (!hasPassedCheck(content, "documented_markdown_links_resolve")) {
      return fail("docs_command_check_markdown_links_missing");
    }
    if (!hasPassedCheck(content, "documented_commands_classified")) {
      return fail("docs_command_check_command_classification_missing");
    }
    if (
      !Number.isInteger(content.stats?.markdownLinksChecked) ||
      content.stats.markdownLinksChecked <= 0
    ) {
      return fail("docs_command_check_markdown_link_stats_missing");
    }
    if (
      content.commandPosture?.everyCommandClassified !== true ||
      !Number.isInteger(content.commandPosture?.total) ||
      content.commandPosture.total <= 0 ||
      content.commandPosture.unclassified !== 0 ||
      content.commandPosture.rawCommandTextReturned !== false
    ) {
      return fail("docs_command_check_command_classification_invalid");
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "rawMarkdownBodiesReturned",
        "rawShellCommandTextReturned",
        "environmentValuesReturned",
        "secretValuesReturned",
      ])
    ) {
      return fail("docs_command_check_redaction_missing");
    }
    return pass();
  }

  function validateOpenApiRouteCoverageEvidence(
    content,
    expectedCompatibilityEnabled,
  ) {
    if (
      content.configuration?.openWebUiCompatibilityEnabled !==
      expectedCompatibilityEnabled
    ) {
      return fail("openapi_route_coverage_mode_mismatch");
    }
    for (const check of [
      "route_files_scanned",
      "openapi_document_exported",
      "public_api_v1_routes_have_openapi_operations",
    ]) {
      if (!hasPassedCheck(content, check)) {
        return fail(`openapi_route_coverage_missing_check:${check}`);
      }
    }
    if (
      !Number.isInteger(content.stats?.publicApiV1Routes) ||
      content.stats.publicApiV1Routes <= 0
    ) {
      return fail("openapi_route_coverage_missing_routes");
    }
    const publicApiV1RouteKeys = Number.isInteger(
      content.stats?.publicApiV1RouteKeys,
    )
      ? content.stats.publicApiV1RouteKeys
      : content.stats.publicApiV1Routes;
    if (publicApiV1RouteKeys <= 0) {
      return fail("openapi_route_coverage_missing_route_keys");
    }
    if (publicApiV1RouteKeys > content.stats.publicApiV1Routes) {
      return fail("openapi_route_coverage_route_keys_exceed_routes");
    }
    if (
      !Number.isInteger(content.stats?.openApiOperations) ||
      content.stats.openApiOperations <= 0
    ) {
      return fail("openapi_route_coverage_missing_operations");
    }
    if (content.stats?.uncoveredRoutes !== 0) {
      return fail("openapi_route_coverage_uncovered_routes");
    }
    if (content.stats?.coveredRoutes !== content.stats.publicApiV1Routes) {
      return fail("openapi_route_coverage_incomplete");
    }
    if (content.stats.openApiOperations !== publicApiV1RouteKeys) {
      return fail("openapi_route_coverage_operation_count_mismatch");
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "routeHandlerSourceReturned",
        "requestBodiesReturned",
        "responseBodiesReturned",
        "secretValuesReturned",
      ])
    ) {
      return fail("openapi_route_coverage_redaction_missing");
    }
    return pass();
  }

  function validateBranchProtectionPlanEvidence(content) {
    if (content.status !== "passed") {
      return fail("branch_protection_plan_not_passed");
    }
    if (content.provider !== "github") {
      return fail("branch_protection_plan_provider_invalid");
    }
    if (
      !Array.isArray(content.requiredStatusChecks) ||
      content.requiredStatusChecks.length < 5
    ) {
      return fail("branch_protection_plan_status_checks_missing");
    }
    const policy = content.policy ?? {};
    if (
      policy.requirePullRequest !== true ||
      policy.requireConversationResolution !== true ||
      policy.requireLinearHistory !== true ||
      policy.requireSignedCommits !== true ||
      policy.requireUpToDateBeforeMerge !== true ||
      policy.dismissStaleApprovals !== true ||
      policy.requireCodeOwnerReviews !== true ||
      policy.restrictBypassToReleaseAdmins !== true ||
      !Number.isInteger(policy.requiredApprovingReviewCount) ||
      policy.requiredApprovingReviewCount < 2
    ) {
      return fail("branch_protection_plan_policy_incomplete");
    }
    const blockers = Array.isArray(content.blockers) ? content.blockers : [];
    if (blockers.length > 0) {
      return fail("branch_protection_plan_has_blockers");
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "workflowBodyIncluded",
        "secretValuesIncluded",
        "tokenValuesIncluded",
        "environmentValuesIncluded",
      ])
    ) {
      return fail("branch_protection_plan_redaction_missing");
    }
    return pass();
  }

  function validateHostedCiRunEvidence(content) {
    if (content.status !== "passed") {
      return fail("hosted_ci_run_not_passed");
    }
    if (content.mode !== "live_github_api") {
      return fail("hosted_ci_run_not_live");
    }
    if (content.provider !== "github_actions") {
      return fail("hosted_ci_run_provider_invalid");
    }
    if (
      content.plan?.status !== "passed" ||
      !positiveInteger(content.plan?.requiredStatusCheckCount) ||
      content.plan.requiredStatusCheckCount < 5
    ) {
      return fail("hosted_ci_run_plan_incomplete");
    }
    if (
      content.run?.status !== "completed" ||
      content.run?.conclusion !== "success"
    ) {
      return fail("hosted_ci_run_not_successful");
    }
    for (const check of [
      "all required CI jobs present",
      "all required CI jobs successful",
      "hosted CI job inventory read",
    ]) {
      if (!hasPassedCheck(content, check)) {
        return fail(`hosted_ci_run_missing_check:${check}`);
      }
    }
    const blockers = Array.isArray(content.blockers) ? content.blockers : [];
    if (blockers.length > 0) {
      return fail("hosted_ci_run_has_blockers");
    }
    if (content.target?.repositorySlugReturned !== false) {
      return fail("hosted_ci_run_repository_slug_returned");
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "rawApiResponseReturned",
        "rawEnvironmentValuesReturned",
        "rawJobLogsReturned",
        "repositorySlugReturned",
        "runUrlReturned",
        "tokenValuesReturned",
      ])
    ) {
      return fail("hosted_ci_run_redaction_missing");
    }
    return pass();
  }

  function validateBranchProtectionVerificationEvidence(content) {
    if (content.status !== "passed") {
      return fail("branch_protection_verification_not_passed");
    }
    if (content.mode !== "live_github_api") {
      return fail("branch_protection_verification_not_live");
    }
    if (content.provider !== "github") {
      return fail("branch_protection_verification_provider_invalid");
    }
    if (
      content.plan?.status !== "passed" ||
      !positiveInteger(content.plan?.requiredStatusCheckCount) ||
      content.plan.requiredStatusCheckCount < 5
    ) {
      return fail("branch_protection_verification_plan_incomplete");
    }
    const policy = content.plan?.policy ?? {};
    if (
      policy.requirePullRequest !== true ||
      policy.requireConversationResolution !== true ||
      policy.requireLinearHistory !== true ||
      policy.requireSignedCommits !== true ||
      policy.requireUpToDateBeforeMerge !== true ||
      policy.dismissStaleApprovals !== true ||
      policy.requireCodeOwnerReviews !== true ||
      !Number.isInteger(policy.requiredApprovingReviewCount) ||
      policy.requiredApprovingReviewCount < 2
    ) {
      return fail("branch_protection_verification_policy_incomplete");
    }
    for (const check of [
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
    ]) {
      if (!hasPassedCheck(content, check)) {
        return fail(`branch_protection_verification_missing_check:${check}`);
      }
    }
    const blockers = Array.isArray(content.blockers) ? content.blockers : [];
    if (blockers.length > 0) {
      return fail("branch_protection_verification_has_blockers");
    }
    if (content.target?.repositorySlugReturned !== false) {
      return fail("branch_protection_verification_repository_slug_returned");
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "commandOutputReturned",
        "rawApiResponseReturned",
        "rawEnvironmentValuesReturned",
        "repositorySlugReturned",
        "tokenValuesReturned",
      ])
    ) {
      return fail("branch_protection_verification_redaction_missing");
    }
    return pass();
  }

  function validateAuthProviderAcceptanceEvidence(content) {
    for (const check of [
      "auth_provider_catalog_covers_enterprise_provider_ids",
      "per_provider_oidc_oauth2_ldap_saml_settings_persist",
      "local_managed_secret_ingestion_uses_encrypted_reference",
      "provider_connection_tests_return_metadata_only",
      "auth_provider_audit_logs_exclude_raw_identity_config",
    ]) {
      if (!hasPassedCheck(content, check)) {
        return fail(`auth_provider_acceptance_missing_check:${check}`);
      }
    }
    for (const providerId of [
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
    ]) {
      if (!content.catalog?.providerIds?.includes(providerId)) {
        return fail(`auth_provider_acceptance_missing_provider:${providerId}`);
      }
    }
    if (content.catalog?.implementedCount !== 11) {
      return fail("auth_provider_acceptance_implemented_count_mismatch");
    }
    for (const providerId of ["local", "keycloak", "github", "ldap", "saml"]) {
      if (content.connectionTests?.statuses?.[providerId] !== "passed") {
        return fail(`auth_provider_acceptance_test_not_passed:${providerId}`);
      }
    }
    if (content.managedSecrets?.localSecretStoredEncrypted !== true) {
      return fail("auth_provider_acceptance_secret_not_encrypted");
    }
    if (content.managedSecrets?.localSecretValueReturned !== false) {
      return fail("auth_provider_acceptance_secret_value_returned");
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "rawIssuerPathsReturned",
        "rawClientIdsReturned",
        "rawSecretRefsReturned",
        "rawSecretValuesReturned",
        "rawDirectoryDnsReturned",
        "rawIdentityGroupsReturned",
        "rawProviderResponsesReturned",
      ])
    ) {
      return fail("auth_provider_acceptance_redaction_missing");
    }
    return pass();
  }

  function validateDirectorySyncContractEvidence(content) {
    for (const check of [
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
    ]) {
      if (!hasPassedCheck(content, check)) {
        return fail(`directory_sync_contract_missing_check:${check}`);
      }
    }
    if (content.authorization?.unauthenticatedStatus !== 401) {
      return fail("directory_sync_unauthenticated_not_denied");
    }
    if (
      content.preview?.status !== "preview" ||
      content.preview?.userDisableCount !== 1 ||
      content.preview?.membershipRemovalCount !== 1
    ) {
      return fail("directory_sync_preview_shape_invalid");
    }
    if (
      content.guardrails?.missingConfirmationCode !==
        "directory_sync_confirmation_required" ||
      content.guardrails?.capExceededCode !==
        "directory_sync_user_disable_limit_exceeded"
    ) {
      return fail("directory_sync_guardrails_missing");
    }
    if (
      content.apply?.status !== "applied" ||
      content.apply?.adminPreserved !== true ||
      content.apply?.callerMembershipPreserved !== true
    ) {
      return fail("directory_sync_apply_shape_invalid");
    }
    if (
      content.apply?.apiKeyRevoked !== true ||
      content.apply?.sessionRevoked !== true
    ) {
      return fail("directory_sync_credentials_not_revoked");
    }
    if (
      content.audit?.previewAction !== "directory_sync.preview" ||
      content.audit?.applyAction !== "directory_sync.apply" ||
      content.audit?.disableAction !== "user.disable" ||
      content.audit?.schema !== "romeo.directory-sync.v1"
    ) {
      return fail("directory_sync_audit_contract_invalid");
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "rawEmailsReturned",
        "rawNamesReturned",
        "rawDirectoryReasonReturned",
        "rawCredentialTokensReturned",
        "rawGroupNameReturned",
      ])
    ) {
      return fail("directory_sync_redaction_missing");
    }
    return pass();
  }

  function validateScimLifecycleContractEvidence(content) {
    for (const check of [
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
    ]) {
      if (!hasPassedCheck(content, check)) {
        return fail(`scim_lifecycle_missing_check:${check}`);
      }
    }
    if (
      content.posture?.disabledServiceProviderStatus !== 404 ||
      content.posture?.disabledServiceProviderScimType !== "scim_disabled" ||
      content.posture?.identityLifecycleScim !== "enabled" ||
      content.posture?.patchSupported !== true ||
      !content.posture?.supportedResources?.includes("User") ||
      !content.posture?.supportedResources?.includes("Group")
    ) {
      return fail("scim_lifecycle_posture_invalid");
    }
    if (
      content.lifecycle?.seededMemberCount !== 1 ||
      content.lifecycle?.deleteStatus !== 204 ||
      content.lifecycle?.postDeleteMembershipCount !== 0 ||
      content.lifecycle?.grantRevoked !== true ||
      content.lifecycle?.deletedReadbackStatus !== 404
    ) {
      return fail("scim_lifecycle_cleanup_invalid");
    }
    if (
      content.audit?.action !== "scim.group.delete" ||
      content.audit?.resourceType !== "group" ||
      content.audit?.metadataSchema !== "romeo.scim.audit.v1" ||
      content.audit?.membershipCount !== 1 ||
      content.audit?.revokedGrantCount !== 1 ||
      content.audit?.destructiveDelete !== true
    ) {
      return fail("scim_lifecycle_audit_invalid");
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "rawEmailReturned",
        "rawDisplayNameReturned",
        "rawGivenNameReturned",
        "rawFamilyNameReturned",
        "rawGrantIdReturned",
      ])
    ) {
      return fail("scim_lifecycle_redaction_missing");
    }
    return pass();
  }

  function validateAnalyticsAuthzContractEvidence(content) {
    for (const check of [
      "unauthenticated_admin_analytics_denied",
      "usage_scope_without_admin_denied",
      "admin_scope_without_usage_denied",
      "minimal_admin_analytics_json_read",
      "minimal_admin_analytics_csv_read",
      "eval_evidence_requires_agent_read",
      "eval_evidence_redaction_flags",
      "raw_analytics_and_eval_content_absent",
      "api_tokens_not_retained",
    ]) {
      if (!hasPassedCheck(content, check)) {
        return fail(`analytics_authz_missing_check:${check}`);
      }
    }
    if (
      content.authorization?.unauthenticatedAnalyticsStatus !== 401 ||
      content.authorization?.usageWithoutAdminStatus !== 403 ||
      content.authorization?.adminWithoutUsageStatus !== 403 ||
      content.authorization?.evalWithoutAgentReadStatus !== 403
    ) {
      return fail("analytics_authz_authorization_missing");
    }
    if (
      content.readback?.evalReleaseGateStatus !== "passed" ||
      content.readback?.evalEvidenceGateStatus !== "passed" ||
      !Number.isInteger(content.readback?.evalSuiteCount) ||
      content.readback.evalSuiteCount <= 0 ||
      !Number.isInteger(content.readback?.usageEventCount) ||
      content.readback.usageEventCount <= 0 ||
      !Number.isInteger(content.readback?.csvBytes) ||
      content.readback.csvBytes <= 0 ||
      typeof content.readback?.csvSha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(content.readback.csvSha256)
    ) {
      return fail("analytics_authz_readback_invalid");
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "rawAnalyticsJsonReturned",
        "rawAnalyticsCsvReturned",
        "rawEvalEvidenceReturned",
        "rawApiTokensReturned",
      ])
    ) {
      return fail("analytics_authz_redaction_missing");
    }
    return pass();
  }

  function validateIdentityLiveEvidence(content) {
    const requiredChecks = [
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
    ];
    const missingCheck = firstMissingCheck(content, requiredChecks);
    if (missingCheck !== undefined) {
      return fail(`identity_live_missing_check:${missingCheck}`);
    }
    if (content.status !== "passed") return fail("identity_live_not_passed");
    if (content.mode !== "live") return fail("identity_live_not_live");
    if (!["compose", "kubernetes", "target"].includes(content.deployment)) {
      return fail("identity_live_deployment_invalid");
    }
    const providers = content.identityProviders ?? {};
    if (
      !positiveInteger(providers.configuredProviderCount) ||
      !positiveInteger(providers.liveLoginProviderCount) ||
      providers.localFallbackVerified !== true ||
      providers.mfaFallbackVerified !== true
    ) {
      return fail("identity_live_provider_login_missing");
    }
    const secretBackends = content.secretBackends ?? {};
    if (
      !positiveInteger(secretBackends.managedSecretBackendCount) ||
      !positiveInteger(secretBackends.secretResolutionCheckCount)
    ) {
      return fail("identity_live_secret_backend_missing");
    }
    const directory = content.directory ?? {};
    if (
      !positiveInteger(directory.directoryProviderCount) ||
      !positiveInteger(directory.directoryLookupCount) ||
      !positiveInteger(directory.mappedGroupCount) ||
      !positiveInteger(directory.workspaceMappingCount) ||
      !positiveInteger(directory.directorySyncPreviewChangeCount) ||
      !positiveInteger(directory.directorySyncAppliedChangeCount) ||
      directory.policyViolationCount !== 0
    ) {
      return fail("identity_live_directory_missing");
    }
    const lifecycle = content.lifecycle ?? {};
    const lifecycleCount =
      (Number.isInteger(lifecycle.deprovisionedUserCount)
        ? lifecycle.deprovisionedUserCount
        : 0) +
      (Number.isInteger(lifecycle.scimUserLifecycleCount)
        ? lifecycle.scimUserLifecycleCount
        : 0) +
      (Number.isInteger(lifecycle.scimGroupLifecycleCount)
        ? lifecycle.scimGroupLifecycleCount
        : 0) +
      (Number.isInteger(lifecycle.disabledUserCount)
        ? lifecycle.disabledUserCount
        : 0);
    if (lifecycleCount <= 0) {
      return fail("identity_live_lifecycle_missing");
    }
    const accessReview = content.accessReview ?? {};
    if (
      accessReview.checked !== true ||
      !positiveInteger(accessReview.reportUserCount) ||
      !positiveInteger(accessReview.reportGroupCount) ||
      !positiveInteger(accessReview.reportGrantCount)
    ) {
      return fail("identity_live_access_review_missing");
    }
    if (hasFailureCodes(content)) {
      return fail("identity_live_failure_codes_present");
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "evidenceFileBodiesReturned",
        "rawDirectoryEntriesReturned",
        "rawEmailAddressesReturned",
        "rawEvidencePathsReturned",
        "rawGroupNamesReturned",
        "rawIdpResponsesReturned",
        "rawLdapDnsReturned",
        "rawProviderEndpointsReturned",
        "rawSamlAssertionsReturned",
        "rawSecretRefsReturned",
        "secretValuesReturned",
        "tokenValuesReturned",
      ])
    ) {
      return fail("identity_live_redaction_missing");
    }
    return pass();
  }

  function validateAnalyticsAuthzLiveEvidence(content) {
    const requiredChecks = [
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
    ];
    const missingCheck = firstMissingCheck(content, requiredChecks);
    if (missingCheck !== undefined) {
      return fail(`analytics_authz_live_missing_check:${missingCheck}`);
    }
    if (content.status !== "passed") {
      return fail("analytics_authz_live_not_passed");
    }
    if (content.mode !== "live") return fail("analytics_authz_live_not_live");
    if (!["kubernetes", "target"].includes(content.deployment)) {
      return fail("analytics_authz_live_deployment_invalid");
    }
    const subjects = content.subjects ?? {};
    if (
      !positiveInteger(subjects.adminSubjectCount) ||
      !positiveInteger(subjects.nonAdminSubjectCount) ||
      !positiveInteger(subjects.crossOrgSubjectCount)
    ) {
      return fail("analytics_authz_live_subjects_missing");
    }
    const authorization = content.authorization ?? {};
    if (
      !positiveInteger(authorization.adminSummaryAllowedCount) ||
      !positiveInteger(authorization.adminCsvAllowedCount) ||
      !positiveInteger(authorization.nonAdminSummaryDeniedCount) ||
      !positiveInteger(authorization.nonAdminCsvDeniedCount) ||
      !positiveInteger(authorization.missingUsageScopeDeniedCount) ||
      !positiveInteger(authorization.evalGrantDeniedCount) ||
      !positiveInteger(authorization.crossOrgDeniedCount) ||
      !positiveInteger(authorization.crossWorkspaceScopedCount)
    ) {
      return fail("analytics_authz_live_authorization_missing");
    }
    const analytics = content.analytics ?? {};
    if (
      !positiveInteger(analytics.summaryReadCount) ||
      !positiveInteger(analytics.csvExportReadCount) ||
      !positiveInteger(analytics.evalEvidenceReadCount) ||
      !positiveInteger(analytics.csvSha256Count) ||
      !positiveInteger(analytics.usageMetricCount) ||
      !positiveInteger(analytics.evalSuiteCount) ||
      !positiveInteger(analytics.jobSummaryCount) ||
      !positiveInteger(analytics.providerSummaryCount)
    ) {
      return fail("analytics_authz_live_readback_missing");
    }
    if (hasFailureCodes(content)) {
      return fail("analytics_authz_live_failure_codes_present");
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "apiKeysReturned",
        "evidenceFileBodiesReturned",
        "rawAnalyticsCsvRowsReturned",
        "rawEvalInputsReturned",
        "rawEvalOutputsReturned",
        "rawEvidencePathsReturned",
        "rawHumanRatingCommentsReturned",
        "rawJobPayloadsReturned",
        "rawOrgNamesReturned",
        "rawProviderConfigReturned",
        "rawSecretRefsReturned",
        "rawToolInputsReturned",
        "rawUsageMetadataReturned",
        "rawUserEmailsReturned",
        "rawWorkspaceNamesReturned",
        "secretValuesReturned",
        "tokenValuesReturned",
      ])
    ) {
      return fail("analytics_authz_live_redaction_missing");
    }
    return pass();
  }

  function validateDataConnectorAcceptanceEvidence(content) {
    for (const check of [
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
    ]) {
      if (!hasPassedCheck(content, check)) {
        return fail(`data_connector_acceptance_missing_check:${check}`);
      }
    }
    for (const connectorType of [
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
    ]) {
      if (!content.catalog?.connectorTypes?.includes(connectorType)) {
        return fail(`data_connector_acceptance_missing_type:${connectorType}`);
      }
    }
    if (
      content.catalog?.executionDriver !== "managed-fetch" ||
      content.catalog?.egressPolicy !== "require_allowlist" ||
      !Number.isInteger(content.catalog?.allowedHostRuleCount) ||
      content.catalog.allowedHostRuleCount <= 0 ||
      content.catalog?.secretResolver?.driver !== "env" ||
      content.catalog.secretResolver.managedSecretConfigured !== true ||
      content.catalog.secretResolver.externalValueResolverConfigured !== true
    ) {
      return fail("data_connector_acceptance_runtime_posture_invalid");
    }
    const runtime = content.authorizationAndRuntime ?? {};
    if (
      runtime.blockedCreationStatus !== 409 ||
      runtime.blockedCreationCode !== "connector_runtime_not_configured" ||
      runtime.persistedAfterBlockedCreation !== false ||
      runtime.credentialConflictStatus !== 400 ||
      runtime.credentialConflictCode !== "invalid_connector_config" ||
      runtime.failClosedAllowlistStatus !== 409 ||
      runtime.failClosedAllowlistCode !== "connector_runtime_not_configured"
    ) {
      return fail("data_connector_acceptance_fail_closed_missing");
    }
    if (
      runtime.localImportCreationStatus !== 201 ||
      runtime.localImportSyncStatus !== "completed" ||
      runtime.privateDnsCreationStatus !== 201 ||
      runtime.privateDnsSyncStatus !== 403 ||
      runtime.privateDnsSyncCode !== "connector_private_network_host_blocked" ||
      runtime.privateDnsFetchAttemptCount !== 0
    ) {
      return fail("data_connector_private_dns_not_blocked");
    }
    for (const connectorType of [
      "confluence",
      "jira",
      "notion",
      "linear",
      "slack",
    ]) {
      const creation = runtime[`${connectorType}CreationStatus`];
      const sync = runtime[`${connectorType}SyncStatus`];
      if (creation !== 201 || sync !== "completed") {
        return fail(`data_connector_sync_not_completed:${connectorType}`);
      }
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "rawAllowedHostsReturned",
        "rawEndpointUrlsReturned",
        "rawAtlassianQueriesReturned",
        "rawSecretRefsReturned",
        "rawTokensReturned",
        "rawConnectorContentReturned",
        "rawConnectorConfigPersistedInEvidence",
      ])
    ) {
      return fail("data_connector_acceptance_redaction_missing");
    }
    return pass();
  }

  function validateDataConnectorLiveEvidence(content) {
    if (content.mode !== "live") {
      return fail("data_connector_live_evidence_not_live");
    }
    if (!["kubernetes", "target"].includes(content.deployment)) {
      return fail("data_connector_live_deployment_invalid");
    }
    for (const check of [
      "managed_connector_sync_exercised",
      "worker_cni_egress_enforced",
      "dns_private_address_denied",
      "secret_ref_resolution_verified",
      "worker_crash_retry_or_requeue_verified",
      "sync_log_redaction",
      "sanitized_readback_verified",
    ]) {
      if (!hasPassedCheck(content, check)) {
        return fail(`data_connector_live_missing_check:${check}`);
      }
    }
    if (
      !positiveInteger(content.connectors?.managedConnectorTypeCount) ||
      !positiveInteger(content.connectors?.syncAttemptCount) ||
      !positiveInteger(content.connectors?.successfulSyncCount)
    ) {
      return fail("data_connector_live_managed_sync_invalid");
    }
    if (
      content.egress?.workerCniOrNetworkPolicyEnforced !== true ||
      content.egress?.allowlistRequired !== true ||
      content.egress?.privateNetworkDenied !== true ||
      !positiveInteger(content.egress?.deniedPrivateNetworkCount) ||
      !positiveInteger(content.egress?.allowedExternalHostCount)
    ) {
      return fail("data_connector_live_egress_invalid");
    }
    if (
      content.egress?.dnsRebindingDenied !== true ||
      !positiveInteger(content.connectors?.deniedPrivateTargetCount)
    ) {
      return fail("data_connector_live_private_dns_invalid");
    }
    if (
      content.secrets?.secretRefResolutionVerified !== true ||
      content.secrets?.secretResolverBoundaryVerified !== true ||
      !positiveInteger(content.connectors?.secretRefConnectorCount) ||
      content.secrets?.rawSecretValuesReturned !== false ||
      content.secrets?.tokenValuesReturned !== false
    ) {
      return fail("data_connector_live_secret_resolution_invalid");
    }
    if (
      content.worker?.workerExecutionVerified !== true ||
      content.worker?.crashRetryOrRequeueVerified !== true ||
      !positiveInteger(content.worker?.requeuedSyncCount) ||
      content.worker?.completedAfterRetry !== true
    ) {
      return fail("data_connector_live_worker_retry_invalid");
    }
    if (
      content.logRedaction?.syncLogRedactionVerified !== true ||
      content.logRedaction?.podLogRedactionVerified !== true ||
      !positiveInteger(content.logRedaction?.podLogScanCount) ||
      !positiveInteger(content.logRedaction?.workerLogScanCount) ||
      content.logRedaction?.connectorContentSentinelHitCount !== 0 ||
      content.logRedaction?.secretSentinelHitCount !== 0 ||
      content.logRedaction?.tokenSentinelHitCount !== 0
    ) {
      return fail("data_connector_live_log_redaction_invalid");
    }
    if (
      content.readback?.adminPostureReadbackVerified !== true ||
      content.readback?.syncHistoryReadbackVerified !== true
    ) {
      return fail("data_connector_live_readback_invalid");
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "rawAllowedHostsReturned",
        "rawConnectorConfigReturned",
        "rawConnectorContentReturned",
        "rawEndpointUrlsReturned",
        "rawEvidencePathsReturned",
        "rawLogLinesReturned",
        "rawSecretRefsReturned",
        "secretValuesReturned",
        "tokenValuesReturned",
      ])
    ) {
      return fail("data_connector_live_redaction_missing");
    }
    return pass();
  }

  function validateToolDispatchLiveEvidence(content) {
    if (content.mode !== "live") {
      return fail("tool_dispatch_live_evidence_not_live");
    }
    if (!["kubernetes", "target"].includes(content.deployment)) {
      return fail("tool_dispatch_live_deployment_invalid");
    }
    for (const check of [
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
    ]) {
      if (!hasPassedCheck(content, check)) {
        return fail(`tool_dispatch_live_missing_check:${check}`);
      }
    }
    if (
      content.operations?.workerClaimExecutionVerified !== true ||
      !positiveInteger(content.operations?.dispatchRequestCount) ||
      !positiveInteger(content.operations?.completedDispatchCount)
    ) {
      return fail("tool_dispatch_live_worker_claim_invalid");
    }
    if (
      content.operations?.managedPayloadReadVerified !== true ||
      !positiveInteger(content.operations?.managedPayloadReadCount)
    ) {
      return fail("tool_dispatch_live_payload_read_invalid");
    }
    if (
      content.mcp?.streamableHttpToolsCallVerified !== true ||
      content.mcp?.protocolHeadersVerified !== true ||
      content.mcp?.jsonRpcEnvelopeVerified !== true ||
      !positiveInteger(content.mcp?.callCount) ||
      content.mcp?.payloadArgumentsRedacted !== true ||
      content.mcp?.outputRedacted !== true
    ) {
      return fail("tool_dispatch_live_mcp_invalid");
    }
    if (
      content.egress?.workerCniOrNetworkPolicyEnforced !== true ||
      content.egress?.privateNetworkDenied !== true ||
      content.egress?.redirectDenied !== true ||
      content.egress?.httpsOnly !== true ||
      !positiveInteger(content.egress?.deniedPrivateTargetCount)
    ) {
      return fail("tool_dispatch_live_egress_invalid");
    }
    if (
      content.egress?.dnsPrivateAddressDenied !== true ||
      !positiveInteger(content.egress?.deniedPrivateTargetCount)
    ) {
      return fail("tool_dispatch_live_private_dns_invalid");
    }
    if (
      content.secrets?.secretResolutionVerified !== true ||
      content.secrets?.secretResolverBoundaryVerified !== true ||
      content.secrets?.oauthTokenRedactionVerified !== true ||
      !positiveInteger(content.secrets?.secretResolutionCount) ||
      content.secrets?.secretValuesReturned !== false ||
      content.secrets?.tokenValuesReturned !== false
    ) {
      return fail("tool_dispatch_live_secret_resolution_invalid");
    }
    if (
      content.worker?.workerCrashRetryOrReclaimVerified !== true ||
      !positiveInteger(content.worker?.reclaimedDispatchCount) ||
      content.worker?.completedAfterReclaim !== true
    ) {
      return fail("tool_dispatch_live_worker_retry_invalid");
    }
    if (
      content.responseValidation?.responseSchemaValidationVerified !== true ||
      !positiveInteger(content.responseValidation?.schemaValidationCount) ||
      content.responseValidation?.invalidResponseFailedClosed !== true
    ) {
      return fail("tool_dispatch_live_response_validation_invalid");
    }
    if (
      content.logRedaction?.workerLogRedactionVerified !== true ||
      content.logRedaction?.podLogRedactionVerified !== true ||
      !positiveInteger(content.logRedaction?.workerLogScanCount) ||
      !positiveInteger(content.logRedaction?.podLogScanCount) ||
      content.logRedaction?.payloadSentinelHitCount !== 0 ||
      content.logRedaction?.responseSentinelHitCount !== 0 ||
      content.logRedaction?.secretSentinelHitCount !== 0 ||
      content.logRedaction?.tokenSentinelHitCount !== 0
    ) {
      return fail("tool_dispatch_live_log_redaction_invalid");
    }
    if (
      content.readback?.adminPostureReadbackVerified !== true ||
      content.readback?.dispatchReadbackVerified !== true
    ) {
      return fail("tool_dispatch_live_readback_invalid");
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "rawEvidencePathsReturned",
        "rawLogLinesReturned",
        "rawObjectStoreKeysReturned",
        "rawOperationHostsReturned",
        "rawPayloadValuesReturned",
        "rawResponseBodiesReturned",
        "rawSecretRefsReturned",
        "secretValuesReturned",
        "tokenValuesReturned",
      ])
    ) {
      return fail("tool_dispatch_live_redaction_missing");
    }
    return pass();
  }

  function validateToolDispatchAcceptanceContractEvidence(content) {
    for (const check of [
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
    ]) {
      if (!hasPassedCheck(content, check)) {
        return fail(`tool_dispatch_acceptance_missing_check:${check}`);
      }
    }
    if (
      content.worker?.disabledWithoutPayloadSource !== true ||
      !positiveInteger(content.worker?.managedClaimCount) ||
      !positiveInteger(content.worker?.managedPayloadReadCount) ||
      content.worker?.completedCount < 3 ||
      content.worker?.failedCount < 2 ||
      content.worker?.privateDnsFetchAttemptCount !== 0 ||
      content.worker?.missingSecretFetchAttemptCount !== 0
    ) {
      return fail("tool_dispatch_worker_contract_invalid");
    }
    if (
      content.mcp?.streamableHttpEnvelopeVerified !== true ||
      content.mcp?.protocolHeadersVerified !== true ||
      content.mcp?.outputRedacted !== true ||
      !positiveInteger(content.mcp?.callCount)
    ) {
      return fail("tool_dispatch_mcp_contract_invalid");
    }
    if (
      content.secrets?.secretResolutionVerified !== true ||
      content.secrets?.secretResolverBoundaryVerified !== true ||
      content.secrets?.missingSecretDeniedBeforeFetch !== true ||
      !positiveInteger(content.secrets?.secretResolutionCount)
    ) {
      return fail("tool_dispatch_secret_boundary_invalid");
    }
    if (
      !positiveInteger(
        content.responseValidation?.passedSchemaValidationCount,
      ) ||
      !positiveInteger(
        content.responseValidation?.failedSchemaValidationCount,
      ) ||
      content.responseValidation?.invalidResponseMetadataOnly !== true
    ) {
      return fail("tool_dispatch_response_validation_invalid");
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "rawObjectStoreKeysReturned",
        "rawPayloadValuesReturned",
        "rawResponseBodiesReturned",
        "rawSecretRefsReturned",
        "secretValuesReturned",
      ])
    ) {
      return fail("tool_dispatch_acceptance_redaction_missing");
    }
    return pass();
  }

  function validateModelToolOrchestrationContractEvidence(content) {
    for (const check of [
      "openai_chat_tool_call_normalizes_and_continues",
      "tool_schema_injection_authorized_for_builtin",
      "run_events_omit_provider_call_ids_and_arguments",
      "imported_operation_dispatch_waits_and_resumes",
      "worker_readback_continuation_uses_dispatch_job_id",
      "managed_dispatch_payload_is_encrypted_and_redacted",
      "approval_wait_reject_terminalizes_without_replay",
      "pending_approval_readback_is_metadata_only",
      "model_tool_evidence_omits_raw_values",
    ]) {
      if (!hasPassedCheck(content, check)) {
        return fail(`model_tool_orchestration_missing_check:${check}`);
      }
    }
    if (
      content.inline?.completedRun !== true ||
      content.inline?.toolSchemaInjected !== true ||
      !positiveInteger(content.inline?.providerRequestCount) ||
      content.inline?.providerRequestCount < 2 ||
      !positiveInteger(content.inline?.toolCompletedEventCount)
    ) {
      return fail("model_tool_inline_contract_invalid");
    }
    if (
      content.dispatch?.completedRun !== true ||
      content.dispatch?.dispatchJobIdInContinuation !== true ||
      content.dispatch?.workerReadbackOutcome !== "completed" ||
      !positiveInteger(content.dispatch?.providerRequestCount) ||
      content.dispatch?.providerRequestCount < 2 ||
      !positiveInteger(content.dispatch?.waitingDispatchEventCount)
    ) {
      return fail("model_tool_dispatch_contract_invalid");
    }
    if (
      content.managedPayload?.payloadStorage !==
        "managed_encrypted_object_store" ||
      content.managedPayload?.encryptedObjectWritten !== true ||
      content.managedPayload?.encryptedPayloadRedacted !== true ||
      content.managedPayload?.eventObjectKeyRedacted !== true
    ) {
      return fail("model_tool_managed_payload_contract_invalid");
    }
    if (
      content.approval?.pendingApprovalRedacted !== true ||
      content.approval?.providerContinuationCount !== 0 ||
      content.approval?.rejectedApprovalRemoved !== true ||
      content.approval?.runCancelled !== true
    ) {
      return fail("model_tool_approval_contract_invalid");
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "rawProviderCallIdsReturned",
        "rawToolArgumentsReturned",
        "rawToolResultsReturned",
        "rawOperationPayloadsReturned",
        "rawManagedObjectKeysReturned",
      ])
    ) {
      return fail("model_tool_orchestration_redaction_missing");
    }
    return pass();
  }

  function validateRagVectorEnterpriseContractEvidence(content) {
    for (const check of [
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
    ]) {
      if (!hasPassedCheck(content, check)) {
        return fail(`rag_vector_contract_missing_check:${check}`);
      }
    }
    const pgvector = content.defaultPgvector ?? {};
    if (
      pgvector.tenancyMode !== "single" ||
      pgvector.vectorDriver !== "pgvector" ||
      pgvector.isolationMode !== "shared_row_scope" ||
      pgvector.authorizedTierCount !== 4 ||
      pgvector.skippedDeniedCount !== 1 ||
      pgvector.tierCounts?.user_private !== 1 ||
      pgvector.tierCounts?.workspace !== 1 ||
      pgvector.tierCounts?.org !== 1 ||
      pgvector.tierCounts?.shared !== 1 ||
      pgvector.physicalIsolationMismatch !== true
    ) {
      return fail("rag_vector_pgvector_tiered_contract_invalid");
    }
    const external = content.externalVector ?? {};
    if (
      external.vectorDriver !== "qdrant" ||
      external.externalVectorStoreDriver !== "qdrant" ||
      external.externalVectorStoreRoutingActive !== true ||
      external.namespacePolicy !== "knowledge_base" ||
      external.partitioningPolicy !== "org" ||
      external.qdrantUpsertCount <= 0 ||
      external.qdrantQueryCount <= 0 ||
      external.qdrantApiKeyResolved !== true ||
      external.crossTenantHitsReturned !== 0 ||
      external.vectorsReturned !== false
    ) {
      return fail("rag_vector_external_contract_invalid");
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "rawCorpusReturned",
        "deniedCorpusIdReturned",
        "deniedCorpusContentReturned",
        "qdrantEndpointReturned",
        "qdrantCollectionReturned",
        "qdrantSecretRefReturned",
        "qdrantSecretValueReturned",
        "crossTenantVectorPayloadReturned",
      ])
    ) {
      return fail("rag_vector_contract_redaction_missing");
    }
    return pass();
  }

  function validateVoiceProviderAcceptanceEvidence(content) {
    for (const check of [
      "disabled_provider_fails_closed",
      "development_provider_catalog_sync_dedupes",
      "development_preview_artifact_readback",
      "voice_artifact_delete_redacts_storage_key",
      "transcription_usage_metadata_redacted",
      "openai_compatible_provider_sync_preview_and_transcribe",
      "provider_failure_response_redacted",
      "voice_acceptance_evidence_omits_raw_text_audio_and_secrets",
    ]) {
      if (!hasPassedCheck(content, check)) {
        return fail(`voice_provider_acceptance_missing_check:${check}`);
      }
    }
    const boundary = content.providerBoundary ?? {};
    if (
      boundary.disabledPreviewStatus !== 409 ||
      boundary.devProviderId !== "voice_dev" ||
      boundary.openAiCompatibleProviderId !== "voice_openai_compatible" ||
      boundary.openAiCompatibleUsesCoreApiWithoutServiceCodeChanges !== true ||
      !Array.isArray(boundary.providerFamiliesExercised) ||
      !["dev", "disabled", "openai-compatible"].every((provider) =>
        boundary.providerFamiliesExercised.includes(provider),
      )
    ) {
      return fail("voice_provider_boundary_invalid");
    }
    const catalog = content.catalog ?? {};
    if (
      catalog.devImportedCount !== 1 ||
      catalog.devExistingAfterResync !== 1 ||
      catalog.devProviderVoiceCount !== 1 ||
      catalog.openAiCompatibleImportedCount !== 1 ||
      catalog.duplicateProfilesCreated !== false
    ) {
      return fail("voice_provider_catalog_contract_invalid");
    }
    const artifacts = content.artifacts ?? {};
    if (
      artifacts.contentType !== "audio/wav" ||
      !positiveInteger(artifacts.readbackBytes) ||
      artifacts.deleted !== true ||
      artifacts.deletedReadbackStatus !== 404 ||
      typeof artifacts.storageKeyHash !== "string" ||
      !/^[a-f0-9]{64}$/u.test(artifacts.storageKeyHash) ||
      artifacts.rawStorageKeyReturned !== false
    ) {
      return fail("voice_artifact_contract_invalid");
    }
    const transcription = content.transcription ?? {};
    if (
      transcription.devStatus !== 200 ||
      transcription.openAiCompatibleStatus !== 200 ||
      transcription.usageAudioBytes !== 4 ||
      !positiveInteger(transcription.usageTextLength) ||
      transcription.promptProvided !== true
    ) {
      return fail("voice_transcription_contract_invalid");
    }
    const providerFailure = content.providerFailure ?? {};
    if (
      providerFailure.previewStatus !== 409 ||
      providerFailure.errorCode !== "voice_not_configured" ||
      providerFailure.rawProviderBodyReturned !== false
    ) {
      return fail("voice_provider_failure_contract_invalid");
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "rawSpeechTextReturned",
        "rawTranscriptReturned",
        "rawPromptReturned",
        "rawAudioReturned",
        "rawStorageKeyReturned",
        "rawProviderResponseReturned",
        "rawProviderEndpointReturned",
        "secretValuesReturned",
      ])
    ) {
      return fail("voice_provider_acceptance_redaction_missing");
    }
    return pass();
  }

  function validateVoiceProviderLiveEvidence(content) {
    const requiredChecks = [
      "live_tts_preview_verified",
      "live_transcription_verified",
      "voice_artifact_readback_verified",
      "voice_artifact_deletion_verified",
      "streaming_consent_reviewed",
      "provider_failure_redaction_verified",
      "voice_log_redaction",
      "voice_evidence_redaction_reviewed",
    ];
    const missingCheck = firstMissingCheck(content, requiredChecks);
    if (missingCheck !== undefined) {
      return fail(`voice_provider_live_missing_check:${missingCheck}`);
    }
    if (content.status !== "passed") {
      return fail("voice_provider_live_not_passed");
    }
    if (content.mode !== "live") {
      return fail("voice_provider_live_not_live");
    }
    if (!["compose", "kubernetes", "target"].includes(content.deployment)) {
      return fail("voice_provider_live_deployment_invalid");
    }
    const provider = content.provider ?? {};
    if (
      provider.driver !== "openai-compatible" ||
      !positiveInteger(provider.catalogSyncCount) ||
      !positiveInteger(provider.configuredVoiceCount) ||
      !positiveInteger(provider.ttsRequestCount)
    ) {
      return fail("voice_provider_live_tts_invalid");
    }
    const tts = content.tts ?? {};
    if (
      tts.livePreviewVerified !== true ||
      !positiveInteger(tts.generatedArtifactCount) ||
      !positiveInteger(tts.generatedAudioBytes)
    ) {
      return fail("voice_provider_live_tts_invalid");
    }
    const transcription = content.transcription ?? {};
    if (
      !positiveInteger(provider.transcriptionRequestCount) ||
      transcription.liveTranscriptionVerified !== true ||
      !positiveInteger(transcription.audioBytes) ||
      !positiveInteger(transcription.transcriptLength)
    ) {
      return fail("voice_provider_live_transcription_invalid");
    }
    const artifacts = content.artifacts ?? {};
    if (
      artifacts.readbackVerified !== true ||
      !positiveInteger(artifacts.readbackBytes) ||
      artifacts.deleteVerified !== true ||
      !positiveInteger(artifacts.deletedArtifactCount)
    ) {
      return fail("voice_provider_live_artifact_invalid");
    }
    const streamingConsent = content.streamingConsent ?? {};
    if (
      streamingConsent.reviewed !== true ||
      (streamingConsent.streamingEnabled === true &&
        !positiveInteger(streamingConsent.reviewedPolicyCount))
    ) {
      return fail("voice_provider_live_streaming_consent_invalid");
    }
    if (provider.providerFailureRedacted !== true) {
      return fail("voice_provider_live_failure_redaction_invalid");
    }
    const logRedaction = content.logRedaction ?? {};
    if (
      logRedaction.appLogRedactionVerified !== true ||
      logRedaction.podLogRedactionVerified !== true ||
      !positiveInteger(logRedaction.appLogScanCount) ||
      !positiveInteger(logRedaction.podLogScanCount) ||
      logRedaction.rawAudioSentinelHitCount !== 0 ||
      logRedaction.rawSpeechTextSentinelHitCount !== 0 ||
      logRedaction.rawTranscriptSentinelHitCount !== 0 ||
      logRedaction.secretSentinelHitCount !== 0
    ) {
      return fail("voice_provider_live_log_redaction_invalid");
    }
    if (hasFailureCodes(content)) {
      return fail("voice_provider_live_failure_codes_present");
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "rawAudioReturned",
        "rawEvidencePathsReturned",
        "rawObjectStoreKeysReturned",
        "rawProviderEndpointReturned",
        "rawProviderResponseReturned",
        "rawSpeechTextReturned",
        "rawTranscriptTextReturned",
        "secretValuesReturned",
        "tokenValuesReturned",
      ])
    ) {
      return fail("voice_provider_live_redaction_missing");
    }
    return pass();
  }

  function validateNotificationAdapterAcceptanceEvidence(content) {
    for (const check of [
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
    ]) {
      if (!hasPassedCheck(content, check)) {
        return fail(`notification_adapter_acceptance_missing_check:${check}`);
      }
    }
    const lifecycle = content.channelLifecycle ?? {};
    const channelTypes = Array.isArray(lifecycle.createdChannelTypes)
      ? lifecycle.createdChannelTypes
      : [];
    if (
      !["email", "mobile_push", "pagerduty", "slack", "teams", "webhook"].every(
        (type) => channelTypes.includes(type),
      ) ||
      lifecycle.redactedConfigReadbackVerified !== true ||
      lifecycle.internalConfigRetainedForDelivery !== true ||
      lifecycle.disabledStatus !== "disabled" ||
      lifecycle.disabledErrorCode !== "delivery_adapter_not_configured" ||
      lifecycle.policySuppressedDeliveryCount !== 6 ||
      lifecycle.policySuppressionAttemptedEgress !== false
    ) {
      return fail("notification_channel_lifecycle_contract_invalid");
    }
    const routing = content.adapterRouting ?? {};
    const providerCounts = routing.providerCounts ?? {};
    if (
      routing.deliveryCount !== 6 ||
      routing.fetchRequestCount !== 6 ||
      routing.smtpSendMailCount !== 1 ||
      !positiveInteger(routing.secretResolutionCount) ||
      routing.secretResolutionCount < 3 ||
      providerCounts.smtp !== 1 ||
      providerCounts.webhook !== 1 ||
      providerCounts.slack !== 1 ||
      providerCounts.teams !== 1 ||
      providerCounts.pagerduty !== 1 ||
      providerCounts.fcm !== 1 ||
      routing.pagerDutyRoutingKeyResolved !== true ||
      routing.fcmDeviceTokenResolved !== true ||
      routing.fcmAccessTokenUsed !== true ||
      routing.idOnlyProviderPayloads !== true ||
      routing.commentBodyInProviderPayloads !== false
    ) {
      return fail("notification_adapter_routing_contract_invalid");
    }
    const retry = content.retry ?? {};
    if (
      retry.successStatus !== "sent" ||
      retry.successAttemptCount !== 2 ||
      retry.successClearedError !== true ||
      retry.successClearedRetryState !== true ||
      retry.deadLetterStatus !== "failed" ||
      retry.deadLetterAttemptCount !== 5 ||
      retry.deadLetterReason !== "max_attempts_exhausted" ||
      retry.rawProviderFailureReturned !== false
    ) {
      return fail("notification_retry_contract_invalid");
    }
    const isolation = content.channelTypeIsolation ?? {};
    if (
      isolation.fetchAttempted !== false ||
      isolation.status !== "failed" ||
      isolation.errorCode !== "notification_channel_type_unsupported"
    ) {
      return fail("notification_channel_type_isolation_invalid");
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "rawCommentBodyReturned",
        "rawDestinationReturned",
        "rawWebhookUrlsReturned",
        "rawEmailReturned",
        "rawSecretRefsReturned",
        "rawSecretValuesReturned",
        "rawProviderResponseReturned",
        "rawSmtpCredentialsReturned",
        "rawFcmCredentialsReturned",
      ])
    ) {
      return fail("notification_adapter_acceptance_redaction_missing");
    }
    return pass();
  }

  function validateNotificationAdapterLiveEvidence(content) {
    const requiredLiveChecks = [
      "live_notification_delivery_verified",
      "mixed_channel_type_delivery_verified",
      "secret_ref_resolution_verified",
      "notification_egress_policy_verified",
      "provider_payload_redaction_verified",
      "channel_type_isolation_verified",
      "retry_and_dead_letter_verified",
      "notification_log_redaction",
      "notification_evidence_redaction_reviewed",
    ];
    const missingCheck = requiredLiveChecks.find(
      (check) => !hasPassedCheck(content, check),
    );
    if (missingCheck !== undefined) {
      return fail(`notification_adapter_live_missing_check:${missingCheck}`);
    }
    if (content.status !== "passed") {
      return fail("notification_adapter_live_not_passed");
    }
    if (content.mode !== "live") {
      return fail("notification_adapter_live_not_live");
    }
    if (!["compose", "kubernetes", "target"].includes(content.deployment)) {
      return fail("notification_adapter_live_deployment_invalid");
    }
    const delivery = content.delivery ?? {};
    if (
      delivery.deliveryDriver === "disabled" ||
      !positiveInteger(delivery.attemptedCount) ||
      !positiveInteger(delivery.successfulCount) ||
      !positiveInteger(delivery.providerFamilyCount) ||
      delivery.providerPayloadRedacted !== true
    ) {
      return fail("notification_adapter_live_delivery_invalid");
    }
    const channels = content.channels ?? {};
    if (
      !positiveInteger(channels.total) ||
      channels.total <= 1 ||
      channels.mixedChannelTypesVerified !== true
    ) {
      return fail("notification_adapter_live_channel_mix_invalid");
    }
    const secrets = content.secrets ?? {};
    if (
      !positiveInteger(secrets.secretRefResolutionCount) ||
      secrets.secretResolverBoundaryVerified !== true
    ) {
      return fail("notification_adapter_live_secret_resolution_invalid");
    }
    const egress = content.egress ?? {};
    if (
      egress.networkPolicyEnforced !== true ||
      egress.hostAllowlistEnforced !== true ||
      egress.privateNetworkDenied !== true ||
      egress.providerEndpointAccessVerified !== true
    ) {
      return fail("notification_adapter_live_egress_invalid");
    }
    const policy = content.policy ?? {};
    if (
      policy.suppressionVerified !== true ||
      !positiveInteger(policy.retrySuccessCount) ||
      !positiveInteger(policy.deadLetterCount) ||
      policy.channelTypeIsolationVerified !== true
    ) {
      return fail("notification_adapter_live_policy_invalid");
    }
    const logRedaction = content.logRedaction ?? {};
    if (
      logRedaction.appLogRedactionVerified !== true ||
      logRedaction.podLogRedactionVerified !== true ||
      !positiveInteger(logRedaction.appLogScanCount) ||
      !positiveInteger(logRedaction.podLogScanCount) ||
      logRedaction.destinationSentinelHitCount !== 0 ||
      logRedaction.bodySentinelHitCount !== 0 ||
      logRedaction.secretSentinelHitCount !== 0 ||
      logRedaction.tokenSentinelHitCount !== 0
    ) {
      return fail("notification_adapter_live_log_redaction_invalid");
    }
    if (hasFailureCodes(content)) {
      return fail("notification_adapter_live_failure_codes_present");
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "rawDestinationsReturned",
        "rawEndpointUrlsReturned",
        "rawEvidencePathsReturned",
        "rawLogLinesReturned",
        "rawMessageBodiesReturned",
        "rawProviderResponsesReturned",
        "rawSecretRefsReturned",
        "secretValuesReturned",
        "tokenValuesReturned",
      ])
    ) {
      return fail("notification_adapter_live_redaction_missing");
    }
    return pass();
  }

  function validateNativeClientApiContractEvidence(content) {
    for (const check of [
      "device_authorization_create_list_redacts_refresh_hash",
      "device_authorization_scope_escalation_denied",
      "device_authorization_refresh_rotates_and_revokes_old_credentials",
      "device_authorization_refresh_public_route_secure_mode",
      "device_authorization_revoke_invalidates_access_and_refresh",
      "resumable_upload_requires_device_file_scopes_and_redacts_object_keys",
      "resumable_upload_composes_parts_and_cleans_staging",
      "mobile_push_channel_readback_redacts_token_ref",
      "native_client_evidence_omits_tokens_secret_refs_object_keys_and_content",
    ]) {
      if (!hasPassedCheck(content, check)) {
        return fail(`native_client_api_contract_missing_check:${check}`);
      }
    }
    const device = content.deviceAuthorization ?? {};
    if (
      device.createStatus !== 201 ||
      device.accessTokenPrefix !== "rmk" ||
      device.refreshTokenPrefix !== "rmr" ||
      device.listStatus !== 200 ||
      !positiveInteger(device.listCount) ||
      device.meStatus !== 200 ||
      device.subjectApiKeyMatched !== true ||
      device.hashedRefreshTokenReturned !== false ||
      device.scopeEscalationStatus !== 400 ||
      device.scopeEscalationErrorCode !==
        "device_authorization_scope_exceeded" ||
      device.secureRefreshWithoutAccessStatus !== 200 ||
      device.rotatedAccessToken !== true ||
      device.rotatedRefreshToken !== true ||
      device.oldAccessStatus !== 403 ||
      device.oldRefreshStatus !== 403 ||
      device.newAccessStatus !== 200 ||
      device.revokeStatus !== 200 ||
      device.revokedAccessStatus !== 403 ||
      device.revokedRefreshStatus !== 403 ||
      device.postRevokeScopedAccessStatus !== 201
    ) {
      return fail("native_client_device_authorization_contract_invalid");
    }
    const upload = content.resumableUpload ?? {};
    if (
      upload.createStatus !== 201 ||
      upload.refreshStatus !== 200 ||
      upload.completeStatus !== 200 ||
      upload.contentReadbackStatus !== 200 ||
      upload.createdFileStatus !== "uploading" ||
      upload.completedFileStatus !== "available" ||
      upload.uploadMode !== "resumable_backend_composed" ||
      !positiveInteger(upload.partCount) ||
      !positiveInteger(upload.partSizeBytes) ||
      !positiveInteger(upload.maxBytes) ||
      !positiveInteger(upload.readbackBytes) ||
      typeof upload.readbackSha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(upload.readbackSha256) ||
      upload.stagedPartCleanupVerified !== true ||
      upload.objectKeyReturned !== false ||
      upload.uploadUrlsPersisted !== false ||
      upload.rawContentReturned !== false
    ) {
      return fail("native_client_resumable_upload_contract_invalid");
    }
    const mobilePush = content.mobilePush ?? {};
    if (
      mobilePush.createStatus !== 201 ||
      mobilePush.listStatus !== 200 ||
      !positiveInteger(mobilePush.listCount) ||
      mobilePush.tokenConfigured !== true ||
      mobilePush.tokenRefScheme !== "env" ||
      mobilePush.tokenRefReturned !== false ||
      mobilePush.tokenRefRetainedInternally !== true ||
      mobilePush.platform !== "ios" ||
      mobilePush.collapseKeyReturned !== "romeo-native"
    ) {
      return fail("native_client_mobile_push_contract_invalid");
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "rawAccessTokensReturned",
        "rawRefreshTokensReturned",
        "hashedRefreshTokensReturned",
        "rawMobilePushTokenRefsReturned",
        "rawMobilePushTokenValuesReturned",
        "objectStoreKeysReturned",
        "uploadUrlsReturned",
        "rawFileContentReturned",
      ])
    ) {
      return fail("native_client_api_contract_redaction_missing");
    }
    return pass();
  }

  function validateBrowserAutomationContractEvidence(content) {
    for (const check of [
      "browser_task_approval_metadata_redaction",
      "stale_running_browser_task_reclaimed",
      "external_runner_completion",
      "worker_stdout_redaction",
      "worker_stderr_redaction",
      "registered_artifact_readback",
      "browser_artifact_retention_cleanup",
      "retention_metadata_redaction",
    ]) {
      if (!hasPassedCheck(content, check)) {
        return fail(`browser_automation_contract_missing_check:${check}`);
      }
    }
    if (
      content.workflow?.finalStatus !== "completed" ||
      content.worker?.firstAttempt !== 1 ||
      content.worker?.reclaimedAttempt !== 2 ||
      content.worker?.output?.completedCount !== 1 ||
      content.worker?.output?.failedCount !== 0 ||
      content.artifacts?.registeredCount !== 1 ||
      !Number.isInteger(content.artifacts?.readbackBytes) ||
      content.artifacts.readbackBytes <= 0
    ) {
      return fail("browser_automation_contract_readback_invalid");
    }
    if (content.artifacts?.retentionDeletedCount !== 1) {
      return fail("browser_automation_retention_cleanup_missing");
    }
    for (const field of [
      "approvalReadback",
      "workerStdout",
      "workerStderr",
      "workflowReadback",
      "retentionEvidence",
    ]) {
      if (content.redaction?.[field] !== "passed") {
        return fail("browser_automation_redaction_missing");
      }
    }
    return pass();
  }

  function validateBrowserAutomationLiveEvidence(content) {
    if (content.mode !== "live") {
      return fail("browser_automation_live_evidence_not_live");
    }
    if (!["kubernetes", "target"].includes(content.deployment)) {
      return fail("browser_automation_live_deployment_invalid");
    }
    for (const check of [
      "reviewed_runner_sandbox",
      "network_denial_enforced",
      "worker_crash_retry",
      "retention_worker_execution",
      "pod_log_redaction",
    ]) {
      if (!hasPassedCheck(content, check)) {
        return fail(`browser_automation_live_missing_check:${check}`);
      }
    }
    if (
      content.runnerSandbox?.reviewedRunnerSandbox !== true ||
      content.runnerSandbox?.isolatedContextPerTask !== true ||
      content.runnerSandbox?.runnerProcessIsolated !== true ||
      content.runnerSandbox?.targetOriginOnly !== true
    ) {
      return fail("browser_automation_live_runner_sandbox_invalid");
    }
    if (
      content.networkDenial?.privateNetworkDenied !== true ||
      content.networkDenial?.cniOrNetworkPolicyDenied !== true ||
      content.networkDenial?.dnsRebindingDenied !== true ||
      !positiveInteger(content.networkDenial?.deniedNetworkCount) ||
      !positiveInteger(content.networkDenial?.blockedTargetCount)
    ) {
      return fail("browser_automation_live_network_denial_invalid");
    }
    if (
      content.crashRetry?.workerCrashRetryVerified !== true ||
      !Number.isInteger(content.crashRetry?.reclaimedAttempt) ||
      content.crashRetry.reclaimedAttempt < 2 ||
      content.crashRetry?.completedAfterRetry !== true
    ) {
      return fail("browser_automation_live_crash_retry_invalid");
    }
    if (
      content.retention?.workerExecutionVerified !== true ||
      !positiveInteger(content.retention?.deletedArtifactCount) ||
      !positiveInteger(content.retention?.cleanedJobCount)
    ) {
      return fail("browser_automation_live_retention_invalid");
    }
    if (
      content.logRedaction?.podLogRedactionVerified !== true ||
      content.logRedaction?.workerLogRedactionVerified !== true ||
      !positiveInteger(content.logRedaction?.podLogScanCount) ||
      !positiveInteger(content.logRedaction?.workerLogScanCount) ||
      content.logRedaction?.rawTaskSentinelHitCount !== 0 ||
      content.logRedaction?.rawPageSentinelHitCount !== 0 ||
      content.logRedaction?.secretSentinelHitCount !== 0
    ) {
      return fail("browser_automation_live_log_redaction_invalid");
    }
    for (const field of [
      "artifactBytesReturned",
      "rawEvidencePathsReturned",
      "rawPageContentReturned",
      "rawRunnerUrlReturned",
      "rawTaskTextReturned",
      "secretValuesReturned",
    ]) {
      if (content.redaction?.[field] !== false) {
        return fail(`browser_automation_live_redaction_invalid:${field}`);
      }
    }
    return pass();
  }

  function validateDataRightsRetentionContractEvidence(content) {
    for (const check of [
      "retention_evidence_positive_generation",
      "retention_evidence_failed_status_generation",
      "retention_evidence_invalid_cli_inputs_rejected",
      "support_bundle_records_retention_evidence_posture",
      "support_bundle_omits_retention_evidence_paths_and_bodies",
    ]) {
      if (!hasPassedCheck(content, check)) {
        return fail(`data_rights_retention_missing_check:${check}`);
      }
    }
    const operationalLogs = content.generatedEvidence?.operationalLogs ?? {};
    if (
      operationalLogs.schemaVersion !==
        "romeo.data-rights-retention-evidence.v1" ||
      operationalLogs.control !== "operational_logs" ||
      operationalLogs.status !== "passed" ||
      !Number.isInteger(operationalLogs.retentionDays) ||
      operationalLogs.retentionDays <= 0 ||
      operationalLogs.destructionValidated !== true ||
      operationalLogs.encryptedAtRest !== true ||
      !Number.isInteger(operationalLogs.reviewedSystemCount) ||
      operationalLogs.reviewedSystemCount <= 0 ||
      operationalLogs.failureCodeCount !== 0
    ) {
      return fail("data_rights_operational_log_evidence_invalid");
    }
    const backups = content.generatedEvidence?.backups ?? {};
    if (
      backups.schemaVersion !== "romeo.data-rights-retention-evidence.v1" ||
      backups.control !== "backups" ||
      backups.status !== "failed" ||
      !Number.isInteger(backups.retentionDays) ||
      backups.retentionDays <= 0 ||
      backups.destructionValidated !== false ||
      backups.encryptedAtRest !== true ||
      !Number.isInteger(backups.reviewedSystemCount) ||
      backups.reviewedSystemCount <= 0 ||
      !Number.isInteger(backups.failureCodeCount) ||
      backups.failureCodeCount <= 0
    ) {
      return fail("data_rights_backup_failure_evidence_invalid");
    }
    const rejectedCases = Array.isArray(content.rejectedCases)
      ? content.rejectedCases
      : [];
    for (const id of [
      "passed_status_rejects_failure_code",
      "passed_status_rejects_missing_destruction_validation",
      "invalid_control_rejected",
      "missing_retention_days_rejected",
    ]) {
      if (
        !rejectedCases.some(
          (item) => item.id === id && item.status === "rejected",
        )
      ) {
        return fail(`data_rights_invalid_cli_case_missing:${id}`);
      }
    }
    if (
      content.supportBundle?.schemaVersion !== "romeo.support-bundle.v1" ||
      content.supportBundle?.dataRightsEvidenceConfigured !== true ||
      !Number.isInteger(content.supportBundle?.evidenceCount) ||
      content.supportBundle.evidenceCount <= 0
    ) {
      return fail("data_rights_support_bundle_posture_invalid");
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "backupLocationsReturned",
        "evidenceFileBodiesReturned",
        "rawEvidencePathsReturned",
        "rawLogDestinationsReturned",
        "secretValuesReturned",
      ])
    ) {
      return fail("data_rights_retention_redaction_missing");
    }
    return pass();
  }

  function validateBillingOperationsEvidence(content) {
    const requiredChecks = [
      "entitlement_reconcile_worker_cadence",
      "billing_lifecycle_worker_cadence",
      "entitlement_api_readback",
      "lifecycle_api_readback",
      "worker_log_redaction",
      "billing_alerting_readback",
    ];
    const missingCheck = firstMissingCheck(content, requiredChecks);
    if (missingCheck !== undefined) {
      return fail(`billing_operations_missing_check:${missingCheck}`);
    }
    if (content.status !== "passed") {
      return fail("billing_operations_not_passed");
    }
    if (content.mode !== "live") {
      return fail("billing_operations_not_live");
    }
    if (!["compose", "kubernetes", "target"].includes(content.deployment)) {
      return fail("billing_operations_deployment_invalid");
    }
    const cadence = content.cadence ?? {};
    if (
      !positiveInteger(cadence.windowMinutes) ||
      !positiveInteger(cadence.expectedRunCount) ||
      !positiveInteger(cadence.observedRunCount) ||
      cadence.observedRunCount < cadence.expectedRunCount ||
      cadence.missedRunCount !== 0
    ) {
      return fail("billing_operations_cadence_missing");
    }
    for (const [field, failure] of [
      ["entitlementReconcile", "billing_operations_entitlement_worker_missing"],
      ["lifecycleEnforce", "billing_operations_lifecycle_worker_missing"],
    ]) {
      const worker = content.workers?.[field] ?? {};
      if (
        worker.configured !== true ||
        worker.scheduleConfigured !== true ||
        worker.lastRunStatus !== "passed" ||
        !positiveInteger(worker.successCount) ||
        worker.failureCount !== 0 ||
        worker.alertConfigured !== true
      ) {
        return fail(failure);
      }
    }
    const readback = content.apiReadback ?? {};
    if (
      readback.entitlementReportHealthy !== true ||
      readback.lifecycleReportHealthy !== true ||
      !Number.isInteger(readback.mismatchCount) ||
      readback.mismatchCount < 0 ||
      !Number.isInteger(readback.dueTransitionCount) ||
      readback.dueTransitionCount < 0
    ) {
      return fail("billing_operations_api_readback_missing");
    }
    const alerting = content.alerting ?? {};
    if (
      alerting.checked !== true ||
      alerting.status !== "passed" ||
      !positiveInteger(alerting.configuredRuleCount) ||
      !Number.isInteger(alerting.firingRequiredCount) ||
      alerting.firingRequiredCount < 0
    ) {
      return fail("billing_operations_alerting_missing");
    }
    if (hasFailureCodes(content)) {
      return fail("billing_operations_failure_codes_present");
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "rawBillingProviderPayloadsReturned",
        "rawWorkerLogsReturned",
        "rawApiKeysReturned",
        "rawAlertPayloadsReturned",
        "rawCustomerIdentifiersReturned",
        "rawEvidencePathsReturned",
        "secretValuesReturned",
      ])
    ) {
      return fail("billing_operations_redaction_missing");
    }
    return pass();
  }

  function validateAuditIntegrityEvidence(content) {
    const requiredChecks = [
      "audit_export_configured",
      "siem_delivery_readback",
      "immutable_storage_reviewed",
      "retention_policy_reviewed",
      "time_sync_reviewed",
      "checksum_chain_verified",
      "audit_evidence_redaction_flags",
    ];
    const missingCheck = firstMissingCheck(content, requiredChecks);
    if (missingCheck !== undefined) {
      return fail(`audit_integrity_missing_check:${missingCheck}`);
    }
    if (content.status !== "passed") {
      return fail("audit_integrity_not_passed");
    }
    if (content.mode !== "live") {
      return fail("audit_integrity_not_live");
    }
    if (!["compose", "kubernetes", "target"].includes(content.deployment)) {
      return fail("audit_integrity_deployment_invalid");
    }
    const exportPosture = content.export ?? {};
    if (
      exportPosture.enabled !== true ||
      !["siem", "object_store", "both"].includes(exportPosture.destinationType)
    ) {
      return fail("audit_integrity_export_missing");
    }
    if (
      !positiveInteger(exportPosture.successfulDeliveryCount) ||
      !Number.isInteger(exportPosture.failedDeliveryCount) ||
      exportPosture.failedDeliveryCount < 0 ||
      exportPosture.lastDeliveryStatus !== "passed"
    ) {
      return fail("audit_integrity_delivery_missing");
    }
    const immutability = content.immutability ?? {};
    if (
      immutability.wormStorageConfigured !== true ||
      immutability.retentionLockConfigured !== true ||
      !positiveInteger(immutability.immutableWindowDays) ||
      immutability.deleteProtectionReviewed !== true
    ) {
      return fail("audit_integrity_immutability_missing");
    }
    const retention = content.retention ?? {};
    if (
      retention.policyReviewed !== true ||
      !positiveInteger(retention.auditLogRetentionDays) ||
      !positiveInteger(retention.exportRetentionDays)
    ) {
      return fail("audit_integrity_retention_missing");
    }
    const timeSync = content.timeSync ?? {};
    if (
      timeSync.sourceConfigured !== true ||
      !positiveInteger(timeSync.checkedHostCount) ||
      !Number.isInteger(timeSync.maxClockSkewMs) ||
      timeSync.maxClockSkewMs < 0 ||
      timeSync.driftWithinThreshold !== true
    ) {
      return fail("audit_integrity_time_sync_missing");
    }
    const checksumChain = content.checksumChain ?? {};
    if (
      checksumChain.checked !== true ||
      checksumChain.status !== "passed" ||
      !positiveInteger(checksumChain.verifiedRecordCount) ||
      checksumChain.brokenLinkCount !== 0
    ) {
      return fail("audit_integrity_checksum_chain_missing");
    }
    if (hasFailureCodes(content)) {
      return fail("audit_integrity_failure_codes_present");
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "rawAuditMetadataReturned",
        "rawActorIdentifiersReturned",
        "rawDestinationReturned",
        "rawSiemPayloadsReturned",
        "rawEvidencePathsReturned",
        "secretValuesReturned",
      ])
    ) {
      return fail("audit_integrity_redaction_missing");
    }
    return pass();
  }

  function validateTenantPurgeEvidence(content) {
    if (content.status !== "passed") {
      return fail("tenant_purge_not_passed");
    }
    if (content.mode !== "live") {
      return fail("tenant_purge_not_live");
    }
    if (!["compose", "kubernetes", "target"].includes(content.deployment)) {
      return fail("tenant_purge_deployment_invalid");
    }
    const requiredChecks = [
      "app_database_purge_executed",
      "app_object_store_purge_executed",
      "external_vector_store_reviewed",
      "backup_retention_reviewed",
      "operational_log_retention_reviewed",
      "support_bundle_retention_reviewed",
      "external_secret_store_reviewed",
      "tenant_purge_redaction_reviewed",
    ];
    const missingCheck = firstMissingCheck(content, requiredChecks);
    if (missingCheck !== undefined) {
      return fail(`tenant_purge_missing_check:${missingCheck}`);
    }
    if (hasFailureCodes(content)) {
      return fail("tenant_purge_failure_codes_present");
    }
    for (const [field, minimum] of [
      ["tenantCount", 1],
      ["databasePurgedTenantCount", 1],
      ["objectStorePurgedTenantCount", 1],
      ["externalVectorReviewedTenantCount", 1],
      ["backupRetentionReviewedTenantCount", 1],
      ["operationalLogRetentionReviewedTenantCount", 1],
      ["supportBundleReviewedTenantCount", 1],
      ["externalSecretReviewedTenantCount", 1],
    ]) {
      if (
        !Number.isInteger(content.purge?.[field]) ||
        content.purge[field] < minimum
      ) {
        return fail(`tenant_purge_${field}_missing`);
      }
    }
    for (const [field, minimum] of [
      ["postgresRecordCount", 1],
      ["objectStoreObjectCount", 1],
      ["externalVectorNamespaceCount", 1],
      ["backupSystemCount", 1],
      ["operationalLogSystemCount", 1],
      ["supportBundleSystemCount", 1],
      ["secretStoreCount", 1],
    ]) {
      if (
        !Number.isInteger(content.storage?.[field]) ||
        content.storage[field] < minimum
      ) {
        return fail(`tenant_purge_${field}_missing`);
      }
    }
    for (const field of [
      "backupRetentionDays",
      "operationalLogRetentionDays",
      "supportBundleRetentionDays",
    ]) {
      if (!positiveInteger(content.retention?.[field])) {
        return fail(`tenant_purge_${field}_missing`);
      }
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "backupLocationsReturned",
        "evidenceFileBodiesReturned",
        "objectStoreKeysReturned",
        "operationalLogBodiesReturned",
        "rawEvidencePathsReturned",
        "secretValuesReturned",
        "supportBundleBodiesReturned",
        "vectorValuesReturned",
      ])
    ) {
      return fail("tenant_purge_redaction_missing");
    }
    return pass();
  }

  function validateDataRightsRetentionEvidence(content, expectedControl) {
    if (content.control !== expectedControl) {
      return fail(`data_rights_retention_wrong_control:${content.control}`);
    }
    if (content.status !== "passed") {
      return fail("data_rights_retention_not_passed");
    }
    if (!positiveInteger(content.retentionDays)) {
      return fail("data_rights_retention_days_invalid");
    }
    if (content.destructionValidated !== true) {
      return fail("data_rights_retention_destruction_not_validated");
    }
    if (content.encryptedAtRest !== true) {
      return fail("data_rights_retention_encryption_missing");
    }
    if (!positiveInteger(content.reviewedSystemCount)) {
      return fail("data_rights_retention_reviewed_system_count_invalid");
    }
    if (
      content.immutableWindowDays !== undefined &&
      (!Number.isInteger(content.immutableWindowDays) ||
        content.immutableWindowDays < 0)
    ) {
      return fail("data_rights_retention_immutable_window_invalid");
    }
    const failureCodes = Array.isArray(content.failureCodes)
      ? content.failureCodes
      : [];
    if (failureCodes.length > 0) {
      return fail("data_rights_retention_failure_codes_present");
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "backupLocationIncluded",
        "logContentIncluded",
        "objectStoreKeysIncluded",
        "rawSystemNamesIncluded",
        "secretValuesIncluded",
      ])
    ) {
      return fail("data_rights_retention_redaction_missing");
    }
    return pass();
  }

  function validateSupportBundleRedactionEvidence(content) {
    const requiredChecks = [
      "support_bundle_generation",
      "raw_log_content_not_included",
      "raw_evidence_content_not_included",
      "access_review_evidence_linked_without_raw_content",
      "environment_secret_values_not_included",
      "configured_secret_posture_recorded",
      "unrecognized_enum_values_not_included",
    ];
    const checks = new Set(Array.isArray(content.checks) ? content.checks : []);
    for (const check of requiredChecks) {
      if (!checks.has(check)) {
        return fail(`support_bundle_missing_check:${check}`);
      }
    }

    const bundle = content.supportBundle;
    if (bundle?.schemaVersion !== "romeo.support-bundle.v1") {
      return fail("support_bundle_schema_missing");
    }
    for (const [field, minimum] of [
      ["evidenceCount", 1],
      ["accessReviewEvidenceCount", 1],
      ["logCount", 1],
      ["migrationCount", 1],
    ]) {
      if (!Number.isInteger(bundle?.[field]) || bundle[field] < minimum) {
        return fail(`support_bundle_${field}_missing`);
      }
    }

    const configuredSecretKeys = new Set(
      Array.isArray(bundle.configuredSecretKeys)
        ? bundle.configuredSecretKeys
        : [],
    );
    for (const key of [
      "DATABASE_URL",
      "LOCAL_AUTH_SECRET_ENCRYPTION_KEY",
      "MANAGED_SECRET_ENCRYPTION_KEY",
      "SESSION_SECRET",
      "WEBHOOK_SIGNING_KEY",
    ]) {
      if (!configuredSecretKeys.has(key)) {
        return fail(`support_bundle_missing_configured_secret:${key}`);
      }
    }

    if (
      !redactionFlagsFalse(content.redaction, [
        "rawLogContentReturned",
        "rawEvidenceContentReturned",
        "accessReviewRawContentReturned",
        "environmentSecretValuesReturned",
        "unrecognizedEnumValuesReturned",
      ])
    ) {
      return fail("support_bundle_redaction_missing");
    }
    return pass();
  }

  function validateSupportBundleEvidence(content) {
    if (content.status !== "generated") {
      return fail("support_bundle_not_generated");
    }
    if (
      typeof content.package?.name !== "string" ||
      typeof content.package?.version !== "string" ||
      typeof content.package?.packageManager !== "string"
    ) {
      return fail("support_bundle_package_missing");
    }
    if (
      typeof content.runtime?.node !== "string" ||
      typeof content.runtime?.platform !== "string" ||
      typeof content.runtime?.arch !== "string"
    ) {
      return fail("support_bundle_runtime_missing");
    }
    if (
      !Array.isArray(content.deployment) ||
      content.deployment.length < 3 ||
      !content.deployment.every((item) => validFileSummary(item))
    ) {
      return fail("support_bundle_deployment_inventory_missing");
    }
    if (
      !Number.isInteger(content.migrations?.count) ||
      content.migrations.count < 1 ||
      content.migrations.greenfieldBaselineOnly !== true ||
      !Array.isArray(content.migrations.files) ||
      !content.migrations.files.every((item) => validFileSummary(item))
    ) {
      return fail("support_bundle_migration_inventory_invalid");
    }
    if (
      !Array.isArray(content.evidence) ||
      content.evidence.length < 1 ||
      !content.evidence.every((item) => validFileSummary(item)) ||
      !content.evidence.some(
        (item) =>
          typeof item.schemaVersion === "string" &&
          typeof item.evidenceStatus === "string",
      )
    ) {
      return fail("support_bundle_evidence_inventory_missing");
    }
    if (
      content.complianceEvidence?.accessReview?.status !== "present" ||
      !positiveInteger(content.complianceEvidence.accessReview.count)
    ) {
      return fail("support_bundle_access_review_missing");
    }
    const dataRights = content.dataRights ?? {};
    if (
      dataRights.coverageApiPath !==
        "/api/v1/governance/data-rights/coverage" ||
      dataRights.exportPreviewApiPath !==
        "/api/v1/governance/data-exports/preview" ||
      dataRights.exportExecuteApiPath !==
        "/api/v1/governance/data-exports/execute" ||
      dataRights.deletionPreviewApiPath !==
        "/api/v1/governance/data-deletions/preview" ||
      dataRights.deletionExecuteApiPath !==
        "/api/v1/governance/data-deletions/execute" ||
      !Array.isArray(dataRights.supportedDeletionResourceTypes) ||
      dataRights.supportedDeletionResourceTypes.length < 3 ||
      dataRights.retentionEvidence?.schemaVersion !==
        "romeo.data-rights-retention-evidence.v1" ||
      !Array.isArray(dataRights.externalRetentionControls) ||
      dataRights.externalRetentionControls.length < 2
    ) {
      return fail("support_bundle_data_rights_posture_missing");
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "rawContentIncluded",
        "secretValuesIncluded",
      ])
    ) {
      return fail("support_bundle_redaction_missing");
    }
    return pass();
  }

  function validateProviderResilienceEvidence(content) {
    const requiredChecks = [
      "pre_output_retry",
      "no_retry_after_output",
      "circuit_breaker_fail_fast",
      "provider_fallback_before_output",
      "provider_kill_switch_fallback",
      "raw_provider_error_redaction",
    ];
    const checks = new Set(Array.isArray(content.checks) ? content.checks : []);
    for (const check of requiredChecks) {
      if (!checks.has(check)) {
        return fail(`provider_resilience_missing_check:${check}`);
      }
    }
    const cases = new Map(
      Array.isArray(content.cases)
        ? content.cases
            .filter((item) => typeof item?.name === "string")
            .map((item) => [item.name, item])
        : [],
    );
    const retry = cases.get("pre_output_retry");
    if (
      retry?.providerCallCount !== 2 ||
      retry?.terminalData?.providerRetryAttempts !== 1 ||
      !Array.isArray(retry?.eventTypes) ||
      !retry.eventTypes.includes("run.completed")
    ) {
      return fail("provider_resilience_retry_incomplete");
    }
    const noRetry = cases.get("no_retry_after_output");
    if (
      noRetry?.providerCallCount !== 1 ||
      noRetry?.terminalData?.errorCode !== "provider_stream_error" ||
      !Array.isArray(noRetry?.eventTypes) ||
      !noRetry.eventTypes.includes("message.delta") ||
      !noRetry.eventTypes.includes("run.failed")
    ) {
      return fail("provider_resilience_no_retry_after_output_incomplete");
    }
    const circuit = cases.get("circuit_breaker_fail_fast");
    const terminalData = Array.isArray(circuit?.terminalData)
      ? circuit.terminalData
      : [];
    if (
      !Number.isInteger(circuit?.providerCallCount) ||
      circuit.providerCallCount < 2 ||
      !terminalData.some(
        (item) =>
          item?.errorCode === "provider_circuit_open" &&
          item?.providerCircuit?.state === "open",
      )
    ) {
      return fail("provider_resilience_circuit_incomplete");
    }
    const fallback = cases.get("provider_fallback_before_output");
    if (
      fallback?.providerCallCount?.primary !== 1 ||
      fallback?.providerCallCount?.fallback !== 1 ||
      fallback?.terminalData?.providerFallback?.reason !==
        "provider_stream_error"
    ) {
      return fail("provider_resilience_fallback_incomplete");
    }
    const killSwitch = cases.get("provider_kill_switch_fallback");
    if (
      killSwitch?.providerCallCount?.primary !== 0 ||
      killSwitch?.providerCallCount?.fallback !== 1 ||
      killSwitch?.terminalData?.providerFallback?.reason !== "provider_disabled"
    ) {
      return fail("provider_resilience_kill_switch_incomplete");
    }
    if (JSON.stringify(content).includes("RAW_PROVIDER_RESILIENCE_SENTINEL")) {
      return fail("provider_resilience_raw_sentinel_leaked");
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "rawProviderErrorsReturned",
        "rawProviderPayloadsReturned",
        "rawProviderResponsesReturned",
        "rawRunPromptsReturned",
      ])
    ) {
      return fail("provider_resilience_redaction_missing");
    }
    return pass();
  }

  function validateProviderOutageEvidence(content) {
    const requiredChecks = [
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
    const missingCheck = firstMissingCheck(content, requiredChecks);
    if (missingCheck !== undefined) {
      return fail(`provider_outage_missing_check:${missingCheck}`);
    }
    if (content.status !== "passed") return fail("provider_outage_not_passed");
    if (content.mode !== "live") return fail("provider_outage_not_live");
    if (!["compose", "kubernetes", "target"].includes(content.deployment)) {
      return fail("provider_outage_deployment_invalid");
    }
    if (
      !positiveInteger(content.drill?.providerCount) ||
      !positiveInteger(content.drill?.outageInjectedCount) ||
      !positiveInteger(content.drill?.timeoutObservedCount)
    ) {
      return fail("provider_outage_injection_missing");
    }
    if (
      !positiveInteger(content.runtime?.circuitOpenCount) ||
      !positiveInteger(content.runtime?.fallbackRoutedCount) ||
      !positiveInteger(content.runtime?.killSwitchVerifiedCount)
    ) {
      return fail("provider_outage_runtime_behavior_missing");
    }
    if (
      content.operationalSummary?.checked !== true ||
      !positiveInteger(content.operationalSummary?.degradedProviderCount) ||
      !positiveInteger(content.operationalSummary?.circuitOpenProviderCount) ||
      content.operationalSummary?.fallbackAvailable !== true ||
      !positiveInteger(content.operationalSummary?.alertCodeCount)
    ) {
      return fail("provider_outage_operational_summary_missing");
    }
    if (
      content.alerting?.checked !== true ||
      content.alerting?.status !== "passed" ||
      !positiveInteger(content.alerting?.providerAlertCount)
    ) {
      return fail("provider_outage_alerting_missing");
    }
    if (
      content.recovery?.checked !== true ||
      !positiveInteger(content.recovery?.recoveredProviderCount)
    ) {
      return fail("provider_outage_recovery_missing");
    }
    if (hasFailureCodes(content)) {
      return fail("provider_outage_failure_codes_present");
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "rawProviderPayloadsReturned",
        "rawProviderResponsesReturned",
        "rawProviderErrorsReturned",
        "rawPromptsReturned",
        "rawApiKeysReturned",
        "rawAlertPayloadsReturned",
        "rawEvidencePathsReturned",
        "secretValuesReturned",
      ])
    ) {
      return fail("provider_outage_redaction_missing");
    }
    return pass();
  }

  function validateMigrationDrillEvidence(content) {
    const requiredChecks = [
      "failed_migration_injected",
      "migration_failure_detected",
      "migration_job_failed_closed",
      "app_cutover_blocked",
      "rollback_or_retry_verified",
      "schema_validation_after_recovery",
      "migration_log_redaction",
      "operator_runbook_reviewed",
    ];
    const missingCheck = firstMissingCheck(content, requiredChecks);
    if (missingCheck !== undefined) {
      return fail(`migration_drill_missing_check:${missingCheck}`);
    }
    if (content.status !== "passed") return fail("migration_drill_not_passed");
    if (content.mode !== "live") return fail("migration_drill_not_live");
    if (!["compose", "kubernetes", "target"].includes(content.deployment)) {
      return fail("migration_drill_deployment_invalid");
    }
    if (
      !positiveInteger(content.drill?.attemptedMigrationCount) ||
      !positiveInteger(content.drill?.failedMigrationCount) ||
      content.drill?.failureInjected !== true ||
      content.drill?.cutoverBlocked !== true
    ) {
      return fail("migration_drill_injection_missing");
    }
    if (
      content.job?.migrationJobObserved !== true ||
      content.job?.failedClosed !== true ||
      !positiveInteger(
        (content.job?.retryAttemptCount ?? 0) +
          (content.job?.rollbackAttemptCount ?? 0),
      )
    ) {
      return fail("migration_drill_failure_behavior_missing");
    }
    if (
      content.validation?.rollbackOrRetryVerified !== true ||
      content.validation?.schemaValidationPassed !== true ||
      content.validation?.appReadinessPassed !== true ||
      !positiveInteger(content.validation?.postRecoveryMigrationCount)
    ) {
      return fail("migration_drill_recovery_missing");
    }
    if (
      content.runbook?.reviewed !== true ||
      content.runbook?.recoveryDocumented !== true ||
      !positiveInteger(content.runbook?.reviewerCount)
    ) {
      return fail("migration_drill_runbook_missing");
    }
    if (hasFailureCodes(content)) {
      return fail("migration_drill_failure_codes_present");
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "databaseUrlsReturned",
        "migrationSqlReturned",
        "migrationLogsReturned",
        "rawErrorStacksReturned",
        "rawEvidencePathsReturned",
        "secretValuesReturned",
      ])
    ) {
      return fail("migration_drill_redaction_missing");
    }
    return pass();
  }

  function validateNetworkPartitionEvidence(content) {
    const requiredChecks = [
      "network_partition_injected",
      "dependency_partition_verified",
      "api_fail_closed_or_degraded",
      "worker_backpressure_verified",
      "recovery_after_partition_verified",
      "alerting_readback",
      "network_policy_or_cni_context_recorded",
      "partition_log_redaction",
    ];
    const missingCheck = firstMissingCheck(content, requiredChecks);
    if (missingCheck !== undefined) {
      return fail(`network_partition_missing_check:${missingCheck}`);
    }
    if (content.status !== "passed") {
      return fail("network_partition_not_passed");
    }
    if (content.mode !== "live") return fail("network_partition_not_live");
    if (!["compose", "kubernetes", "target"].includes(content.deployment)) {
      return fail("network_partition_deployment_invalid");
    }
    if (
      content.drill?.partitionInjected !== true ||
      !positiveInteger(content.drill?.partitionedDependencyCount) ||
      !positiveInteger(content.drill?.partitionedServiceCount) ||
      !positiveInteger(content.drill?.partitionDurationSeconds)
    ) {
      return fail("network_partition_injection_missing");
    }
    if (
      content.runtime?.apiDegraded !== true ||
      !positiveInteger(content.runtime?.failClosedCount) ||
      content.runtime?.backpressureObserved !== true ||
      content.runtime?.workerStormPrevented !== true
    ) {
      return fail("network_partition_runtime_behavior_missing");
    }
    if (
      content.recovery?.checked !== true ||
      !positiveInteger(content.recovery?.recoveredDependencyCount) ||
      content.recovery?.postRecoveryReadbackPassed !== true
    ) {
      return fail("network_partition_recovery_missing");
    }
    if (
      content.alerting?.checked !== true ||
      content.alerting?.status !== "passed" ||
      !positiveInteger(content.alerting?.partitionAlertCount)
    ) {
      return fail("network_partition_alerting_missing");
    }
    if (
      content.networkContext?.cniConfirmed !== true ||
      content.networkContext?.networkPolicyApplied !== true ||
      content.networkContext?.namespaceScoped !== true ||
      !positiveInteger(content.networkContext?.egressPolicyCount)
    ) {
      return fail("network_partition_context_missing");
    }
    if (hasFailureCodes(content)) {
      return fail("network_partition_failure_codes_present");
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "rawNetworkEndpointsReturned",
        "rawPodIpsReturned",
        "rawPacketCapturesReturned",
        "rawLogLinesReturned",
        "rawEvidencePathsReturned",
        "secretValuesReturned",
      ])
    ) {
      return fail("network_partition_redaction_missing");
    }
    return pass();
  }

  function validateSecretRotationDrillEvidence(content) {
    const requiredChecks = [
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
    ];
    const missingCheck = firstMissingCheck(content, requiredChecks);
    if (missingCheck !== undefined) {
      return fail(`secret_rotation_drill_missing_check:${missingCheck}`);
    }
    if (content.status !== "passed") {
      return fail("secret_rotation_drill_not_passed");
    }
    if (content.mode !== "live") return fail("secret_rotation_drill_not_live");
    if (!["compose", "kubernetes", "target"].includes(content.deployment)) {
      return fail("secret_rotation_drill_deployment_invalid");
    }
    if (
      content.stagedCutover?.sessionSecretStaged !== true ||
      content.stagedCutover?.webhookSigningKeyCutover !== true ||
      content.stagedCutover?.apiOrServiceKeyContinuityVerified !== true
    ) {
      return fail("secret_rotation_drill_cutover_missing");
    }
    if (
      content.rewrap?.localMfaPreviewPassed !== true ||
      !positiveInteger(content.rewrap?.localMfaRewrappedCount) ||
      content.rewrap?.managedSecretsPreviewPassed !== true ||
      !positiveInteger(content.rewrap?.managedSecretsRewrappedCount) ||
      content.rewrap?.failureCount !== 0
    ) {
      return fail("secret_rotation_drill_rewrap_missing");
    }
    if (
      !positiveInteger(content.acceptance?.oldSecretRetiredOrRejectedCount) ||
      !positiveInteger(content.acceptance?.newSecretAcceptedCount)
    ) {
      return fail("secret_rotation_drill_acceptance_missing");
    }
    if (
      content.dependencies?.databaseCredentialsReviewed !== true ||
      content.dependencies?.objectStoreCredentialsReviewed !== true ||
      !positiveInteger(content.dependencies?.providerCredentialCount) ||
      !positiveInteger(content.dependencies?.connectorCredentialCount)
    ) {
      return fail("secret_rotation_drill_dependency_review_missing");
    }
    if (
      content.readiness?.checked !== true ||
      content.readiness?.readinessPassed !== true ||
      content.readiness?.postRotationLoginPassed !== true ||
      content.readiness?.postRotationWebhookPassed !== true
    ) {
      return fail("secret_rotation_drill_readiness_missing");
    }
    if (
      content.alerting?.checked !== true ||
      content.alerting?.status !== "passed" ||
      !positiveInteger(content.alerting?.rotationAlertCount)
    ) {
      return fail("secret_rotation_drill_alerting_missing");
    }
    if (hasFailureCodes(content)) {
      return fail("secret_rotation_drill_failure_codes_present");
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "keyMaterialReturned",
        "rawApiKeysReturned",
        "rawEvidencePathsReturned",
        "rawLogLinesReturned",
        "rawSecretRefsReturned",
        "rawSecretValuesReturned",
        "rawTokensReturned",
        "webhookSigningSecretsReturned",
      ])
    ) {
      return fail("secret_rotation_drill_redaction_missing");
    }
    return pass();
  }

  function validateJobLagSmokeEvidence(content) {
    if (content.endpoint !== "/api/v1/jobs/operational-summary") {
      return fail("job_lag_wrong_endpoint");
    }
    const requiredChecks = [
      "queued_lag_alert",
      "running_stale_alert",
      "recent_failed_job_alert",
      "dead_letter_alert",
      "payload_redaction",
    ];
    const checks = new Set(Array.isArray(content.checks) ? content.checks : []);
    for (const check of requiredChecks) {
      if (!checks.has(check)) return fail(`job_lag_missing_check:${check}`);
    }
    if (content.summary?.status !== "critical") {
      return fail("job_lag_summary_not_critical");
    }
    const totals = content.summary?.totals ?? {};
    for (const [field, minimum] of [
      ["queued", 1],
      ["running", 1],
      ["failed", 1],
      ["deadLettered", 1],
      ["recentFailed", 1],
    ]) {
      if (!Number.isInteger(totals[field]) || totals[field] < minimum) {
        return fail(`job_lag_total_missing:${field}`);
      }
    }
    const alertMetrics = new Set(
      Array.isArray(content.summary?.alerts)
        ? content.summary.alerts.map((alert) => alert.metric)
        : [],
    );
    for (const metric of [
      "queued_lag_seconds",
      "running_stale_seconds",
      "recent_failed_jobs",
      "dead_letter_jobs",
    ]) {
      if (!alertMetrics.has(metric)) {
        return fail(`job_lag_missing_alert_metric:${metric}`);
      }
    }
    if (JSON.stringify(content).includes("RAW_JOB_LAG_SENTINEL")) {
      return fail("job_lag_raw_payload_leaked");
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "rawQueuedPayloadReturned",
        "rawRunningPayloadReturned",
        "rawFailedPayloadReturned",
        "rawDeadLetterPayloadReturned",
      ])
    ) {
      return fail("job_lag_redaction_missing");
    }
    return pass();
  }

  function validateOperationalMonitoringEvidence(content) {
    const requiredChecks = [
      "provider_operational_metrics",
      "background_job_operational_metrics",
      "prometheus_text_redaction",
      "prometheus_rules_parse",
      "prometheus_rules_metric_references",
      "kubernetes_exporter_example_contract",
    ];
    const checks = new Set(Array.isArray(content.checks) ? content.checks : []);
    for (const check of requiredChecks) {
      if (!checks.has(check)) {
        return fail(`operational_monitoring_missing_check:${check}`);
      }
    }
    if (!Number.isInteger(content.metricCount) || content.metricCount < 20) {
      return fail("operational_monitoring_metric_count_low");
    }
    const metricNames = new Set(
      Array.isArray(content.metricNames) ? content.metricNames : [],
    );
    for (const metric of [
      "romeo_background_job_alert",
      "romeo_background_job_dead_letter_jobs",
      "romeo_background_job_oldest_queued_seconds",
      "romeo_operational_exporter_up",
      "romeo_provider_alert",
      "romeo_provider_circuit_state",
      "romeo_provider_fallback_available",
      "romeo_provider_kill_switch_active",
    ]) {
      if (!metricNames.has(metric)) {
        return fail(`operational_monitoring_missing_metric:${metric}`);
      }
    }
    const alertNames = new Set(
      Array.isArray(content.alertNames) ? content.alertNames : [],
    );
    for (const alert of [
      "RomeoProviderCircuitOpen",
      "RomeoBackgroundJobQueuedLag",
      "RomeoBackgroundJobDeadLetters",
      "RomeoPostgresBackupJobFailed",
    ]) {
      if (!alertNames.has(alert)) {
        return fail(`operational_monitoring_missing_alert:${alert}`);
      }
    }
    for (const metric of content.referencedMetricNames ?? []) {
      if (!metricNames.has(metric)) {
        return fail(`operational_monitoring_unknown_metric_ref:${metric}`);
      }
    }
    if (JSON.stringify(content).includes("RAW_MONITORING_SENTINEL")) {
      return fail("operational_monitoring_raw_sentinel_leaked");
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "rawProviderPayloadReturned",
        "rawJobPayloadReturned",
        "rawProviderUrlsReturned",
        "prometheusTextReturned",
        "environmentReturned",
      ])
    ) {
      return fail("operational_monitoring_redaction_missing");
    }
    return pass();
  }

  function validateBackupUploadFailureEvidence(content) {
    const requiredChecks = [
      "upload_http_failure_exits_nonzero",
      "upload_timeout_exits_nonzero",
      "failed_upload_does_not_write_manifest",
      "upload_failure_output_redacts_presigned_secret",
    ];
    const checks = new Set(Array.isArray(content.checks) ? content.checks : []);
    for (const check of requiredChecks) {
      if (!checks.has(check))
        return fail(`backup_upload_missing_check:${check}`);
    }
    if (!Number.isInteger(content.requestCount) || content.requestCount < 2) {
      return fail("backup_upload_request_count_low");
    }
    const cases = new Map(
      Array.isArray(content.cases)
        ? content.cases
            .filter((item) => typeof item?.name === "string")
            .map((item) => [item.name, item])
        : [],
    );
    for (const name of ["http_503", "upload_timeout"]) {
      const item = cases.get(name);
      if (item === undefined) return fail(`backup_upload_missing_case:${name}`);
      if (item.exitStatus === 0) {
        return fail(`backup_upload_case_succeeded:${name}`);
      }
      if (item.manifestWritten !== false) {
        return fail(`backup_upload_manifest_written:${name}`);
      }
      if (item.requestReceived !== true) {
        return fail(`backup_upload_request_missing:${name}`);
      }
      const redactedUrl = item.redactedUploadUrl;
      if (
        typeof redactedUrl !== "string" ||
        !redactedUrl.includes("redacted=true") ||
        redactedUrl.includes("token=") ||
        redactedUrl.includes("postgres-backup-upload-secret-sentinel")
      ) {
        return fail(`backup_upload_redaction_missing:${name}`);
      }
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "rawPresignedUploadUrlReturned",
        "rawUploadRequestBodyReturned",
        "rawUploadResponseBodyReturned",
        "commandOutputReturned",
        "databaseUrlReturned",
        "environmentReturned",
      ])
    ) {
      return fail("backup_upload_redaction_missing");
    }
    return pass();
  }

  function validatePostgresQueryPlanReviewEvidence(content) {
    if (content.status !== "passed") {
      return fail("postgres_query_plan_not_passed");
    }
    if (content.target?.representativeVolume !== true) {
      return fail("postgres_query_plan_not_representative");
    }
    if (!["small", "enterprise"].includes(content.target?.deploymentTier)) {
      return fail("postgres_query_plan_target_tier_invalid");
    }
    if (
      !["cloudnativepg", "external-hosted-postgres"].includes(
        content.target?.postgresMode,
      )
    ) {
      return fail("postgres_query_plan_mode_invalid");
    }
    if (
      !Number.isInteger(content.coverage?.checkCount) ||
      content.coverage.checkCount < 20 ||
      !Array.isArray(content.coverage?.categories) ||
      content.coverage.categories.length < 4
    ) {
      return fail("postgres_query_plan_coverage_incomplete");
    }
    if (
      Array.isArray(content.missingExpectedIndexes) &&
      content.missingExpectedIndexes.length > 0
    ) {
      return fail("postgres_query_plan_missing_expected_indexes");
    }
    const checks = Array.isArray(content.checks) ? content.checks : [];
    if (checks.length < content.coverage.checkCount) {
      return fail("postgres_query_plan_checks_incomplete");
    }
    if (checks.some((check) => check?.status !== "passed")) {
      return fail("postgres_query_plan_failed_check_present");
    }
    if (
      !redactionFlagsFalse(content.validation, [
        "rawSqlPersisted",
        "rawRowContentPersisted",
      ])
    ) {
      return fail("postgres_query_plan_redaction_missing");
    }
    return pass();
  }

  function validatePostgresSlowQueryTelemetryEvidence(content) {
    if (content.status !== "passed") {
      return fail("postgres_slow_query_telemetry_not_passed");
    }
    if (hasFailureCodes(content)) {
      return fail("postgres_slow_query_failures_present");
    }
    if (
      !positiveInteger(content.summary?.windowMinutes) ||
      !positiveInteger(content.summary?.fingerprintCount) ||
      !positiveInteger(content.summary?.totalCalls)
    ) {
      return fail("postgres_slow_query_not_representative");
    }
    if (content.summary?.slowQueryCount !== 0) {
      return fail("postgres_slow_query_threshold_exceeded");
    }
    if (content.summary?.tempFileStatementCount !== 0) {
      return fail("postgres_slow_query_temp_files_present");
    }
    if (
      !positiveInteger(content.thresholds?.windowMinutes) ||
      !positiveInteger(content.thresholds?.slowThresholdMs)
    ) {
      return fail("postgres_slow_query_thresholds_missing");
    }
    if (
      !redactionFlagsFalse(content.validation, [
        "rawSqlPersisted",
        "queryTextPersisted",
        "queryParameterValuesPersisted",
        "lockStatementsPersisted",
        "rowDataPersisted",
        "secretValuesPersisted",
      ])
    ) {
      return fail("postgres_slow_query_redaction_missing");
    }
    return pass();
  }

  function validatePostgresLockTelemetryEvidence(content) {
    if (content.status !== "passed") {
      return fail("postgres_lock_telemetry_not_passed");
    }
    if (hasFailureCodes(content)) {
      return fail("postgres_lock_telemetry_failures_present");
    }
    if (!positiveInteger(content.summary?.windowMinutes)) {
      return fail("postgres_lock_telemetry_window_missing");
    }
    if (
      !nonNegativeInteger(content.summary?.blockedSessionMax) ||
      !nonNegativeInteger(content.summary?.deadlockCount)
    ) {
      return fail("postgres_lock_telemetry_counts_invalid");
    }
    if (
      !positiveInteger(content.thresholds?.windowMinutes) ||
      !nonNegativeInteger(content.thresholds?.maxBlockedSessions) ||
      !nonNegativeInteger(content.thresholds?.maxDeadlocks)
    ) {
      return fail("postgres_lock_telemetry_thresholds_missing");
    }
    if (
      content.summary.blockedSessionMax >
        content.thresholds.maxBlockedSessions ||
      content.summary.deadlockCount > content.thresholds.maxDeadlocks
    ) {
      return fail("postgres_lock_telemetry_threshold_exceeded");
    }
    if (
      !redactionFlagsFalse(content.validation, [
        "rawSqlPersisted",
        "queryTextPersisted",
        "queryParameterValuesPersisted",
        "lockStatementsPersisted",
        "rowDataPersisted",
        "secretValuesPersisted",
      ])
    ) {
      return fail("postgres_lock_telemetry_redaction_missing");
    }
    return pass();
  }

  function validatePostgresArchivalPartitioningDecisionEvidence(content) {
    if (content.status !== "accepted") {
      return fail("postgres_archival_decision_not_accepted");
    }
    if (hasFailureCodes(content)) {
      return fail("postgres_archival_decision_failures_present");
    }
    if (
      ![
        "no_runtime_partitioning_enabled",
        "partitioning_required",
        "archival_required",
        "partitioning_and_archival_required",
      ].includes(content.decision)
    ) {
      return fail("postgres_archival_decision_invalid");
    }
    if (typeof content.migrationRequired !== "boolean") {
      return fail("postgres_archival_migration_required_missing");
    }
    if (
      !Number.isInteger(content.summary?.tableCount) ||
      content.summary.tableCount < 10
    ) {
      return fail("postgres_archival_table_review_incomplete");
    }
    if (
      !positiveInteger(content.thresholds?.maxTableBytes) ||
      !positiveInteger(content.thresholds?.maxEstimatedRows) ||
      !nonNegativeInteger(content.thresholds?.maxDeadTupleRatioPercent)
    ) {
      return fail("postgres_archival_thresholds_missing");
    }
    if (
      !redactionFlagsFalse(content.validation, [
        "rawRowContentPersisted",
        "rawSqlPersisted",
        "rowSamplesPersisted",
        "migrationGenerated",
      ])
    ) {
      return fail("postgres_archival_redaction_missing");
    }
    if (content.validation?.tableNamesOnly !== true) {
      return fail("postgres_archival_table_names_only_missing");
    }
    return pass();
  }

  function validateTargetQualityEvidence(content) {
    if (content.mode !== "live") return fail("target_quality_not_live");
    const freshness = validateFreshLiveGeneratedAt(content, "target_quality");
    if (freshness !== undefined) return freshness;
    if (content.target?.deployment !== "target-api") {
      return fail("target_quality_wrong_target");
    }
    if (
      typeof content.target?.origin !== "string" ||
      content.target.origin.length === 0
    ) {
      return fail("target_quality_missing_origin");
    }
    const requiredChecks = [
      "health_read",
      "admin_analytics_summary_read",
      "admin_analytics_csv_read",
      "analytics_redaction_flags",
      "eval_release_candidate_readback",
      "eval_redaction_flags",
      "eval_gate_passed",
      "retrieval_replay_readback",
      "replay_redaction_flags",
      "forbidden_sentinels_absent",
    ];
    const checks = new Set(Array.isArray(content.checks) ? content.checks : []);
    for (const check of requiredChecks) {
      if (!checks.has(check)) {
        return fail(`target_quality_missing_check:${check}`);
      }
    }
    if (content.health?.status !== "ok") {
      return fail("target_quality_health_not_ok");
    }
    if (content.analytics?.status !== "passed") {
      return fail("target_quality_analytics_missing");
    }
    if (
      content.analytics?.csv?.returned !== false ||
      typeof content.analytics?.csv?.sha256 !== "string" ||
      content.analytics.csv.sha256.length === 0
    ) {
      return fail("target_quality_csv_hash_missing");
    }
    if (
      !redactionChecksPassed(content.analytics?.redaction, [
        "rawEvalInputsReturned",
        "rawEvalOutputsReturned",
        "rawJobPayloadsReturned",
        "rawProviderConfigReturned",
        "rawToolInputsReturned",
        "rawUsageMetadataReturned",
      ])
    ) {
      return fail("target_quality_analytics_redaction_missing");
    }
    if (!Array.isArray(content.evals) || content.evals.length < 1) {
      return fail("target_quality_missing_eval_evidence");
    }
    for (const evalEvidence of content.evals) {
      if (
        Object.hasOwn(evalEvidence ?? {}, "agentId") ||
        Object.hasOwn(evalEvidence ?? {}, "workspaceId")
      ) {
        return fail("target_quality_eval_subject_raw_ids_returned");
      }
      const subject = evalEvidence?.subject ?? {};
      if (
        subject.agentIdPresent !== true ||
        subject.workspaceIdPresent !== true ||
        !validSha256(subject.agentIdHash) ||
        !validSha256(subject.workspaceIdHash)
      ) {
        return fail("target_quality_eval_subject_hash_missing");
      }
      if (evalEvidence?.status !== "passed") {
        return fail("target_quality_eval_not_passed");
      }
      if (evalEvidence?.gateStatus !== "passed") {
        return fail("target_quality_eval_gate_not_passed");
      }
      if (evalEvidence?.publishBlocked === true) {
        return fail("target_quality_eval_publish_blocked");
      }
      if (
        !redactionChecksPassed(evalEvidence?.redaction, [
          "rawEvalInputsReturned",
          "rawEvalOutputsReturned",
          "rawHumanRatingCommentsReturned",
          "rawRubricTermsReturned",
        ])
      ) {
        return fail("target_quality_eval_redaction_missing");
      }
    }
    if (
      content.replay?.checked !== true ||
      content.replay?.status !== "passed"
    ) {
      return fail("target_quality_replay_missing");
    }
    const vectorComparisonRequired =
      requireTargetQualityVectorComparison ||
      content.replay?.vectorComparison?.required === true;
    if (vectorComparisonRequired) {
      if (content.replay?.kind !== "compare") {
        return fail("target_quality_vector_comparison_requires_compare");
      }
      if (!checks.has("retrieval_vector_route_comparison")) {
        return fail(
          "target_quality_missing_check:retrieval_vector_route_comparison",
        );
      }
      const comparison = content.replay?.vectorComparison;
      if (comparison?.required !== true) {
        return fail("target_quality_vector_comparison_missing");
      }
      if (comparison.status !== "passed") {
        return fail("target_quality_vector_comparison_not_passed");
      }
      if (
        comparison.expectedBaselineRouteMode !== "pgvector" ||
        comparison.expectedCandidateRouteMode !== "external_vector"
      ) {
        return fail("target_quality_vector_comparison_route_invalid");
      }
      if (
        !positiveInteger(comparison.baselineMatchedCount) ||
        !positiveInteger(comparison.candidateMatchedCount)
      ) {
        return fail("target_quality_vector_comparison_incomplete");
      }
      if (
        !positiveInteger(comparison.baselineTotalRouteCount) ||
        !positiveInteger(comparison.candidateTotalRouteCount)
      ) {
        return fail("target_quality_vector_comparison_counts_missing");
      }
    }
    if (
      !redactionChecksPassed(content.replay?.redaction, [
        "rawQueriesReturned",
        "rawChunkTextReturned",
        "rawExpectedChunkIdsReturned",
        "rawHitIdsReturned",
        "vectorValuesReturned",
      ])
    ) {
      return fail("target_quality_replay_redaction_missing");
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "rawAnalyticsCsvReturned",
        "rawEvalInputsReturned",
        "rawEvalOutputsReturned",
        "rawEvalAgentIdsReturned",
        "rawEvalWorkspaceIdsReturned",
        "rawReplayQueriesReturned",
        "rawReplayHitIdsReturned",
        "rawSecretsReturned",
      ])
    ) {
      return fail("target_quality_top_level_redaction_missing");
    }
    return pass();
  }

  function validateKubernetesTieredRagSmokeEvidence(content) {
    if (content.mode !== "live") return fail("tiered_rag_not_live");
    const freshness = validateFreshLiveGeneratedAt(content, "tiered_rag");
    if (freshness !== undefined) return freshness;
    if (content.target?.deployment !== "kubernetes") {
      return fail("tiered_rag_not_kubernetes");
    }
    for (const field of [
      "namespace",
      "releaseName",
      "serviceName",
      "deploymentName",
    ]) {
      if (typeof content.target?.[field] !== "string") {
        return fail(`tiered_rag_missing_target_${field}`);
      }
    }
    const requiredChecks = [
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
    ];
    const checks = new Set(Array.isArray(content.checks) ? content.checks : []);
    for (const check of requiredChecks) {
      if (!checks.has(check)) return fail(`tiered_rag_missing_check:${check}`);
    }
    if (content.authorizedTierCount !== 4) {
      return fail("tiered_rag_authorized_tier_count_invalid");
    }
    if (content.skippedDeniedCount !== 1) {
      return fail("tiered_rag_denied_skip_count_invalid");
    }
    if (!["pgvector", "qdrant"].includes(content.vectorPosture?.driver)) {
      return fail("tiered_rag_vector_driver_missing");
    }
    if (
      ![
        "dedicated_vector_store_per_org",
        "external_collection_per_org",
        "external_namespace_per_org",
        "pgvector_partitioned_by_org",
        "shared_row_scope",
      ].includes(content.vectorPosture?.isolationMode)
    ) {
      return fail("tiered_rag_vector_isolation_mode_missing");
    }
    if (
      !["disabled", "qdrant"].includes(
        content.vectorPosture?.externalVectorStoreDriver,
      )
    ) {
      return fail("tiered_rag_external_vector_driver_missing");
    }
    if (!validVectorIsolationPolicy(content.vectorPosture?.namespacePolicy)) {
      return fail("tiered_rag_namespace_policy_invalid");
    }
    if (
      !validVectorIsolationPolicy(content.vectorPosture?.partitioningPolicy)
    ) {
      return fail("tiered_rag_partitioning_policy_invalid");
    }
    if (
      content.vectorPosture?.planEntryCount !== 4 ||
      content.vectorPosture?.vectorScopeDriverCounts?.[
        content.vectorPosture.driver
      ] !== 4
    ) {
      return fail("tiered_rag_vector_scope_counts_invalid");
    }
    if (
      content.vectorPosture.driver === "qdrant" &&
      (content.vectorPosture.externalVectorStoreDriver !== "qdrant" ||
        content.vectorPosture.externalVectorStoreRoutingActive !== true ||
        content.vectorPosture.namespaceConfigured !== true ||
        !validQdrantNamespacePolicy(content.vectorPosture.namespacePolicy))
    ) {
      return fail("tiered_rag_qdrant_vector_posture_incomplete");
    }
    if (content.policyRestore?.status !== "restored") {
      return fail("tiered_rag_policy_not_restored");
    }
    if (content.logRedaction?.status !== "passed") {
      return fail("tiered_rag_log_redaction_missing");
    }
    if ((content.logRedaction.rawCorpusSentinelsChecked ?? 0) < 5) {
      return fail("tiered_rag_log_redaction_missing_corpus_sentinels");
    }
    if ((content.logRedaction.apiKeysChecked ?? 0) < 2) {
      return fail("tiered_rag_log_redaction_missing_api_keys");
    }
    return pass();
  }

  function validateQdrantDrConsistencyEvidence(content, expectedPhase) {
    const phaseKey = expectedPhase.replaceAll("-", "_");
    if (content.mode !== "live") return fail(`qdrant_dr_not_live:${phaseKey}`);
    const freshness = validateFreshLiveGeneratedAt(
      content,
      `qdrant_dr:${phaseKey}`,
    );
    if (freshness !== undefined) return freshness;
    if (content.phase !== expectedPhase) {
      return fail(`qdrant_dr_wrong_phase:${phaseKey}`);
    }
    if (content.target?.driver !== "qdrant") {
      return fail(`qdrant_dr_wrong_driver:${phaseKey}`);
    }
    if (
      content.target?.endpointConfigured !== true ||
      content.target?.endpointValid !== true ||
      content.target?.collectionConfigured !== true ||
      content.target?.credentialConfigured !== true
    ) {
      return fail(`qdrant_dr_target_incomplete:${phaseKey}`);
    }
    if (content.policy?.namespacePolicy === "none") {
      return fail(`qdrant_dr_namespace_policy_none:${phaseKey}`);
    }
    if (typeof content.seed?.runSecretSha256 !== "string") {
      return fail(`qdrant_dr_missing_run_secret_hash:${phaseKey}`);
    }
    if (
      expectedPhase === "verify-restore" &&
      typeof content.seed?.sourceEvidenceSha256 !== "string"
    ) {
      return fail("qdrant_dr_missing_source_evidence_hash");
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "apiKeyReturned",
        "collectionReturned",
        "endpointReturned",
        "namespaceValuesReturned",
        "partitionValuesReturned",
        "payloadValuesReturned",
        "pointIdsReturned",
        "runSecretReturned",
        "sourceEvidenceBodyReturned",
        "sourceEvidencePathReturned",
        "vectorValuesReturned",
      ])
    ) {
      return fail(`qdrant_dr_redaction_missing:${phaseKey}`);
    }

    const checks = new Set(Array.isArray(content.checks) ? content.checks : []);
    const requiredChecksByPhase = {
      "prepare-source": [
        "collection_health_readable",
        "source_synthetic_points_upserted",
        "source_scoped_readback_succeeded",
        "source_foreign_org_trap_excluded",
        "query_omitted_vectors",
        "evidence_redaction_self_check_passed",
      ],
      "verify-restore": [
        "source_evidence_matches_run_secret",
        "collection_health_readable",
        "restored_scoped_query_returned_expected_point",
        "restored_foreign_org_trap_excluded",
        "query_omitted_vectors",
        "restored_all_smoke_point_delete_issued",
        "restored_all_smoke_point_delete_verified",
        "evidence_redaction_self_check_passed",
      ],
      "cleanup-source": [
        "collection_health_readable",
        "source_all_smoke_point_delete_issued",
        "source_all_smoke_point_delete_verified",
        "evidence_redaction_self_check_passed",
      ],
    };
    for (const check of requiredChecksByPhase[expectedPhase] ?? []) {
      if (!checks.has(check)) {
        return fail(`qdrant_dr_missing_check:${phaseKey}:${check}`);
      }
    }

    if (expectedPhase === "prepare-source") {
      if (
        content.prepare?.preparedPointCount !== 2 ||
        content.prepare?.scopedReadbackReturnedExpectedPoint !== true ||
        content.prepare?.foreignOrgTrapExcluded !== true ||
        content.prepare?.vectorsReturned !== false
      ) {
        return fail("qdrant_dr_prepare_readback_incomplete");
      }
    }
    if (expectedPhase === "verify-restore") {
      if (
        content.restore?.sourceEvidenceMatched !== true ||
        content.restore?.scopedReadbackReturnedExpectedPoint !== true ||
        content.restore?.foreignOrgTrapExcluded !== true ||
        content.restore?.vectorsReturned !== false
      ) {
        return fail("qdrant_dr_restore_readback_incomplete");
      }
      if (
        content.restore?.allSmokePointDeleteIssued !== true ||
        content.restore?.postDeleteResultCount !== 0 ||
        content.restore?.expectedHitRemoved !== true
      ) {
        return fail("qdrant_dr_restore_cleanup_incomplete");
      }
    }
    if (expectedPhase === "cleanup-source") {
      if (
        content.cleanup?.allSmokePointDeleteIssued !== true ||
        content.cleanup?.postDeleteResultCount !== 0 ||
        content.cleanup?.expectedHitRemoved !== true
      ) {
        return fail("qdrant_dr_source_cleanup_incomplete");
      }
    }
    return pass();
  }

  function validateQdrantLiveEvidence(content) {
    if (content.status !== "passed") return fail("qdrant_live_not_passed");
    if (content.mode !== "live") return fail("qdrant_live_not_live");
    const freshness = validateFreshLiveGeneratedAt(content, "qdrant_live");
    if (freshness !== undefined) return freshness;
    if (content.target?.driver !== "qdrant") {
      return fail("qdrant_live_wrong_driver");
    }
    if (
      content.target?.endpointConfigured !== true ||
      content.target?.endpointValid !== true ||
      content.target?.collectionConfigured !== true ||
      content.target?.credentialConfigured !== true ||
      !positiveInteger(content.target?.dimensions) ||
      !positiveInteger(content.target?.timeoutMs)
    ) {
      return fail("qdrant_live_target_incomplete");
    }
    if (!validQdrantNamespacePolicy(content.target.namespacePolicy)) {
      return fail("qdrant_live_namespace_policy_invalid");
    }
    if (!validQdrantPartitioningPolicy(content.target.partitioningPolicy)) {
      return fail("qdrant_live_partitioning_policy_invalid");
    }
    if (
      typeof content.collection?.status !== "string" &&
      !nonNegativeInteger(content.collection?.pointsCount) &&
      !nonNegativeInteger(content.collection?.vectorsCount)
    ) {
      return fail("qdrant_live_collection_health_missing");
    }
    if (
      content.mutation?.confirmed !== true ||
      content.mutation?.cleanupAttempted !== true ||
      !positiveInteger(content.mutation?.insertedPointCount)
    ) {
      return fail("qdrant_live_mutation_incomplete");
    }
    if (
      content.isolation?.expectedHitReturned !== true ||
      content.isolation?.namespaceTrapExcluded !== true ||
      content.isolation?.partitionTrapExcluded !== true ||
      content.isolation?.foreignOrgTrapExcluded !== true ||
      content.isolation?.vectorsReturned !== false
    ) {
      return fail("qdrant_live_isolation_incomplete");
    }
    const filter = content.isolation?.filter ?? {};
    if (
      filter.orgFilterApplied !== true ||
      filter.workspaceFilterApplied !== true ||
      filter.knowledgeBaseFilterApplied !== true ||
      filter.sourceFilterApplied !== true ||
      filter.providerModelDimensionFilterApplied !== true ||
      filter.namespaceFilterApplied !== true ||
      (content.target.partitioningPolicy !== "none" &&
        filter.partitionFilterApplied !== true)
    ) {
      return fail("qdrant_live_filter_incomplete");
    }
    if (
      content.deletion?.scopedDeleteIssued !== true ||
      content.deletion?.postDeleteResultCount !== 0 ||
      content.deletion?.expectedHitRemoved !== true ||
      content.deletion?.cleanupByPointIdAttempted !== true
    ) {
      return fail("qdrant_live_delete_incomplete");
    }
    const requiredChecks = [
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
    ];
    const missingCheck = firstMissingCheck(content, requiredChecks);
    if (missingCheck !== undefined) {
      return fail(`qdrant_live_missing_check:${missingCheck}`);
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "apiKeyReturned",
        "collectionReturned",
        "endpointReturned",
        "evidenceFileBodyReturned",
        "namespaceValuesReturned",
        "partitionValuesReturned",
        "payloadValuesReturned",
        "pointIdsReturned",
        "rawEvidencePathReturned",
        "vectorValuesReturned",
      ])
    ) {
      return fail("qdrant_live_redaction_missing");
    }
    return pass();
  }

  function redactionChecksPassed(redaction, fields) {
    if (redaction === undefined || redaction === null) return false;
    return fields.every((field) => redaction[field] === true);
  }

  function redactionFlagsFalse(redaction, fields) {
    return fields.every((field) => redaction?.[field] === false);
  }

  function validFileSummary(value) {
    return (
      typeof value?.path === "string" &&
      Number.isInteger(value.bytes) &&
      value.bytes > 0 &&
      typeof value.sha256 === "string" &&
      /^[a-f0-9]{64}$/u.test(value.sha256)
    );
  }

  function positiveInteger(value) {
    return Number.isInteger(value) && value > 0;
  }

  function validSha256(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
  }

  function nonNegativeInteger(value) {
    return Number.isInteger(value) && value >= 0;
  }

  function validQdrantNamespacePolicy(value) {
    return (
      value === "knowledge_base" || value === "org" || value === "workspace"
    );
  }

  function validQdrantPartitioningPolicy(value) {
    return validVectorIsolationPolicy(value);
  }

  function validVectorIsolationPolicy(value) {
    return (
      value === "knowledge_base" ||
      value === "none" ||
      value === "org" ||
      value === "workspace"
    );
  }

  function firstMissingCheck(content, requiredChecks) {
    const checks = new Set(Array.isArray(content.checks) ? content.checks : []);
    return requiredChecks.find((check) => !checks.has(check));
  }

  function hasFailureCodes(content) {
    return Array.isArray(content.failures) && content.failures.length > 0;
  }

  function validTimestamp(value) {
    return typeof value === "string" && !Number.isNaN(Date.parse(value));
  }

  function validateFreshLiveGeneratedAt(content, prefix) {
    if (!validTimestamp(content.generatedAt)) {
      return fail(`${prefix}_generated_at_invalid`);
    }
    const checklistMs = Date.parse(generatedAt);
    const evidenceMs = Date.parse(content.generatedAt);
    if (!Number.isFinite(checklistMs) || !Number.isFinite(evidenceMs)) {
      return fail(`${prefix}_generated_at_invalid`);
    }
    const allowedClockSkewMs = 5 * 60 * 1000;
    const maxAgeMs = 14 * 24 * 60 * 60 * 1000;
    if (evidenceMs - checklistMs > allowedClockSkewMs) {
      return fail(`${prefix}_generated_at_future`);
    }
    if (checklistMs - evidenceMs > maxAgeMs) {
      return fail(`${prefix}_evidence_stale`);
    }
    return undefined;
  }

  function validateLiveAlertFiringEvidence(content) {
    if (content.mode !== "live") return fail("alert_firing_not_live");
    const freshness = validateFreshLiveGeneratedAt(content, "alert_firing");
    if (freshness !== undefined) return freshness;
    if (content.prometheus?.status !== "passed") {
      return fail("prometheus_alert_readback_missing");
    }
    const required = Array.isArray(content.requiredAlerts)
      ? content.requiredAlerts
      : [];
    const categories = new Set(required.map((alert) => alert.category));
    for (const category of ["provider", "queue", "backup"]) {
      if (!categories.has(category)) {
        return fail(`missing_${category}_alert_category`);
      }
    }
    const firing = new Set(
      (content.prometheus.requiredAlertsFiring ?? []).map(
        (alert) => alert.name,
      ),
    );
    for (const alert of required) {
      if (!firing.has(alert.name)) {
        return fail(`required_alert_not_firing:${alert.name}`);
      }
    }
    if (
      content.alertmanager?.checked === true &&
      content.alertmanager.status !== "passed"
    ) {
      return fail("alertmanager_readback_failed");
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "bearerTokensReturned",
        "rawPrometheusResponseReturned",
        "rawAlertmanagerResponseReturned",
        "rawPrometheusUrlReturned",
        "rawAlertmanagerUrlReturned",
        "rawAlertPayloadsReturned",
      ])
    ) {
      return fail("alert_firing_redaction_missing");
    }
    return pass();
  }

  function validateLiveEdgeEnforcementEvidence(content) {
    if (content.mode !== "live") return fail("edge_enforcement_not_live");
    const freshness = validateFreshLiveGeneratedAt(content, "edge_enforcement");
    if (freshness !== undefined) return freshness;
    if (content.target?.deployment !== "edge") {
      return fail("edge_enforcement_wrong_target");
    }
    const checks = new Set(Array.isArray(content.checks) ? content.checks : []);
    for (const check of [
      "security_headers_present",
      "waf_or_gateway_probe_blocked",
      "oversized_request_rejected",
      "public_rate_limit_enforced",
      "raw_probe_payload_not_retained",
    ]) {
      if (!checks.has(check))
        return fail(`edge_enforcement_missing_check:${check}`);
    }
    if (content.securityHeaders?.status !== "passed") {
      return fail("edge_security_headers_missing");
    }
    const matched = new Set(content.securityHeaders?.matched ?? []);
    for (const header of [
      "x-content-type-options",
      "x-frame-options",
      "referrer-policy",
      "cross-origin-opener-policy",
      "permissions-policy",
    ]) {
      if (!matched.has(header))
        return fail(`edge_header_not_matched:${header}`);
    }
    if (content.waf?.status !== "passed") return fail("edge_waf_not_passed");
    if (![403, 406, 429].includes(content.waf?.httpStatus)) {
      return fail("edge_waf_unexpected_status");
    }
    if (content.requestBodyLimit?.status !== "passed") {
      return fail("edge_body_limit_not_passed");
    }
    if (![413, 429].includes(content.requestBodyLimit?.httpStatus)) {
      return fail("edge_body_limit_unexpected_status");
    }
    if (content.rateLimit?.status !== "passed") {
      return fail("edge_rate_limit_not_passed");
    }
    if (
      content.rateLimit?.expectedStatus !== content.rateLimit?.statuses?.at(-1)
    ) {
      return fail("edge_rate_limit_expected_status_missing");
    }
    if (
      !redactionFlagsFalse(content.redaction, [
        "rawApiKeyReturned",
        "rawHeaderValuesReturned",
        "rawProbePayloadReturned",
        "rawQueryValuesReturned",
        "rawRequestBodiesReturned",
        "rawResponseBodiesReturned",
      ])
    ) {
      return fail("edge_redaction_missing");
    }
    if (content.securityHeaders.headerValuesReturned !== false) {
      return fail("edge_redaction_missing_security_header_values");
    }
    if (content.waf.responseBodyReturned !== false) {
      return fail("edge_redaction_missing_waf_response_body");
    }
    if (content.requestBodyLimit.requestBodyReturned !== false) {
      return fail("edge_redaction_missing_body_limit_request_body");
    }
    if (content.requestBodyLimit.responseBodyReturned !== false) {
      return fail("edge_redaction_missing_body_limit_response_body");
    }
    if (content.rateLimit.responseBodyReturned !== false) {
      return fail("edge_redaction_missing_rate_limit_response_body");
    }
    return pass();
  }
}
