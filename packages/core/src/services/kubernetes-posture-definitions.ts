import type { RomeoEnv } from "@romeo/config";

type KubernetesEvidenceDefinitionShape = {
  kind: string;
  gateId: string;
  label: string;
  envKey: keyof RomeoEnv;
  schemaVersion: string;
  required: boolean;
  requiredChecks: readonly string[];
  requiredDatabaseMode?: KubernetesDatabaseMode;
};

export type KubernetesDatabaseMode =
  | "cloudnativepg"
  | "external-postgres"
  | "unknown";

export type KubernetesEvidenceStatus =
  | "failed"
  | "passed"
  | "planned"
  | "unknown";

export type KubernetesEvidenceMode = "dry-run" | "live" | "unknown";

export const evidenceDefinitions = [
  {
    kind: "live_smoke",
    gateId: "phase21.kubernetes_live_smoke",
    label: "Kubernetes live namespace smoke",
    envKey: "KUBERNETES_LIVE_SMOKE_EVIDENCE_PATH",
    schemaVersion: "romeo.kubernetes-live-smoke.v1",
    required: true,
    requiredChecks: [
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
  },
  {
    kind: "workers",
    gateId: "phase25.kubernetes_workers_smoke",
    label: "Kubernetes worker CronJob and crash recovery smoke",
    envKey: "KUBERNETES_WORKERS_EVIDENCE_PATH",
    schemaVersion: "romeo.kubernetes-workers-smoke.v1",
    required: true,
    requiredChecks: [
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
  },
  {
    kind: "networkpolicy",
    gateId: "phase21.kubernetes_networkpolicy_enforcement",
    label: "Kubernetes NetworkPolicy CNI enforcement",
    envKey: "KUBERNETES_NETWORKPOLICY_EVIDENCE_PATH",
    schemaVersion: "romeo.kubernetes-networkpolicy-smoke.v1",
    required: true,
    requiredChecks: [
      "cluster_reachable",
      "namespace_created",
      "baseline_allowed_endpoint_reachable_before_policy",
      "baseline_denied_endpoint_reachable_before_policy",
      "egress_policy_applied",
      "allowed_endpoint_reachable_after_policy",
      "denied_endpoint_blocked_after_policy",
      "pod_logs_redacted",
    ],
  },
  {
    kind: "cloudnativepg_dr",
    gateId: "phase21.kubernetes_dr_modes",
    label: "Kubernetes CloudNativePG DR evidence",
    envKey: "KUBERNETES_CLOUDNATIVEPG_DR_EVIDENCE_PATH",
    schemaVersion: "romeo.kubernetes-dr-smoke.v1",
    required: true,
    requiredDatabaseMode: "cloudnativepg",
    requiredChecks: [
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
  },
  {
    kind: "external_postgres_dr",
    gateId: "phase21.kubernetes_dr_modes",
    label: "Kubernetes external Postgres DR evidence",
    envKey: "KUBERNETES_EXTERNAL_POSTGRES_DR_EVIDENCE_PATH",
    schemaVersion: "romeo.kubernetes-dr-smoke.v1",
    required: true,
    requiredDatabaseMode: "external-postgres",
    requiredChecks: [
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
  },
  {
    kind: "tiered_rag",
    gateId: "phase32.kubernetes_tiered_rag_smoke",
    label: "Kubernetes tiered-RAG isolation smoke",
    envKey: "KUBERNETES_TIERED_RAG_EVIDENCE_PATH",
    schemaVersion: "romeo.kubernetes-tiered-rag-smoke.v1",
    required: true,
    requiredChecks: [
      "cluster_reachable",
      "admin_readiness_ready",
      "tiered_rag_user_private_workspace_org_shared_hits",
      "tiered_rag_vector_plan_posture_reported",
      "denied_corpus_skipped_without_id_or_content_leak",
      "tiered_rag_audit_metadata_only",
      "rag_policy_restored_or_explicitly_kept",
      "pod_logs_redacted",
    ],
  },
  {
    kind: "load_soak",
    gateId: "phase34.kubernetes_load_soak",
    label: "Kubernetes load and soak evidence",
    envKey: "KUBERNETES_LOAD_SOAK_EVIDENCE_PATH",
    schemaVersion: "romeo.kubernetes-load-soak.v1",
    required: true,
    requiredChecks: [
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
  },
  {
    kind: "keda",
    gateId: "phase21.kubernetes_keda_scaler",
    label: "Kubernetes KEDA scaler smoke",
    envKey: "KUBERNETES_KEDA_EVIDENCE_PATH",
    schemaVersion: "romeo.kubernetes-keda-smoke.v1",
    required: false,
    requiredChecks: [
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
  },
  {
    kind: "log_redaction",
    gateId: "supplemental.kubernetes_log_redaction",
    label: "Supplemental Kubernetes log-redaction evidence",
    envKey: "KUBERNETES_LOG_REDACTION_EVIDENCE_PATH",
    schemaVersion: "romeo.kubernetes-log-redaction-smoke.v1",
    required: false,
    requiredChecks: [
      "cluster_reachable",
      "namespace_readable",
      "prompt_sentinels_absent",
      "provider_payload_sentinels_absent",
      "worker_payload_sentinels_absent",
      "secret_sentinels_absent",
      "evidence_omits_sentinel_values",
    ],
  },
] as const satisfies readonly KubernetesEvidenceDefinitionShape[];

export type KubernetesEvidenceDefinition = (typeof evidenceDefinitions)[number];
export type KubernetesEvidenceKind = KubernetesEvidenceDefinition["kind"];

export type KubernetesInvalidReason =
  | "database_mode_mismatch"
  | "invalid_json"
  | "read_failed"
  | "schema_mismatch";

export interface KubernetesPostureReport {
  schema: "romeo.kubernetes-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "ready";
  summary: {
    total: number;
    requiredTotal: number;
    configured: number;
    notConfigured: number;
    invalid: number;
    planned: number;
    failed: number;
    satisfied: number;
    requiredSatisfied: number;
    requiredMissing: number;
  };
  evidence: KubernetesEvidenceSummary[];
  redaction: {
    databaseUrlsReturned: false;
    evidenceFileBodiesReturned: false;
    kubernetesObjectBodiesReturned: false;
    podLogsReturned: false;
    rawEvidencePathsReturned: false;
    rawImageRefsReturned: false;
    rawNamespaceValuesReturned: false;
    secretValuesReturned: false;
  };
  warnings: Array<
    | "kubernetes_optional_evidence_invalid"
    | "kubernetes_required_evidence_failed"
    | "kubernetes_required_evidence_invalid"
    | "kubernetes_required_evidence_missing"
    | "kubernetes_required_evidence_planned"
  >;
}

export interface KubernetesEvidenceSummary {
  kind: KubernetesEvidenceKind;
  gateId: string;
  label: string;
  required: boolean;
  configured: boolean;
  source: "configured_file" | "not_configured";
  status: "failed" | "invalid" | "not_configured" | "planned" | "satisfied";
  schemaVersion?: string;
  generatedAt?: string;
  evidenceStatus?: KubernetesEvidenceStatus;
  mode?: KubernetesEvidenceMode;
  databaseMode?: KubernetesDatabaseMode;
  invalidReason?: KubernetesInvalidReason;
  failureCodes: string[];
  checks: {
    total: number;
    requiredTotal: number;
    requiredPresent: number;
    missingRequired: string[];
  };
  target: {
    deployment: "kubernetes" | "unknown";
    namespaceConfigured: boolean;
    releaseConfigured: boolean;
    serviceConfigured: boolean;
    deploymentConfigured: boolean;
  };
  logRedaction: {
    configured: boolean;
    status: "failed" | "passed" | "unknown";
    scanCount: number;
    sentinelCheckCount: number;
  };
  metrics: {
    authorizedTierCount?: number;
    iterationCount?: number;
    kedaSucceededJobs?: number;
    loadRunCount?: number;
    skippedDeniedCount?: number;
    soakObservedSeconds?: number;
    soakRequestedSeconds?: number;
    vectorPlanEntryCount?: number;
    workerCount?: number;
  };
  vectorPosture?: {
    driver: "pgvector" | "qdrant" | "unknown";
    isolationMode:
      | "dedicated_vector_store_per_org"
      | "external_collection_per_org"
      | "external_namespace_per_org"
      | "pgvector_partitioned_by_org"
      | "shared_row_scope"
      | "unknown";
    externalVectorStoreDriver: "disabled" | "qdrant" | "unknown";
    externalVectorStoreRoutingActive: boolean;
    namespaceConfigured: boolean;
    namespacePolicy:
      | "knowledge_base"
      | "none"
      | "org"
      | "workspace"
      | "unknown";
    partitioningConfigured: boolean;
    partitioningPolicy:
      | "knowledge_base"
      | "none"
      | "org"
      | "workspace"
      | "unknown";
    planEntryCount: number;
    vectorScopeDriverCounts: {
      pgvector: number;
      qdrant: number;
    };
  };
}
