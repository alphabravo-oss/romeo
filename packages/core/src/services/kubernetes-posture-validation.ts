import type {
  KubernetesDatabaseMode,
  KubernetesEvidenceKind,
  KubernetesEvidenceMode,
  KubernetesEvidenceStatus,
  KubernetesEvidenceSummary,
} from "./kubernetes-posture-definitions";

export function failureCodesForEvidence(input: {
  checks: KubernetesEvidenceSummary["checks"];
  data: Record<string, unknown>;
  databaseMode: KubernetesDatabaseMode;
  evidenceStatus: KubernetesEvidenceStatus;
  kind: KubernetesEvidenceKind;
  logRedaction: KubernetesEvidenceSummary["logRedaction"];
  mode: KubernetesEvidenceMode;
  target: KubernetesEvidenceSummary["target"];
  vectorPosture?: KubernetesEvidenceSummary["vectorPosture"];
}): string[] {
  const failures: string[] = [];
  if (input.evidenceStatus !== "passed") {
    failures.push(
      input.evidenceStatus === "planned"
        ? "evidence_planned"
        : "evidence_not_passed",
    );
  }
  if (input.mode !== "live") failures.push("evidence_not_live");
  if (input.target.deployment !== "kubernetes") {
    failures.push("target_not_kubernetes");
  }
  if (input.checks.missingRequired.length > 0) {
    failures.push("required_checks_missing");
  }
  if (
    input.checks.missingRequired.length === 0 &&
    input.checks.total > 0 &&
    input.logRedaction.status !== "passed"
  ) {
    failures.push("log_redaction_missing");
  }
  if (input.kind === "tiered_rag") {
    failures.push(...tieredRagFailureCodes(input.vectorPosture));
  }
  failures.push(
    ...specificFailureCodesForEvidence(
      input.kind,
      input.data,
      input.databaseMode,
    ),
  );
  return failures;
}

function tieredRagFailureCodes(
  posture: KubernetesEvidenceSummary["vectorPosture"],
): string[] {
  const failures: string[] = [];
  if (posture === undefined || posture.driver === "unknown") {
    failures.push("tiered_rag_vector_posture_missing");
    return failures;
  }
  if (posture.isolationMode === "unknown") {
    failures.push("tiered_rag_vector_isolation_mode_missing");
  }
  if (posture.externalVectorStoreDriver === "unknown") {
    failures.push("tiered_rag_external_vector_driver_missing");
  }
  if (
    posture.namespacePolicy === "unknown" ||
    posture.partitioningPolicy === "unknown"
  ) {
    failures.push("tiered_rag_vector_policy_missing");
  }
  if (
    posture.planEntryCount < 4 ||
    posture.vectorScopeDriverCounts[posture.driver] < 4
  ) {
    failures.push("tiered_rag_vector_scope_counts_invalid");
  }
  if (
    posture.driver === "qdrant" &&
    (posture.externalVectorStoreDriver !== "qdrant" ||
      posture.externalVectorStoreRoutingActive !== true ||
      posture.namespaceConfigured !== true ||
      posture.namespacePolicy === "none")
  ) {
    failures.push("tiered_rag_qdrant_vector_posture_incomplete");
  }
  return failures;
}

function specificFailureCodesForEvidence(
  kind: KubernetesEvidenceKind,
  data: Record<string, unknown>,
  databaseMode: KubernetesDatabaseMode,
): string[] {
  if (kind === "live_smoke") return liveSmokeFailureCodes(data);
  if (kind === "workers") return workerSmokeFailureCodes(data);
  if (kind === "networkpolicy") return networkPolicyFailureCodes(data);
  if (kind === "cloudnativepg_dr" || kind === "external_postgres_dr") {
    return drFailureCodes(data, databaseMode);
  }
  if (kind === "keda") return kedaFailureCodes(data);
  if (kind === "load_soak") return loadSoakFailureCodes(data);
  return [];
}

function liveSmokeFailureCodes(data: Record<string, unknown>): string[] {
  const failures: string[] = [];
  const target = recordValue(data.target);
  for (const field of ["namespace", "releaseName", "appName", "image"]) {
    if (stringValue(target[field]) === undefined) {
      failures.push(`kubernetes_live_smoke_missing_target_${field}`);
    }
  }
  const imagePosture = recordValue(data.imagePosture);
  if (imagePosture.appImageReviewed !== true) {
    failures.push("kubernetes_live_smoke_app_image_not_reviewed");
  }
  if (imagePosture.dependencyImagesDigestPinned !== true) {
    failures.push("kubernetes_live_smoke_dependency_images_not_pinned");
  }
  const productWorkflow = recordValue(data.productWorkflow);
  for (const field of ["chatId", "sourceId", "runId", "webhookDeliveryId"]) {
    if (stringValue(productWorkflow[field]) === undefined) {
      failures.push(`kubernetes_live_smoke_missing_readback_${field}`);
    }
  }
  const logRedaction = recordValue(data.logRedaction);
  if (!integerAtLeast(logRedaction.scannedPodLogEntries, 1)) {
    failures.push("kubernetes_live_smoke_log_redaction_missing_pod_scan");
  }
  if (!integerAtLeast(logRedaction.generatedSecretValuesChecked, 8)) {
    failures.push(
      "kubernetes_live_smoke_log_redaction_missing_generated_secrets",
    );
  }
  if (!integerAtLeast(logRedaction.rawAuthSentinelsChecked, 1)) {
    failures.push("kubernetes_live_smoke_log_redaction_missing_auth_sentinel");
  }
  if (!integerAtLeast(logRedaction.rawContentSentinelsChecked, 1)) {
    failures.push(
      "kubernetes_live_smoke_log_redaction_missing_content_sentinel",
    );
  }
  return failures;
}

function workerSmokeFailureCodes(data: Record<string, unknown>): string[] {
  const failures: string[] = [];
  const workerNames = new Set(
    Array.isArray(data.workers)
      ? data.workers
          .filter(isRecord)
          .map((worker) => worker.name)
          .filter((name): name is string => typeof name === "string")
      : [],
  );
  for (const worker of [
    "data_connector_sync",
    "workflow_resume",
    "webhook_retry",
    "notification_retry",
    "retention_enforce",
    "billing_entitlement_reconcile",
    "billing_lifecycle_enforce",
  ]) {
    if (!workerNames.has(worker)) {
      failures.push(`kubernetes_workers_missing_worker:${worker}`);
    }
  }
  const workerCount = numberValue(data.workerCount) ?? 0;
  const logRedaction = recordValue(data.logRedaction);
  if (!integerAtLeast(logRedaction.scannedPodLogEntries, 1)) {
    failures.push("kubernetes_workers_log_redaction_missing_pod_scan");
  }
  if (!integerAtLeast(logRedaction.scannedJobLogEntries, workerCount)) {
    failures.push("kubernetes_workers_log_redaction_missing_job_scan");
  }
  if (logRedaction.checkedAdminApiKey !== true) {
    failures.push("kubernetes_workers_log_redaction_missing_admin_api_key");
  }
  const target = recordValue(data.target);
  if (
    target.workerApiKeySecretMode === "applied_by_smoke" &&
    logRedaction.checkedSmokeOwnedWorkerApiKey !== true
  ) {
    failures.push("kubernetes_workers_log_redaction_missing_worker_api_key");
  }
  if (logRedaction.webhookSigningSecretChecked !== true) {
    failures.push(
      "kubernetes_workers_log_redaction_missing_webhook_signing_secret",
    );
  }
  if (!integerAtLeast(logRedaction.rawPromptSentinelsChecked, 2)) {
    failures.push("kubernetes_workers_log_redaction_missing_prompt_sentinels");
  }
  if (!integerAtLeast(logRedaction.rawContentSentinelsChecked, 1)) {
    failures.push("kubernetes_workers_log_redaction_missing_content_sentinels");
  }
  const crashRecovery = recordValue(data.crashRecovery);
  if (crashRecovery.recoveredStatus !== "waiting_approval") {
    failures.push("kubernetes_workers_crash_recovery_not_recovered");
  }
  if (crashRecovery.termination !== "forced_pod_delete") {
    failures.push("kubernetes_workers_crash_termination_missing");
  }
  const controlled = recordValue(data.controlledWorkflowResume);
  for (const field of ["workflowId", "workflowRunId", "linkedRunId"]) {
    if (stringValue(controlled[field]) === undefined) {
      failures.push(`kubernetes_workers_missing_controlled_${field}`);
    }
  }
  return failures;
}

function networkPolicyFailureCodes(data: Record<string, unknown>): string[] {
  const failures: string[] = [];
  const target = recordValue(data.target);
  if (target.enforcement !== "networking.k8s.io/v1 NetworkPolicy") {
    failures.push("networkpolicy_enforcement_contract_missing");
  }
  const policy = recordValue(data.policy);
  if (policy.selectedComponent !== "app") {
    failures.push("networkpolicy_unexpected_selected_component");
  }
  const logRedaction = recordValue(data.logRedaction);
  if (!integerAtLeast(logRedaction.scannedPodLogEntries, 1)) {
    failures.push("networkpolicy_log_redaction_missing_pod_scan");
  }
  if (logRedaction.generatedSentinelChecked !== true) {
    failures.push("networkpolicy_log_redaction_missing_generated_sentinel");
  }
  return failures;
}

function drFailureCodes(
  data: Record<string, unknown>,
  databaseMode: KubernetesDatabaseMode,
): string[] {
  const failures: string[] = [];
  const source = recordValue(data.source);
  const restore = recordValue(data.restore);
  const sourceNamespace = stringValue(source.namespace);
  const restoreNamespace = stringValue(restore.namespace);
  if (sourceNamespace === undefined) {
    failures.push("kubernetes_dr_missing_source_namespace");
  }
  if (restoreNamespace === undefined) {
    failures.push("kubernetes_dr_missing_restore_namespace");
  }
  if (
    sourceNamespace !== undefined &&
    restoreNamespace !== undefined &&
    sourceNamespace === restoreNamespace
  ) {
    failures.push("kubernetes_dr_namespaces_not_isolated");
  }
  const sourceConnection = recordValue(source.databaseConnection);
  const restoreConnection = recordValue(restore.databaseConnection);
  if (sourceConnection.source === undefined) {
    failures.push("kubernetes_dr_missing_source_database_connection");
  }
  if (restoreConnection.source === undefined) {
    failures.push("kubernetes_dr_missing_restore_database_connection");
  }
  if (
    databaseMode === "cloudnativepg" &&
    (sourceConnection.source !== "operator_secret" ||
      restoreConnection.source !== "operator_secret")
  ) {
    failures.push("kubernetes_dr_cloudnativepg_requires_operator_secrets");
  }
  if (
    databaseMode === "external-postgres" &&
    (sourceConnection.source !== "smoke_owned_secret" ||
      restoreConnection.source !== "smoke_owned_secret")
  ) {
    failures.push("kubernetes_dr_external_requires_smoke_owned_secrets");
  }
  const evidence = recordValue(data.evidence);
  for (const field of [
    "postgresBackupManifest",
    "objectStoreBackupManifest",
    "postgresDrill",
    "objectStoreDrill",
    "restoredSchemaValidation",
  ]) {
    if (stringValue(evidence[field]) === undefined) {
      failures.push(`kubernetes_dr_missing_evidence_${field}`);
    }
  }
  const productWorkflow = recordValue(data.productWorkflow);
  for (const field of ["chatId", "sourceId", "runId"]) {
    if (stringValue(productWorkflow[field]) === undefined) {
      failures.push(`kubernetes_dr_missing_readback_${field}`);
    }
  }
  const logRedaction = recordValue(data.logRedaction);
  if (!integerAtLeast(logRedaction.sourceScannedPodLogEntries, 1)) {
    failures.push("kubernetes_dr_log_redaction_missing_source_pod_scan");
  }
  if (!integerAtLeast(logRedaction.restoreScannedPodLogEntries, 1)) {
    failures.push("kubernetes_dr_log_redaction_missing_restore_pod_scan");
  }
  if (!integerAtLeast(logRedaction.generatedSecretValuesChecked, 8)) {
    failures.push("kubernetes_dr_log_redaction_missing_generated_secrets");
  }
  if (!integerAtLeast(logRedaction.rawContentSentinelsChecked, 1)) {
    failures.push("kubernetes_dr_log_redaction_missing_content_sentinel");
  }
  return failures;
}

function kedaFailureCodes(data: Record<string, unknown>): string[] {
  const failures: string[] = [];
  const target = recordValue(data.target);
  for (const field of [
    "namespace",
    "kedaNamespace",
    "scaledJobName",
    "triggerAuthenticationName",
  ]) {
    if (stringValue(target[field]) === undefined) {
      failures.push(`keda_missing_target_${field}`);
    }
  }
  const seededDelivery = recordValue(data.seededDelivery);
  const initialAttemptCount = numberValue(seededDelivery.initialAttemptCount);
  const retriedAttemptCount = numberValue(seededDelivery.retriedAttemptCount);
  if (
    typeof initialAttemptCount !== "number" ||
    !Number.isInteger(initialAttemptCount) ||
    typeof retriedAttemptCount !== "number" ||
    !Number.isInteger(retriedAttemptCount) ||
    retriedAttemptCount <= initialAttemptCount
  ) {
    failures.push("keda_delivery_retry_not_observed");
  }
  const kedaJob = recordValue(data.kedaJob);
  if ((numberValue(kedaJob.succeeded) ?? 0) < 1) {
    failures.push("keda_worker_job_not_succeeded");
  }
  if ((numberValue(kedaJob.failed) ?? 0) > 0) {
    failures.push("keda_worker_job_failed");
  }
  const logRedaction = recordValue(data.logRedaction);
  if (!integerAtLeast(logRedaction.targetNamespaceLogEntries, 1)) {
    failures.push("keda_log_redaction_missing_target_log_scan");
  }
  if (!integerAtLeast(logRedaction.kedaOperatorLogEntries, 1)) {
    failures.push("keda_log_redaction_missing_operator_log_scan");
  }
  if (!integerAtLeast(logRedaction.extraSecretSentinelCount, 0)) {
    failures.push("keda_log_redaction_missing_extra_secret_sentinel_count");
  }
  for (const field of [
    "checkedAdminApiKey",
    "checkedWorkerApiKey",
    "checkedDatabaseUrl",
    "checkedWebhookSigningSecret",
    "checkedWebhookPayloadSentinel",
    "checkedWebhookUrlSentinel",
  ]) {
    if (logRedaction[field] !== true) {
      failures.push(`keda_log_redaction_missing_${field}`);
    }
  }
  return failures;
}

function loadSoakFailureCodes(data: Record<string, unknown>): string[] {
  const failures: string[] = [];
  if (data.tier !== "small" && data.tier !== "enterprise") {
    failures.push("load_soak_tier_not_ga_scale");
  }
  const loadRuns = numberValue(data.loadRuns);
  const loadRunCount =
    typeof loadRuns === "number" && Number.isInteger(loadRuns)
      ? loadRuns
      : undefined;
  if (loadRunCount === undefined || loadRunCount < 2) {
    failures.push("load_soak_requires_repeated_runs");
  }
  const soak = recordValue(data.soak);
  if (
    !Number.isInteger(numberValue(soak.requestedSeconds)) ||
    (numberValue(soak.requestedSeconds) ?? 0) < 60
  ) {
    failures.push("load_soak_requested_duration_too_short");
  }
  if (soak.passed !== true) {
    failures.push("load_soak_duration_not_observed");
  }
  const logRedaction = recordValue(data.logRedaction);
  if (!integerAtLeast(logRedaction.scannedPods, 1)) {
    failures.push("load_soak_log_redaction_missing_pod_scan");
  }
  if (logRedaction.apiKeyChecked !== true) {
    failures.push("load_soak_log_redaction_missing_api_key");
  }
  if (
    !integerAtLeast(logRedaction.rawFixtureSentinelsChecked, loadRunCount ?? 2)
  ) {
    failures.push("load_soak_log_redaction_missing_fixture_sentinels");
  }
  const loadEvidence = Array.isArray(data.loadEvidence)
    ? data.loadEvidence
    : [];
  if (
    loadRunCount === undefined ||
    loadEvidence.length !== loadRunCount ||
    loadEvidence.some((run) => {
      if (!isRecord(run)) return true;
      const latencyMs = recordValue(run.latencyMs);
      return (
        run.status !== "passed" ||
        run.mode !== "live" ||
        !integerAtLeast(latencyMs.count, 1)
      );
    })
  ) {
    failures.push("load_soak_run_summary_invalid");
  }
  const kubernetes = recordValue(data.kubernetes);
  if (JSON.stringify(kubernetes.pods ?? []).includes('"imageID"')) {
    failures.push("load_soak_raw_image_id_returned");
  }
  return failures;
}

function recordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function integerAtLeast(value: unknown, minimum: number): boolean {
  return Number.isInteger(value) && (value as number) >= minimum;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
