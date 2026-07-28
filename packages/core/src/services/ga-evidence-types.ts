import type {
  GaEvidenceBundleStatus,
  GaEvidenceChecklistStatus,
  GaEvidencePostureStatus,
  GaTargetEvidencePlanStatus,
  GaTargetExecutionStatus,
  GaTargetPreflightStatus,
} from "./ga-evidence-status";

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
  required?: boolean;
  configuredNames?: string[];
  context?: string;
  origin?: string;
  path?: string;
  baselineConfigured?: boolean;
  candidateConfigured?: boolean;
  replayKind?: string;
  baselineRouteMode?: string;
  candidateRouteMode?: string;
  baselineCaseCount?: number;
  candidateCaseCount?: number;
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

export interface GaTargetEvidencePlanGate {
  order: number;
  id: string;
  phase: string;
  title: string;
  status: "blocked" | "ready" | "unknown";
  environmentRequired: boolean;
  securityCritical: boolean;
  command?: string;
  commandRedacted: boolean;
  operatorAction: {
    state:
      | "blocked_on_prerequisites"
      | "command_redacted"
      | "ready_to_run"
      | "unknown";
    commandAvailable: boolean;
    prerequisiteBlocked: boolean;
    blockedReasonCodes: string[];
  };
  evidenceTargets: GaTargetPreflightGateEvidence[];
  requiredCommands: string[];
  requiredEnvironment: string[];
  anyOfEnvironment: string[][];
  optionalEnvironment: string[];
  requiredFiles: string[];
  checks: {
    total: number;
    ready: number;
    blocked: number;
    optional: number;
    unknown: number;
    blockedReasons: string[];
  };
  blockedChecks: Array<{
    name: string;
    reason: string;
    configured?: boolean;
  }>;
  notes: string[];
}

export interface GaTargetExecutionGate {
  id: string;
  phase: string;
  title: string;
  targetStatus: "blocked" | "ready" | "unknown";
  operatorActionState:
    | "blocked_on_prerequisites"
    | "command_redacted"
    | "ready_to_run"
    | "unknown";
  commandHash?: string;
  commandAvailable: boolean;
  commandRedacted: boolean;
  executionStatus: "failed" | "passed" | "skipped" | "unknown";
  skippedReason?: string;
  failureReason?: string;
  exitCode?: number;
  signal?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs: number;
  evidenceTargets: GaTargetPreflightGateEvidence[];
  blockedReasonCodes: string[];
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
  targetPlan: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: GaTargetEvidencePlanStatus;
    schemaVersion?: string;
    generatedAt?: string;
    sourcePreflight?: {
      schemaVersion?: string;
      status: string;
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
    };
    summary: {
      total: number;
      ready: number;
      blocked: number;
      environmentRequired: number;
      securityCriticalBlocked: number;
      phaseCount: number;
      commandCount: number;
      evidenceTargetCount: number;
      blockedCheckCount: number;
    };
    phases: Array<{
      phase: string;
      status: "blocked" | "ready" | "unknown";
      total: number;
      ready: number;
      blocked: number;
      securityCriticalBlocked: number;
      gateIds: string[];
    }>;
    gates: GaTargetEvidencePlanGate[];
    invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
  };
  targetExecution: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: GaTargetExecutionStatus;
    schemaVersion?: string;
    generatedAt?: string;
    sourcePlan?: {
      schemaVersion?: string;
      status: string;
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
    };
    execution: {
      confirmed: boolean;
      continueOnFailure: boolean;
      timeoutMs: number;
      selectedGateCount: number;
      commandsExecuted: number;
    };
    envFile: {
      configured: boolean;
      loaded: boolean;
      variableCount: number;
      populatedVariableCount: number;
      blankVariableCount: number;
      duplicateCount: number;
      appliedVariableCount: number;
      variableNames: string[];
      warningCodes: string[];
      rawValuesReturned: false;
      rawFileBodyReturned: false;
      shellSourced: false;
      blankValuesApplied: false;
    };
    summary: {
      total: number;
      readyToRun: number;
      executed: number;
      passed: number;
      failed: number;
      skipped: number;
      confirmationRequired: number;
      blocked: number;
      redacted: number;
      commandMissing: number;
    };
    gates: GaTargetExecutionGate[];
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
  liveGateReadiness: Array<{
    id: string;
    phase: string;
    title: string;
    securityCritical: boolean;
    checklistStatus: GaEvidencePostureGate["status"];
    preflightStatus: "blocked" | "not_configured" | "ready" | "unknown";
    command?: string;
    checklistEvidence: {
      total: number;
      satisfied: number;
      missing: number;
      failed: number;
      invalid: number;
      unknown: number;
    };
    preflightEvidence: {
      total: number;
      ready: number;
      missing: number;
      blocked: number;
      failed: number;
      unknown: number;
    };
    checks: {
      total: number;
      ready: number;
      blocked: number;
      optional: number;
      unknown: number;
      blockedReasons: string[];
    };
    warnings: Array<
      | "live_evidence_missing"
      | "preflight_blocked"
      | "preflight_gate_missing"
      | "preflight_not_configured"
    >;
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
    targetPlanCommandOutputReturned: false;
    targetPlanEnvironmentValuesReturned: false;
    targetPlanEvidenceBodiesReturned: false;
    targetExecutionCommandTextReturned: false;
    targetExecutionCommandOutputReturned: false;
    targetExecutionEnvironmentValuesReturned: false;
    targetExecutionEnvFileValuesReturned: false;
    targetExecutionEnvFileBodyReturned: false;
    targetExecutionEvidenceBodiesReturned: false;
    rawEvidencePathsReturned: false;
    rawPreflightEvidencePathsReturned: false;
    rawTargetPlanEvidencePathsReturned: false;
    rawTargetExecutionEvidencePathsReturned: false;
  };
  warnings: Array<
    | "ga_blocked"
    | "ga_bundle_blocked"
    | "ga_bundle_invalid"
    | "ga_checklist_invalid"
    | "ga_checklist_path_not_configured"
    | "ga_target_execution_failed"
    | "ga_target_execution_invalid"
    | "ga_target_plan_invalid"
    | "ga_target_preflight_blocked"
    | "ga_target_preflight_invalid"
    | "live_environment_evidence_required"
  >;
}
