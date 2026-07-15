/**
 * Frontend mirrors of the four read-only "system posture" backend reports.
 * Shapes are copied EXACTLY from packages/core service definitions — do not
 * add, rename, or reorder fields relative to the backend.
 *
 * Sources:
 * - GaEvidencePostureReport            → services/ga-evidence-posture-service.ts
 * - PostgresOperationalPostureReport   → services/postgres-operational-posture-service.ts
 * - JobOperationalSummary              → services/job-service.ts
 * - QuotaCoordinationStatus            → services/quota-coordination.ts
 */

/* -------------------------------------------------------------------------- */
/* GET /api/v1/admin/ga/evidence-posture                                      */
/* -------------------------------------------------------------------------- */

export type GaEvidenceChecklistStatus =
  | "blocked"
  | "invalid"
  | "not_configured"
  | "passed";

export type GaTargetPreflightStatus =
  | "blocked"
  | "invalid"
  | "not_configured"
  | "ready";

export type GaEvidenceBundleStatus =
  | "blocked"
  | "invalid"
  | "not_configured"
  | "passed";

export type GaEvidencePostureStatus = "attention_required" | "passed";

export interface GaEvidencePostureGateEvidence {
  path: string;
  status: "failed" | "invalid_json" | "missing" | "satisfied" | "unknown";
  schemaVersion?: string;
  evidenceStatus?: string;
  failureCodes: string[];
}

export interface GaEvidencePostureGate {
  id: string;
  phase: string;
  title: string;
  status: "blocked" | "excepted" | "satisfied" | "unknown";
  requiredForGa: boolean;
  exceptionAllowed: boolean;
  environmentRequired: boolean;
  securityCritical: boolean;
  evidence: GaEvidencePostureGateEvidence[];
  exception?: {
    status: "invalid" | "valid" | "unknown";
    expiresAt?: string;
    failureCodes: string[];
  };
}

export interface GaTargetPreflightGateEvidence {
  path: string;
  status: "blocked" | "failed" | "missing" | "ready" | "satisfied" | "unknown";
  schemaVersion?: string;
}

export interface GaTargetPreflightCheck {
  name: string;
  status: "blocked" | "optional" | "ready" | "unknown";
  reason?: string;
  configured?: boolean;
  configuredNames?: string[];
  context?: string;
  origin?: string;
  path?: string;
}

export interface GaTargetPreflightGate {
  id: string;
  phase: string;
  title: string;
  status: "blocked" | "ready" | "unknown";
  environmentRequired: boolean;
  securityCritical: boolean;
  evidence: GaTargetPreflightGateEvidence[];
  command?: string;
  checks: GaTargetPreflightCheck[];
  notes: string[];
}

export interface GaEvidencePostureReport {
  schema: "romeo.ga-evidence-posture.v1";
  generatedAt: string;
  orgId: string;
  status: GaEvidencePostureStatus;
  checklist: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: GaEvidenceChecklistStatus;
    schemaVersion?: string;
    generatedAt?: string;
    strict?: boolean;
    target?: {
      profile: "default-ga" | "full-product-enterprise" | "unknown";
      fullProductEnterpriseRequired: boolean;
      deploymentTiers: string[];
      postgresModes: string[];
      qdrantLiveRequired: boolean;
      qdrantDrRequired: boolean;
      ciGovernanceLiveRequired: boolean;
      kedaRequired: boolean;
      browserAutomationRequired: boolean;
      identityLiveRequired: boolean;
      dataConnectorLiveRequired: boolean;
      toolDispatchLiveRequired: boolean;
      voiceProviderLiveRequired: boolean;
      notificationAdapterLiveRequired: boolean;
      analyticsAuthzLiveRequired: boolean;
      targetQualityVectorComparisonRequired: boolean;
      dataRightsRetentionLiveRequired: boolean;
      billingOperationsLiveRequired: boolean;
      auditIntegrityLiveRequired: boolean;
      tenantPurgeLiveRequired: boolean;
      supportBundleLiveRequired: boolean;
      targetResilienceDrillsRequired: boolean;
      postgresOperationsLiveRequired: boolean;
    };
    summary: {
      total: number;
      satisfied: number;
      excepted: number;
      blocked: number;
      environmentRequired: number;
      securityCriticalBlocked: number;
    };
    exceptionCount: number;
    invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
  };
  targetPreflight: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: GaTargetPreflightStatus;
    schemaVersion?: string;
    generatedAt?: string;
    checklist?: {
      status: string;
      schemaVersion?: string;
      summary: {
        total: number;
        satisfied: number;
        excepted: number;
        blocked: number;
        environmentRequired: number;
        securityCriticalBlocked: number;
      };
    };
    summary: {
      total: number;
      ready: number;
      blocked: number;
      securityCriticalBlocked: number;
    };
    gates: GaTargetPreflightGate[];
    invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
  };
  bundle: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: GaEvidenceBundleStatus;
    schemaVersion?: string;
    generatedAt?: string;
    requirements: {
      checklistPassed: boolean;
      readbackValidation: boolean;
      supportBundle: boolean;
      supportRedaction: boolean;
      docsCommandCheck: boolean;
      tenantIsolation: boolean;
    };
    release?: {
      name?: string;
      version?: string;
      artifactCount: number;
    };
    ga?: {
      status: string;
      strict: boolean;
      summary: {
        total: number;
        satisfied: number;
        excepted: number;
        blocked: number;
        environmentRequired: number;
        securityCriticalBlocked: number;
      };
      profile: "default-ga" | "full-product-enterprise" | "unknown";
      fullProductEnterpriseRequired: boolean;
      qdrantLiveRequired: boolean;
      qdrantDrRequired: boolean;
      ciGovernanceLiveRequired: boolean;
      kedaRequired: boolean;
      browserAutomationRequired: boolean;
      identityLiveRequired: boolean;
      dataConnectorLiveRequired: boolean;
      toolDispatchLiveRequired: boolean;
      voiceProviderLiveRequired: boolean;
      notificationAdapterLiveRequired: boolean;
      analyticsAuthzLiveRequired: boolean;
      targetQualityVectorComparisonRequired: boolean;
      dataRightsRetentionLiveRequired: boolean;
      billingOperationsLiveRequired: boolean;
      auditIntegrityLiveRequired: boolean;
      tenantPurgeLiveRequired: boolean;
      supportBundleLiveRequired: boolean;
      targetResilienceDrillsRequired: boolean;
      postgresOperationsLiveRequired: boolean;
      blockedGateIds: string[];
      exceptionCount: number;
    };
    inventory: {
      evidenceFileCount: number;
      totalBytes: number;
      sha256?: string;
    };
    checks: {
      total: number;
      passed: number;
      failed: number;
    };
    blockerCount: number;
    blockerCodes: string[];
    redaction: {
      evidenceBodiesIncluded: boolean;
      exceptionRationaleIncluded: boolean;
      rawEvidencePathsIncluded: boolean;
      rawSecretsIncluded: boolean;
      rawLogsIncluded: boolean;
      rawPromptsIncluded: boolean;
      rawProviderPayloadsIncluded: boolean;
      rawConnectorPayloadsIncluded: boolean;
    };
    invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
  };
  gates: GaEvidencePostureGate[];
  requiredLiveBlockers: Array<{
    id: string;
    phase: string;
    title: string;
    securityCritical: boolean;
  }>;
  redaction: {
    absoluteChecklistPathReturned: false;
    absoluteBundlePathReturned: false;
    bundleBlockerMessagesReturned: false;
    bundleEvidenceFileBodiesReturned: false;
    bundleEvidencePathsReturned: false;
    evidenceFileBodiesReturned: false;
    exceptionApproverReturned: false;
    exceptionOwnerReturned: false;
    exceptionRationaleReturned: false;
    preflightCommandOutputReturned: false;
    preflightEnvironmentValuesReturned: false;
    preflightFileBodiesReturned: false;
    rawEvidencePathsReturned: false;
    rawPreflightEvidencePathsReturned: false;
  };
  warnings: Array<
    | "ga_blocked"
    | "ga_bundle_blocked"
    | "ga_bundle_invalid"
    | "ga_checklist_invalid"
    | "ga_checklist_path_not_configured"
    | "ga_target_preflight_blocked"
    | "ga_target_preflight_invalid"
    | "live_environment_evidence_required"
  >;
}

/* -------------------------------------------------------------------------- */
/* GET /api/v1/admin/postgres/operational-posture                             */
/* -------------------------------------------------------------------------- */

export type PostgresOperationalPostureStatus = "attention_required" | "ready";

export type PostgresOperationalWarningCode =
  | "archival_partitioning_decision_required"
  | "live_lock_telemetry_required"
  | "representative_query_plan_evidence_required"
  | "slow_query_telemetry_required";

export type PostgresEvidenceInvalidReason =
  | "invalid_json"
  | "read_failed"
  | "schema_mismatch";

export interface PostgresOperationalPostureReport {
  schema: "romeo.postgres-operational-posture.v1";
  generatedAt: string;
  orgId: string;
  status: PostgresOperationalPostureStatus;
  repository: {
    driver: "memory" | "postgres";
    databaseUrlConfigured: boolean;
    postgresRequiredForProduction: boolean;
  };
  pool: {
    maxConnectionsPerProcess: number;
    source: "POSTGRES_POOL_MAX";
    sizingGuide: "docs/deployment-sizing.md";
    budgetFormula: string;
  };
  queryPlanReview: {
    evidenceSchema: "romeo.postgres-query-plan-review.v1";
    command: "pnpm review:postgres-query-plans";
    reviewedPathCount: number;
    requiredIndexCount: number;
    categories: string[];
    checks: Array<{
      id: string;
      category: string;
      expectedIndexCount: number;
    }>;
    representativeVolumeEvidence: {
      requiredForGa: true;
      status: "invalid" | "required" | "satisfied";
      evidenceSource: "configured_file" | "not_configured";
      configured: boolean;
      representativeVolume: boolean;
      evidenceStatus?: "failed" | "passed" | "unknown";
      schemaVersion?: "romeo.postgres-query-plan-review.v1";
      generatedAt?: string;
      invalidReason?: PostgresEvidenceInvalidReason;
      missingExpectedIndexCount: number;
      failedCheckCount: number;
    };
  };
  slowQueryTelemetry: {
    requiredForProduction: true;
    status: "external_required" | "invalid" | "satisfied";
    expectedSignals: string[];
    evidence: {
      configured: boolean;
      schemaVersion?: "romeo.postgres-slow-query-telemetry.v1";
      generatedAt?: string;
      evidenceStatus?: "failed" | "passed" | "unknown";
      invalidReason?: PostgresEvidenceInvalidReason;
      windowMinutes?: number;
      fingerprintCount: number;
      slowQueryCount: number;
      totalCalls: number;
      maxMeanMs?: number;
      maxP95Ms?: number;
      maxP99Ms?: number;
      tempFileStatementCount: number;
      failureCodes: string[];
    };
  };
  lockTelemetry: {
    requiredForProduction: true;
    status: "external_required" | "invalid" | "satisfied";
    expectedSignals: string[];
    evidence: {
      configured: boolean;
      schemaVersion?: "romeo.postgres-lock-telemetry.v1";
      generatedAt?: string;
      evidenceStatus?: "failed" | "passed" | "unknown";
      invalidReason?: PostgresEvidenceInvalidReason;
      windowMinutes?: number;
      blockedSessionMax: number;
      longestWaitMs?: number;
      deadlockCount: number;
      failureCodes: string[];
    };
  };
  archivalPartitioning: {
    status: "accepted" | "decision_required" | "invalid";
    currentDecision: string;
    migrationPolicy: "one_forward_migration_after_live_evidence";
    decisionInputs: string[];
    evidence: {
      configured: boolean;
      schemaVersion?: "romeo.postgres-archival-partitioning-decision.v1";
      generatedAt?: string;
      decisionStatus?: "accepted" | "deferred" | "required" | "unknown";
      invalidReason?: PostgresEvidenceInvalidReason;
      migrationRequired?: boolean;
      tableCount: number;
      failureCodes: string[];
    };
  };
  redaction: {
    databaseUrlReturned: false;
    evidenceFileBodiesReturned: false;
    lockStatementReturned: false;
    queryParameterValuesReturned: false;
    rawSqlReturned: false;
    rawEvidencePathsReturned: false;
    rowDataReturned: false;
    secretValuesReturned: false;
    telemetrySampleSqlReturned: false;
  };
  warnings: PostgresOperationalWarningCode[];
}

/* -------------------------------------------------------------------------- */
/* GET /api/v1/jobs/operational-summary                                       */
/* -------------------------------------------------------------------------- */

export interface JobLagThresholds {
  deadLetterCriticalCount: number;
  deadLetterWarningCount: number;
  queuedWarningSeconds: number;
  queuedCriticalSeconds: number;
  runningWarningSeconds: number;
  runningCriticalSeconds: number;
  failedLookbackSeconds: number;
  failedWarningCount: number;
  failedCriticalCount: number;
}

export interface BackgroundJobStatusCounts {
  total: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
}

export interface BackgroundJobTypeSummary extends BackgroundJobStatusCounts {
  type: string;
  deadLettered: number;
  recentFailed: number;
  oldestQueuedAgeSeconds?: number;
  oldestQueuedJobId?: string;
  longestRunningAgeSeconds?: number;
  longestRunningJobId?: string;
}

export interface JobOperationalAlert {
  id: string;
  metric:
    | "dead_letter_jobs"
    | "queued_lag_seconds"
    | "recent_failed_jobs"
    | "running_stale_seconds";
  severity: "critical" | "warning";
  type: string;
  value: number;
  threshold: number;
  jobId?: string;
}

export interface JobOperationalSummary {
  generatedAt: string;
  status: "critical" | "degraded" | "healthy";
  thresholds: JobLagThresholds;
  totals: BackgroundJobStatusCounts & {
    deadLettered: number;
    recentFailed: number;
  };
  byType: BackgroundJobTypeSummary[];
  alerts: JobOperationalAlert[];
}

/* -------------------------------------------------------------------------- */
/* GET /api/v1/quotas/distributed-status                                      */
/* -------------------------------------------------------------------------- */

export type QuotaCoordinationDriver = "disabled" | "valkey";

export interface QuotaCoordinationStatus {
  driver: QuotaCoordinationDriver;
  enabled: boolean;
  configured: boolean;
  healthy: boolean | null;
  keyPrefix: string;
  checkedAt: string;
  details: {
    failClosed: boolean;
    statusCode: "disabled" | "healthy" | "unconfigured" | "unreachable";
  };
}
