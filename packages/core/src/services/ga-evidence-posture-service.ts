import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

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

export type GaTargetEvidencePlanStatus =
  | "blocked"
  | "invalid"
  | "not_configured"
  | "ready";

export type GaTargetExecutionStatus =
  | "blocked"
  | "failed"
  | "invalid"
  | "not_configured"
  | "not_run"
  | "partial"
  | "passed";

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

const emptySummary = {
  total: 0,
  satisfied: 0,
  excepted: 0,
  blocked: 0,
  environmentRequired: 0,
  securityCriticalBlocked: 0,
};

const emptyPreflightSummary = {
  total: 0,
  ready: 0,
  blocked: 0,
  securityCriticalBlocked: 0,
};

const emptyTargetPlanSummary = {
  total: 0,
  ready: 0,
  blocked: 0,
  environmentRequired: 0,
  securityCriticalBlocked: 0,
  phaseCount: 0,
  commandCount: 0,
  evidenceTargetCount: 0,
  blockedCheckCount: 0,
};

const emptyTargetExecutionSummary = {
  total: 0,
  readyToRun: 0,
  executed: 0,
  passed: 0,
  failed: 0,
  skipped: 0,
  confirmationRequired: 0,
  blocked: 0,
  redacted: 0,
  commandMissing: 0,
};

const emptyTargetExecutionRun = {
  confirmed: false,
  continueOnFailure: false,
  timeoutMs: 0,
  selectedGateCount: 0,
  commandsExecuted: 0,
};

const emptyTargetExecutionEnvFile = {
  configured: false,
  loaded: false,
  variableCount: 0,
  populatedVariableCount: 0,
  blankVariableCount: 0,
  duplicateCount: 0,
  appliedVariableCount: 0,
  variableNames: [],
  warningCodes: [],
  rawValuesReturned: false,
  rawFileBodyReturned: false,
  shellSourced: false,
  blankValuesApplied: false,
} satisfies GaEvidencePostureReport["targetExecution"]["envFile"];

const emptyBundleRequirements = {
  checklistPassed: false,
  readbackValidation: false,
  supportBundle: false,
  supportRedaction: false,
  docsCommandCheck: false,
  tenantIsolation: false,
};

const emptyBundleInventory = {
  evidenceFileCount: 0,
  totalBytes: 0,
};

const emptyBundleCheckSummary = {
  total: 0,
  passed: 0,
  failed: 0,
};

export class GaEvidencePostureService {
  constructor(private readonly env: RomeoEnv) {}

  async report(subject: AuthSubject): Promise<GaEvidencePostureReport> {
    assertScope(subject, "admin:read");

    const configuredPath = this.env.GA_CHECKLIST_PATH.trim();
    if (configuredPath.length === 0) {
      return this.notConfigured(subject);
    }

    let raw: string;
    try {
      raw = await readFile(configuredPath, "utf8");
    } catch {
      return this.invalid(subject, "read_failed");
    }

    let checklist: unknown;
    try {
      checklist = JSON.parse(raw);
    } catch {
      return this.invalid(subject, "invalid_json");
    }

    if (
      !isRecord(checklist) ||
      checklist.schemaVersion !== "romeo.ga-checklist.v1"
    ) {
      return this.invalid(subject, "schema_mismatch");
    }

    const gates = asArray(checklist.gates).map(sanitizeGate);
    const summary = sanitizeSummary(checklist.summary);
    const target = sanitizeTarget(checklist.target);
    const requiredLiveBlockers = gates
      .filter((gate) => gate.status === "blocked" && gate.environmentRequired)
      .map((gate) => ({
        id: gate.id,
        phase: gate.phase,
        title: gate.title,
        securityCritical: gate.securityCritical,
      }));
    const checklistStatus =
      checklist.status === "passed" || checklist.status === "blocked"
        ? checklist.status
        : "invalid";
    const targetPreflight = await this.targetPreflight();
    const targetPlan = await this.targetPlan();
    const targetExecution = await this.targetExecution();
    const bundle = await this.bundle();
    const liveGateReadiness = buildLiveGateReadiness({
      gates,
      requiredLiveBlockers,
      targetPreflight,
    });
    const warnings: GaEvidencePostureReport["warnings"] = [];
    if (checklistStatus === "blocked" || summary.blocked > 0) {
      warnings.push("ga_blocked");
    }
    if (requiredLiveBlockers.length > 0) {
      warnings.push("live_environment_evidence_required");
    }
    if (targetPreflight.status === "blocked") {
      warnings.push("ga_target_preflight_blocked");
    } else if (targetPreflight.status === "invalid") {
      warnings.push("ga_target_preflight_invalid");
    }
    if (targetPlan.status === "invalid") {
      warnings.push("ga_target_plan_invalid");
    }
    if (targetExecution.status === "invalid") {
      warnings.push("ga_target_execution_invalid");
    } else if (targetExecution.status === "failed") {
      warnings.push("ga_target_execution_failed");
    }
    if (bundle.status === "blocked") {
      warnings.push("ga_bundle_blocked");
    } else if (bundle.status === "invalid") {
      warnings.push("ga_bundle_invalid");
    }

    return {
      schema: "romeo.ga-evidence-posture.v1",
      generatedAt: new Date().toISOString(),
      orgId: subject.orgId,
      status: warnings.length === 0 ? "passed" : "attention_required",
      checklist: {
        configured: true,
        source: "configured_file",
        status: checklistStatus,
        schemaVersion: "romeo.ga-checklist.v1",
        ...(typeof checklist.generatedAt === "string"
          ? { generatedAt: checklist.generatedAt }
          : {}),
        ...(typeof checklist.strict === "boolean"
          ? { strict: checklist.strict }
          : {}),
        ...(target === undefined ? {} : { target }),
        summary,
        exceptionCount: asArray(checklist.exceptions).length,
      },
      targetPreflight,
      targetPlan,
      targetExecution,
      bundle,
      gates,
      requiredLiveBlockers,
      liveGateReadiness,
      redaction: redactionPosture(),
      warnings,
    };
  }

  private async notConfigured(
    subject: AuthSubject,
  ): Promise<GaEvidencePostureReport> {
    return {
      schema: "romeo.ga-evidence-posture.v1",
      generatedAt: new Date().toISOString(),
      orgId: subject.orgId,
      status: "attention_required",
      checklist: {
        configured: false,
        source: "not_configured",
        status: "not_configured",
        summary: emptySummary,
        exceptionCount: 0,
      },
      targetPreflight: await this.targetPreflight(),
      targetPlan: await this.targetPlan(),
      targetExecution: await this.targetExecution(),
      bundle: await this.bundle(),
      gates: [],
      requiredLiveBlockers: [],
      liveGateReadiness: [],
      redaction: redactionPosture(),
      warnings: ["ga_checklist_path_not_configured"],
    };
  }

  private async invalid(
    subject: AuthSubject,
    invalidReason: NonNullable<
      GaEvidencePostureReport["checklist"]["invalidReason"]
    >,
  ): Promise<GaEvidencePostureReport> {
    return {
      schema: "romeo.ga-evidence-posture.v1",
      generatedAt: new Date().toISOString(),
      orgId: subject.orgId,
      status: "attention_required",
      checklist: {
        configured: true,
        source: "configured_file",
        status: "invalid",
        summary: emptySummary,
        exceptionCount: 0,
        invalidReason,
      },
      targetPreflight: await this.targetPreflight(),
      targetPlan: await this.targetPlan(),
      targetExecution: await this.targetExecution(),
      bundle: await this.bundle(),
      gates: [],
      requiredLiveBlockers: [],
      liveGateReadiness: [],
      redaction: redactionPosture(),
      warnings: ["ga_checklist_invalid"],
    };
  }

  private async targetPreflight(): Promise<
    GaEvidencePostureReport["targetPreflight"]
  > {
    const configuredPath = this.env.GA_TARGET_PREFLIGHT_PATH.trim();
    if (configuredPath.length === 0) {
      return {
        configured: false,
        source: "not_configured",
        status: "not_configured",
        summary: emptyPreflightSummary,
        gates: [],
      };
    }

    let raw: string;
    try {
      raw = await readFile(configuredPath, "utf8");
    } catch {
      return invalidTargetPreflight("read_failed");
    }

    let preflight: unknown;
    try {
      preflight = JSON.parse(raw);
    } catch {
      return invalidTargetPreflight("invalid_json");
    }

    if (
      !isRecord(preflight) ||
      preflight.schemaVersion !== "romeo.ga-target-preflight.v1"
    ) {
      return invalidTargetPreflight("schema_mismatch");
    }

    const status =
      preflight.status === "ready" || preflight.status === "blocked"
        ? preflight.status
        : "invalid";

    return {
      configured: true,
      source: "configured_file",
      status,
      schemaVersion: "romeo.ga-target-preflight.v1",
      ...(typeof preflight.generatedAt === "string"
        ? { generatedAt: preflight.generatedAt }
        : {}),
      checklist: sanitizePreflightChecklist(preflight.checklist),
      summary: sanitizePreflightSummary(preflight.summary),
      gates: asArray(preflight.gates).map(sanitizeTargetPreflightGate),
    };
  }

  private async targetPlan(): Promise<GaEvidencePostureReport["targetPlan"]> {
    const configuredPath = this.env.GA_TARGET_PLAN_PATH.trim();
    if (configuredPath.length === 0) {
      return {
        configured: false,
        source: "not_configured",
        status: "not_configured",
        summary: emptyTargetPlanSummary,
        phases: [],
        gates: [],
      };
    }

    let raw: string;
    try {
      raw = await readFile(configuredPath, "utf8");
    } catch {
      return invalidTargetPlan("read_failed");
    }

    let plan: unknown;
    try {
      plan = JSON.parse(raw);
    } catch {
      return invalidTargetPlan("invalid_json");
    }

    if (
      !isRecord(plan) ||
      plan.schemaVersion !== "romeo.ga-target-evidence-plan.v1"
    ) {
      return invalidTargetPlan("schema_mismatch");
    }

    const status =
      plan.status === "ready" || plan.status === "blocked"
        ? plan.status
        : "invalid";

    return {
      configured: true,
      source: "configured_file",
      status,
      schemaVersion: "romeo.ga-target-evidence-plan.v1",
      ...(typeof plan.generatedAt === "string"
        ? { generatedAt: plan.generatedAt }
        : {}),
      sourcePreflight: sanitizeTargetPlanSource(plan.source),
      summary: sanitizeTargetPlanSummary(plan.summary),
      phases: asArray(plan.phases).map(sanitizeTargetPlanPhase),
      gates: asArray(plan.gates).map(sanitizeTargetPlanGate),
    };
  }

  private async targetExecution(): Promise<
    GaEvidencePostureReport["targetExecution"]
  > {
    const configuredPath = this.env.GA_TARGET_EXECUTION_PATH.trim();
    if (configuredPath.length === 0) {
      return {
        configured: false,
        source: "not_configured",
        status: "not_configured",
        execution: emptyTargetExecutionRun,
        envFile: emptyTargetExecutionEnvFile,
        summary: emptyTargetExecutionSummary,
        gates: [],
      };
    }

    let raw: string;
    try {
      raw = await readFile(configuredPath, "utf8");
    } catch {
      return invalidTargetExecution("read_failed");
    }

    let execution: unknown;
    try {
      execution = JSON.parse(raw);
    } catch {
      return invalidTargetExecution("invalid_json");
    }

    if (
      !isRecord(execution) ||
      execution.schemaVersion !== "romeo.ga-target-execution.v1"
    ) {
      return invalidTargetExecution("schema_mismatch");
    }

    const status = safeTargetExecutionStatus(execution.status);

    return {
      configured: true,
      source: "configured_file",
      status,
      schemaVersion: "romeo.ga-target-execution.v1",
      ...(typeof execution.generatedAt === "string"
        ? { generatedAt: execution.generatedAt }
        : {}),
      sourcePlan: sanitizeTargetExecutionSource(execution.source),
      execution: sanitizeTargetExecutionRun(execution.execution),
      envFile: sanitizeTargetExecutionEnvFile(execution.envFile),
      summary: sanitizeTargetExecutionSummary(execution.summary),
      gates: asArray(execution.gates).map(sanitizeTargetExecutionGate),
    };
  }

  private async bundle(): Promise<GaEvidencePostureReport["bundle"]> {
    const configuredPath = this.env.GA_EVIDENCE_BUNDLE_PATH.trim();
    if (configuredPath.length === 0) {
      return {
        configured: false,
        source: "not_configured",
        status: "not_configured",
        requirements: emptyBundleRequirements,
        inventory: emptyBundleInventory,
        checks: emptyBundleCheckSummary,
        blockerCount: 0,
        blockerCodes: [],
        redaction: safeBundleRedaction({}),
      };
    }

    let raw: string;
    try {
      raw = await readFile(configuredPath, "utf8");
    } catch {
      return invalidBundle("read_failed");
    }

    let bundle: unknown;
    try {
      bundle = JSON.parse(raw);
    } catch {
      return invalidBundle("invalid_json");
    }

    if (
      !isRecord(bundle) ||
      bundle.schemaVersion !== "romeo.ga-evidence-bundle.v1"
    ) {
      return invalidBundle("schema_mismatch");
    }

    const status =
      bundle.status === "passed" || bundle.status === "blocked"
        ? bundle.status
        : "invalid";

    return {
      configured: true,
      source: "configured_file",
      status,
      schemaVersion: "romeo.ga-evidence-bundle.v1",
      ...(typeof bundle.generatedAt === "string"
        ? { generatedAt: bundle.generatedAt }
        : {}),
      requirements: sanitizeBundleRequirements(bundle.requirements),
      ...(isRecord(bundle.release)
        ? { release: sanitizeBundleRelease(bundle.release) }
        : {}),
      ...(isRecord(bundle.ga) ? { ga: sanitizeBundleGa(bundle.ga) } : {}),
      inventory: sanitizeBundleInventory(bundle.inventory),
      checks: summarizeBundleChecks(bundle.checks),
      blockerCount: asArray(bundle.blockers).length,
      blockerCodes: asArray(bundle.blockers)
        .map((item) => (isRecord(item) ? item.code : undefined))
        .slice(0, 100)
        .map((item) => safeToken(item)),
      redaction: safeBundleRedaction(bundle.redaction),
    };
  }
}

function buildLiveGateReadiness(input: {
  gates: GaEvidencePostureGate[];
  requiredLiveBlockers: GaEvidencePostureReport["requiredLiveBlockers"];
  targetPreflight: GaEvidencePostureReport["targetPreflight"];
}): GaEvidencePostureReport["liveGateReadiness"] {
  const gateById = new Map(input.gates.map((gate) => [gate.id, gate]));
  const preflightById = new Map(
    input.targetPreflight.gates.map((gate) => [gate.id, gate]),
  );
  return input.requiredLiveBlockers.map((blocker) => {
    const gate = gateById.get(blocker.id);
    const preflight = preflightById.get(blocker.id);
    const checklistEvidence = summarizeChecklistEvidence(gate?.evidence ?? []);
    const preflightEvidence = summarizePreflightEvidence(
      preflight?.evidence ?? [],
    );
    const checks = summarizePreflightChecks(preflight?.checks ?? []);
    const warnings: GaEvidencePostureReport["liveGateReadiness"][number]["warnings"] =
      [];
    if (input.targetPreflight.status === "not_configured") {
      warnings.push("preflight_not_configured");
    } else if (preflight === undefined) {
      warnings.push("preflight_gate_missing");
    } else if (preflight.status === "blocked") {
      warnings.push("preflight_blocked");
    }
    if (checklistEvidence.missing > 0 || checklistEvidence.failed > 0) {
      warnings.push("live_evidence_missing");
    }
    return {
      id: blocker.id,
      phase: blocker.phase,
      title: blocker.title,
      securityCritical: blocker.securityCritical,
      checklistStatus: gate?.status ?? "unknown",
      preflightStatus:
        input.targetPreflight.status === "not_configured"
          ? "not_configured"
          : (preflight?.status ?? "unknown"),
      ...(preflight?.command === undefined
        ? {}
        : { command: preflight.command }),
      checklistEvidence,
      preflightEvidence,
      checks,
      warnings,
    };
  });
}

function summarizeChecklistEvidence(
  evidence: GaEvidencePostureGateEvidence[],
): GaEvidencePostureReport["liveGateReadiness"][number]["checklistEvidence"] {
  return {
    total: evidence.length,
    satisfied: evidence.filter((item) => item.status === "satisfied").length,
    missing: evidence.filter((item) => item.status === "missing").length,
    failed: evidence.filter((item) => item.status === "failed").length,
    invalid: evidence.filter((item) => item.status === "invalid_json").length,
    unknown: evidence.filter((item) => item.status === "unknown").length,
  };
}

function summarizePreflightEvidence(
  evidence: GaTargetPreflightGateEvidence[],
): GaEvidencePostureReport["liveGateReadiness"][number]["preflightEvidence"] {
  return {
    total: evidence.length,
    ready: evidence.filter(
      (item) => item.status === "ready" || item.status === "satisfied",
    ).length,
    missing: evidence.filter((item) => item.status === "missing").length,
    blocked: evidence.filter((item) => item.status === "blocked").length,
    failed: evidence.filter((item) => item.status === "failed").length,
    unknown: evidence.filter((item) => item.status === "unknown").length,
  };
}

function summarizePreflightChecks(
  checks: GaTargetPreflightCheck[],
): GaEvidencePostureReport["liveGateReadiness"][number]["checks"] {
  return {
    total: checks.length,
    ready: checks.filter((item) => item.status === "ready").length,
    blocked: checks.filter((item) => item.status === "blocked").length,
    optional: checks.filter((item) => item.status === "optional").length,
    unknown: checks.filter((item) => item.status === "unknown").length,
    blockedReasons: [
      ...new Set(
        checks
          .filter((item) => item.status === "blocked")
          .map((item) => item.reason ?? `${item.name}_blocked`)
          .map((item) => safeToken(item)),
      ),
    ].sort(),
  };
}

function invalidTargetPreflight(
  invalidReason: NonNullable<
    GaEvidencePostureReport["targetPreflight"]["invalidReason"]
  >,
): GaEvidencePostureReport["targetPreflight"] {
  return {
    configured: true,
    source: "configured_file",
    status: "invalid",
    summary: emptyPreflightSummary,
    gates: [],
    invalidReason,
  };
}

function invalidTargetPlan(
  invalidReason: NonNullable<
    GaEvidencePostureReport["targetPlan"]["invalidReason"]
  >,
): GaEvidencePostureReport["targetPlan"] {
  return {
    configured: true,
    source: "configured_file",
    status: "invalid",
    summary: emptyTargetPlanSummary,
    phases: [],
    gates: [],
    invalidReason,
  };
}

function invalidTargetExecution(
  invalidReason: NonNullable<
    GaEvidencePostureReport["targetExecution"]["invalidReason"]
  >,
): GaEvidencePostureReport["targetExecution"] {
  return {
    configured: true,
    source: "configured_file",
    status: "invalid",
    execution: emptyTargetExecutionRun,
    envFile: emptyTargetExecutionEnvFile,
    summary: emptyTargetExecutionSummary,
    gates: [],
    invalidReason,
  };
}

function invalidBundle(
  invalidReason: NonNullable<
    GaEvidencePostureReport["bundle"]["invalidReason"]
  >,
): GaEvidencePostureReport["bundle"] {
  return {
    configured: true,
    source: "configured_file",
    status: "invalid",
    requirements: emptyBundleRequirements,
    inventory: emptyBundleInventory,
    checks: emptyBundleCheckSummary,
    blockerCount: 0,
    blockerCodes: [],
    redaction: safeBundleRedaction({}),
    invalidReason,
  };
}

function sanitizeGate(input: unknown): GaEvidencePostureGate {
  const gate = isRecord(input) ? input : {};
  const exceptionStatus: "invalid" | "valid" =
    isRecord(gate.exception) && gate.exception.status === "valid"
      ? "valid"
      : "invalid";
  const exception: GaEvidencePostureGate["exception"] | undefined = isRecord(
    gate.exception,
  )
    ? {
        status: exceptionStatus,
        ...(typeof gate.exception.expiresAt === "string"
          ? { expiresAt: gate.exception.expiresAt }
          : {}),
        failureCodes: failurePresenceCodes(
          gate.exception.failures,
          "ga_checklist_exception_failure_codes_present",
        ),
      }
    : undefined;
  return {
    id: safeString(gate.id, "unknown_gate"),
    phase: safeString(gate.phase, "unknown"),
    title: safeString(gate.title, "Untitled gate"),
    status:
      gate.status === "blocked" ||
      gate.status === "excepted" ||
      gate.status === "satisfied"
        ? gate.status
        : "unknown",
    requiredForGa: gate.requiredForGa === true,
    exceptionAllowed: gate.exceptionAllowed === true,
    environmentRequired: gate.environmentRequired === true,
    securityCritical: gate.securityCritical === true,
    evidence: asArray(gate.evidence).map(sanitizeEvidence),
    ...(exception === undefined ? {} : { exception }),
  };
}

function sanitizeEvidence(input: unknown): GaEvidencePostureGateEvidence {
  const evidence = isRecord(input) ? input : {};
  return {
    path: safeEvidencePath(evidence.path),
    status:
      evidence.status === "failed" ||
      evidence.status === "invalid_json" ||
      evidence.status === "missing" ||
      evidence.status === "satisfied"
        ? evidence.status
        : "unknown",
    ...(typeof evidence.schemaVersion === "string"
      ? { schemaVersion: safeString(evidence.schemaVersion, "unknown") }
      : {}),
    ...(typeof evidence.evidenceStatus === "string"
      ? { evidenceStatus: safeString(evidence.evidenceStatus, "unknown") }
      : {}),
    failureCodes: failurePresenceCodes(
      evidence.failures,
      "ga_checklist_evidence_failure_codes_present",
    ),
  };
}

function sanitizeSummary(
  input: unknown,
): GaEvidencePostureReport["checklist"]["summary"] {
  const summary = isRecord(input) ? input : {};
  return {
    total: safeCount(summary.total),
    satisfied: safeCount(summary.satisfied),
    excepted: safeCount(summary.excepted),
    blocked: safeCount(summary.blocked),
    environmentRequired: safeCount(summary.environmentRequired),
    securityCriticalBlocked: safeCount(summary.securityCriticalBlocked),
  };
}

function sanitizeTarget(
  input: unknown,
): GaEvidencePostureReport["checklist"]["target"] {
  const target = isRecord(input) ? input : {};
  return {
    profile: sanitizeChecklistTargetProfile(target.profile),
    fullProductEnterpriseRequired:
      target.fullProductEnterpriseRequired === true,
    deploymentTiers: asArray(target.deploymentTiers).map((item) =>
      safeString(item, "unknown"),
    ),
    postgresModes: asArray(target.postgresModes).map((item) =>
      safeString(item, "unknown"),
    ),
    qdrantLiveRequired: target.qdrantLiveRequired === true,
    qdrantDrRequired: target.qdrantDrRequired === true,
    ciGovernanceLiveRequired: target.ciGovernanceLiveRequired === true,
    kedaRequired: target.kedaRequired === true,
    browserAutomationRequired: target.browserAutomationRequired === true,
    identityLiveRequired: target.identityLiveRequired === true,
    dataConnectorLiveRequired: target.dataConnectorLiveRequired === true,
    toolDispatchLiveRequired: target.toolDispatchLiveRequired === true,
    voiceProviderLiveRequired: target.voiceProviderLiveRequired === true,
    notificationAdapterLiveRequired:
      target.notificationAdapterLiveRequired === true,
    analyticsAuthzLiveRequired: target.analyticsAuthzLiveRequired === true,
    targetQualityVectorComparisonRequired:
      target.targetQualityVectorComparisonRequired === true,
    dataRightsRetentionLiveRequired:
      target.dataRightsRetentionLiveRequired === true,
    billingOperationsLiveRequired:
      target.billingOperationsLiveRequired === true,
    auditIntegrityLiveRequired: target.auditIntegrityLiveRequired === true,
    tenantPurgeLiveRequired: target.tenantPurgeLiveRequired === true,
    supportBundleLiveRequired: target.supportBundleLiveRequired === true,
    targetResilienceDrillsRequired:
      target.targetResilienceDrillsRequired === true,
    postgresOperationsLiveRequired:
      target.postgresOperationsLiveRequired === true,
  };
}

function sanitizePreflightChecklist(
  input: unknown,
): NonNullable<GaEvidencePostureReport["targetPreflight"]["checklist"]> {
  const checklist = isRecord(input) ? input : {};
  return {
    status: safeToken(checklist.status),
    ...(typeof checklist.schemaVersion === "string"
      ? { schemaVersion: safeToken(checklist.schemaVersion) }
      : {}),
    summary: sanitizeSummary(checklist.summary),
  };
}

function sanitizePreflightSummary(
  input: unknown,
): GaEvidencePostureReport["targetPreflight"]["summary"] {
  const summary = isRecord(input) ? input : {};
  return {
    total: safeCount(summary.total),
    ready: safeCount(summary.ready),
    blocked: safeCount(summary.blocked),
    securityCriticalBlocked: safeCount(summary.securityCriticalBlocked),
  };
}

function sanitizeTargetPreflightGate(input: unknown): GaTargetPreflightGate {
  const gate = isRecord(input) ? input : {};
  return {
    id: safeToken(gate.id),
    phase: safeToken(gate.phase),
    title: safeString(gate.title, "Untitled gate"),
    status:
      gate.status === "blocked" || gate.status === "ready"
        ? gate.status
        : "unknown",
    environmentRequired: gate.environmentRequired === true,
    securityCritical: gate.securityCritical === true,
    evidence: asArray(gate.evidence).map(sanitizeTargetPreflightEvidence),
    ...(typeof gate.command === "string"
      ? { command: safeCommand(gate.command) }
      : {}),
    checks: asArray(gate.checks).map(sanitizeTargetPreflightCheck),
    notes: asArray(gate.notes).map((item) => safeString(item, "redacted_note")),
  };
}

function sanitizeTargetPreflightEvidence(
  input: unknown,
): GaTargetPreflightGateEvidence {
  const evidence = isRecord(input) ? input : {};
  return {
    path: safeEvidencePath(evidence.path),
    status:
      evidence.status === "blocked" ||
      evidence.status === "failed" ||
      evidence.status === "missing" ||
      evidence.status === "ready" ||
      evidence.status === "satisfied"
        ? evidence.status
        : "unknown",
    ...(typeof evidence.schemaVersion === "string"
      ? { schemaVersion: safeToken(evidence.schemaVersion) }
      : {}),
  };
}

function sanitizeTargetPreflightCheck(input: unknown): GaTargetPreflightCheck {
  const check = isRecord(input) ? input : {};
  return {
    name: safeCheckName(check.name),
    status:
      check.status === "blocked" ||
      check.status === "optional" ||
      check.status === "ready"
        ? check.status
        : "unknown",
    ...(typeof check.reason === "string"
      ? { reason: safeToken(check.reason) }
      : {}),
    ...(typeof check.configured === "boolean"
      ? { configured: check.configured }
      : {}),
    ...(typeof check.required === "boolean"
      ? { required: check.required }
      : {}),
    ...(Array.isArray(check.configuredNames)
      ? {
          configuredNames: check.configuredNames.map((item) => safeToken(item)),
        }
      : {}),
    ...(typeof check.context === "string"
      ? { context: safeString(check.context, "redacted_context") }
      : {}),
    ...(typeof check.origin === "string"
      ? { origin: safeOrigin(check.origin) }
      : {}),
    ...(typeof check.path === "string"
      ? { path: safeEvidencePath(check.path) }
      : {}),
    ...(typeof check.baselineConfigured === "boolean"
      ? { baselineConfigured: check.baselineConfigured }
      : {}),
    ...(typeof check.candidateConfigured === "boolean"
      ? { candidateConfigured: check.candidateConfigured }
      : {}),
    ...(typeof check.replayKind === "string"
      ? { replayKind: safeToken(check.replayKind) }
      : {}),
    ...(typeof check.baselineRouteMode === "string"
      ? { baselineRouteMode: safeToken(check.baselineRouteMode) }
      : {}),
    ...(typeof check.candidateRouteMode === "string"
      ? { candidateRouteMode: safeToken(check.candidateRouteMode) }
      : {}),
    ...(typeof check.baselineCaseCount === "number"
      ? { baselineCaseCount: safeCount(check.baselineCaseCount) }
      : {}),
    ...(typeof check.candidateCaseCount === "number"
      ? { candidateCaseCount: safeCount(check.candidateCaseCount) }
      : {}),
  };
}

function sanitizeTargetPlanSource(
  input: unknown,
): NonNullable<GaEvidencePostureReport["targetPlan"]["sourcePreflight"]> {
  const source = isRecord(input) ? input : {};
  return {
    ...(typeof source.preflightSchemaVersion === "string"
      ? { schemaVersion: safeToken(source.preflightSchemaVersion) }
      : {}),
    status: safeToken(source.preflightStatus),
    ...(isRecord(source.checklist)
      ? { checklist: sanitizePreflightChecklist(source.checklist) }
      : {}),
  };
}

function sanitizeTargetPlanSummary(
  input: unknown,
): GaEvidencePostureReport["targetPlan"]["summary"] {
  const summary = isRecord(input) ? input : {};
  return {
    total: safeCount(summary.total),
    ready: safeCount(summary.ready),
    blocked: safeCount(summary.blocked),
    environmentRequired: safeCount(summary.environmentRequired),
    securityCriticalBlocked: safeCount(summary.securityCriticalBlocked),
    phaseCount: safeCount(summary.phaseCount),
    commandCount: safeCount(summary.commandCount),
    evidenceTargetCount: safeCount(summary.evidenceTargetCount),
    blockedCheckCount: safeCount(summary.blockedCheckCount),
  };
}

function sanitizeTargetPlanPhase(
  input: unknown,
): GaEvidencePostureReport["targetPlan"]["phases"][number] {
  const phase = isRecord(input) ? input : {};
  return {
    phase: safeToken(phase.phase),
    status:
      phase.status === "blocked" || phase.status === "ready"
        ? phase.status
        : "unknown",
    total: safeCount(phase.total),
    ready: safeCount(phase.ready),
    blocked: safeCount(phase.blocked),
    securityCriticalBlocked: safeCount(phase.securityCriticalBlocked),
    gateIds: asArray(phase.gateIds)
      .slice(0, 100)
      .map((item) => safeToken(item)),
  };
}

function sanitizeTargetPlanGate(input: unknown): GaTargetEvidencePlanGate {
  const gate = isRecord(input) ? input : {};
  const status =
    gate.status === "blocked" || gate.status === "ready"
      ? gate.status
      : "unknown";
  const command =
    typeof gate.command === "string" ? safeCommand(gate.command) : undefined;
  const commandRedacted = gate.commandRedacted === true;
  const checks = sanitizeTargetPlanCheckSummary(gate.checks);
  return {
    order: safeCount(gate.order),
    id: safeToken(gate.id),
    phase: safeToken(gate.phase),
    title: safeString(gate.title, "Untitled gate"),
    status,
    environmentRequired: gate.environmentRequired === true,
    securityCritical: gate.securityCritical === true,
    ...(command === undefined ? {} : { command }),
    commandRedacted,
    operatorAction: sanitizeTargetPlanOperatorAction(gate.operatorAction, {
      status,
      commandAvailable: command !== undefined,
      commandRedacted,
      checks,
    }),
    evidenceTargets: asArray(gate.evidenceTargets).map(
      sanitizeTargetPreflightEvidence,
    ),
    requiredCommands: asArray(gate.requiredCommands)
      .slice(0, 50)
      .map((item) => safeToken(item)),
    requiredEnvironment: asArray(gate.requiredEnvironment)
      .slice(0, 100)
      .map((item) => safeToken(item)),
    anyOfEnvironment: asArray(gate.anyOfEnvironment)
      .slice(0, 20)
      .map((group) =>
        asArray(group)
          .slice(0, 10)
          .map((item) => safeToken(item)),
      ),
    optionalEnvironment: asArray(gate.optionalEnvironment)
      .slice(0, 100)
      .map((item) => safeToken(item)),
    requiredFiles: asArray(gate.requiredFiles)
      .slice(0, 100)
      .map((item) => safeEvidencePath(item)),
    checks,
    blockedChecks: asArray(gate.blockedChecks)
      .slice(0, 100)
      .map(sanitizeTargetPlanBlockedCheck),
    notes: asArray(gate.notes)
      .slice(0, 20)
      .map((item) => safeString(item, "redacted_note")),
  };
}

function sanitizeTargetPlanOperatorAction(
  input: unknown,
  fallback: {
    status: GaTargetEvidencePlanGate["status"];
    commandAvailable: boolean;
    commandRedacted: boolean;
    checks: GaTargetEvidencePlanGate["checks"];
  },
): GaTargetEvidencePlanGate["operatorAction"] {
  const action = isRecord(input) ? input : {};
  const fallbackState = fallback.commandRedacted
    ? "command_redacted"
    : fallback.status === "blocked"
      ? "blocked_on_prerequisites"
      : fallback.status === "ready" && fallback.commandAvailable
        ? "ready_to_run"
        : "unknown";
  const state =
    action.state === "blocked_on_prerequisites" ||
    action.state === "command_redacted" ||
    action.state === "ready_to_run"
      ? action.state
      : fallbackState;
  return {
    state,
    commandAvailable:
      typeof action.commandAvailable === "boolean"
        ? action.commandAvailable
        : fallback.commandAvailable,
    prerequisiteBlocked:
      typeof action.prerequisiteBlocked === "boolean"
        ? action.prerequisiteBlocked
        : fallback.checks.blocked > 0,
    blockedReasonCodes: (asArray(action.blockedReasonCodes).length > 0
      ? asArray(action.blockedReasonCodes)
      : fallback.checks.blockedReasons
    )
      .slice(0, 100)
      .map((item) => safeToken(item)),
  };
}

function sanitizeTargetPlanCheckSummary(
  input: unknown,
): GaTargetEvidencePlanGate["checks"] {
  const checks = isRecord(input) ? input : {};
  return {
    total: safeCount(checks.total),
    ready: safeCount(checks.ready),
    blocked: safeCount(checks.blocked),
    optional: safeCount(checks.optional),
    unknown: safeCount(checks.unknown),
    blockedReasons: asArray(checks.blockedReasons)
      .slice(0, 100)
      .map((item) => safeToken(item)),
  };
}

function sanitizeTargetPlanBlockedCheck(
  input: unknown,
): GaTargetEvidencePlanGate["blockedChecks"][number] {
  const check = isRecord(input) ? input : {};
  return {
    name: safeCheckName(check.name),
    reason: safeToken(check.reason),
    ...(typeof check.configured === "boolean"
      ? { configured: check.configured }
      : {}),
  };
}

function sanitizeTargetExecutionSource(
  input: unknown,
): NonNullable<GaEvidencePostureReport["targetExecution"]["sourcePlan"]> {
  const source = isRecord(input) ? input : {};
  return {
    ...(typeof source.targetPlanSchemaVersion === "string"
      ? { schemaVersion: safeToken(source.targetPlanSchemaVersion) }
      : {}),
    status: safeToken(source.targetPlanStatus),
    ...(isRecord(source.checklist)
      ? { checklist: sanitizePreflightChecklist(source.checklist) }
      : {}),
  };
}

function sanitizeTargetExecutionRun(
  input: unknown,
): GaEvidencePostureReport["targetExecution"]["execution"] {
  const execution = isRecord(input) ? input : {};
  return {
    confirmed: execution.confirmed === true,
    continueOnFailure: execution.continueOnFailure === true,
    timeoutMs: safeCount(execution.timeoutMs),
    selectedGateCount: safeCount(execution.selectedGateCount),
    commandsExecuted: safeCount(execution.commandsExecuted),
  };
}

function sanitizeTargetExecutionEnvFile(
  input: unknown,
): GaEvidencePostureReport["targetExecution"]["envFile"] {
  const envFile = isRecord(input) ? input : {};
  return {
    configured: envFile.configured === true,
    loaded: envFile.loaded === true,
    variableCount: safeCount(envFile.variableCount),
    populatedVariableCount: safeCount(envFile.populatedVariableCount),
    blankVariableCount: safeCount(envFile.blankVariableCount),
    duplicateCount: safeCount(envFile.duplicateCount),
    appliedVariableCount: safeCount(envFile.appliedVariableCount),
    variableNames: asArray(envFile.variableNames).map(safeToken),
    warningCodes: asArray(envFile.warningCodes).map(safeToken),
    rawValuesReturned: false,
    rawFileBodyReturned: false,
    shellSourced: false,
    blankValuesApplied: false,
  };
}

function sanitizeTargetExecutionSummary(
  input: unknown,
): GaEvidencePostureReport["targetExecution"]["summary"] {
  const summary = isRecord(input) ? input : {};
  return {
    total: safeCount(summary.total),
    readyToRun: safeCount(summary.readyToRun),
    executed: safeCount(summary.executed),
    passed: safeCount(summary.passed),
    failed: safeCount(summary.failed),
    skipped: safeCount(summary.skipped),
    confirmationRequired: safeCount(summary.confirmationRequired),
    blocked: safeCount(summary.blocked),
    redacted: safeCount(summary.redacted),
    commandMissing: safeCount(summary.commandMissing),
  };
}

function sanitizeTargetExecutionGate(input: unknown): GaTargetExecutionGate {
  const gate = isRecord(input) ? input : {};
  const exitCode =
    typeof gate.exitCode === "number" &&
    Number.isInteger(gate.exitCode) &&
    gate.exitCode >= 0
      ? gate.exitCode
      : undefined;
  return {
    id: safeToken(gate.id),
    phase: safeToken(gate.phase),
    title: safeString(gate.title, "Untitled gate"),
    targetStatus:
      gate.targetStatus === "blocked" || gate.targetStatus === "ready"
        ? gate.targetStatus
        : "unknown",
    operatorActionState:
      gate.operatorActionState === "blocked_on_prerequisites" ||
      gate.operatorActionState === "command_redacted" ||
      gate.operatorActionState === "ready_to_run"
        ? gate.operatorActionState
        : "unknown",
    ...(typeof gate.commandHash === "string" &&
    /^[A-Fa-f0-9]{64}$/u.test(gate.commandHash)
      ? { commandHash: gate.commandHash.toLowerCase() }
      : {}),
    commandAvailable: gate.commandAvailable === true,
    commandRedacted: gate.commandRedacted === true,
    executionStatus:
      gate.executionStatus === "failed" ||
      gate.executionStatus === "passed" ||
      gate.executionStatus === "skipped"
        ? gate.executionStatus
        : "unknown",
    ...(typeof gate.skippedReason === "string"
      ? { skippedReason: safeToken(gate.skippedReason) }
      : {}),
    ...(typeof gate.failureReason === "string"
      ? { failureReason: safeToken(gate.failureReason) }
      : {}),
    ...(exitCode === undefined ? {} : { exitCode }),
    ...(typeof gate.signal === "string"
      ? { signal: safeToken(gate.signal) }
      : {}),
    ...(typeof gate.startedAt === "string"
      ? { startedAt: gate.startedAt }
      : {}),
    ...(typeof gate.completedAt === "string"
      ? { completedAt: gate.completedAt }
      : {}),
    durationMs: safeCount(gate.durationMs),
    evidenceTargets: asArray(gate.evidenceTargets).map(
      sanitizeTargetPreflightEvidence,
    ),
    blockedReasonCodes: asArray(gate.blockedReasonCodes)
      .slice(0, 100)
      .map((item) => safeToken(item)),
  };
}

function safeTargetExecutionStatus(input: unknown): GaTargetExecutionStatus {
  return input === "blocked" ||
    input === "failed" ||
    input === "not_run" ||
    input === "partial" ||
    input === "passed"
    ? input
    : "invalid";
}

function sanitizeBundleRequirements(
  input: unknown,
): GaEvidencePostureReport["bundle"]["requirements"] {
  const requirements = isRecord(input) ? input : {};
  return {
    checklistPassed: requirements.checklistPassed === true,
    readbackValidation: requirements.readbackValidation === true,
    supportBundle: requirements.supportBundle === true,
    supportRedaction: requirements.supportRedaction === true,
    docsCommandCheck: requirements.docsCommandCheck === true,
    tenantIsolation: requirements.tenantIsolation === true,
  };
}

function sanitizeBundleRelease(
  input: Record<string, unknown>,
): NonNullable<GaEvidencePostureReport["bundle"]["release"]> {
  return {
    ...(typeof input.name === "string"
      ? { name: safeString(input.name, "unknown") }
      : {}),
    ...(typeof input.version === "string"
      ? { version: safeString(input.version, "unknown") }
      : {}),
    artifactCount: safeCount(input.artifactCount),
  };
}

function sanitizeBundleGa(
  input: Record<string, unknown>,
): NonNullable<GaEvidencePostureReport["bundle"]["ga"]> {
  return {
    status: safeToken(input.status),
    strict: input.strict === true,
    summary: sanitizeSummary(input.summary),
    profile: sanitizeChecklistTargetProfile(input.profile),
    fullProductEnterpriseRequired: input.fullProductEnterpriseRequired === true,
    qdrantLiveRequired: input.qdrantLiveRequired === true,
    qdrantDrRequired: input.qdrantDrRequired === true,
    ciGovernanceLiveRequired: input.ciGovernanceLiveRequired === true,
    kedaRequired: input.kedaRequired === true,
    browserAutomationRequired: input.browserAutomationRequired === true,
    identityLiveRequired: input.identityLiveRequired === true,
    dataConnectorLiveRequired: input.dataConnectorLiveRequired === true,
    toolDispatchLiveRequired: input.toolDispatchLiveRequired === true,
    voiceProviderLiveRequired: input.voiceProviderLiveRequired === true,
    notificationAdapterLiveRequired:
      input.notificationAdapterLiveRequired === true,
    analyticsAuthzLiveRequired: input.analyticsAuthzLiveRequired === true,
    targetQualityVectorComparisonRequired:
      input.targetQualityVectorComparisonRequired === true,
    dataRightsRetentionLiveRequired:
      input.dataRightsRetentionLiveRequired === true,
    billingOperationsLiveRequired: input.billingOperationsLiveRequired === true,
    auditIntegrityLiveRequired: input.auditIntegrityLiveRequired === true,
    tenantPurgeLiveRequired: input.tenantPurgeLiveRequired === true,
    supportBundleLiveRequired: input.supportBundleLiveRequired === true,
    targetResilienceDrillsRequired:
      input.targetResilienceDrillsRequired === true,
    postgresOperationsLiveRequired:
      input.postgresOperationsLiveRequired === true,
    blockedGateIds: asArray(input.blockedGateIds)
      .slice(0, 100)
      .map((item) => safeToken(item)),
    exceptionCount: safeCount(input.exceptionCount),
  };
}

function sanitizeChecklistTargetProfile(
  input: unknown,
): "default-ga" | "full-product-enterprise" | "unknown" {
  return input === "default-ga" || input === "full-product-enterprise"
    ? input
    : "unknown";
}

function sanitizeBundleInventory(
  input: unknown,
): GaEvidencePostureReport["bundle"]["inventory"] {
  const inventory = isRecord(input) ? input : {};
  return {
    evidenceFileCount: safeCount(inventory.evidenceFileCount),
    totalBytes: safeCount(inventory.totalBytes),
    ...(typeof inventory.sha256 === "string"
      ? { sha256: safeSha256(inventory.sha256) }
      : {}),
  };
}

function summarizeBundleChecks(
  input: unknown,
): GaEvidencePostureReport["bundle"]["checks"] {
  const checks = asArray(input);
  return {
    total: checks.length,
    passed: checks.filter((item) => isRecord(item) && item.status === "pass")
      .length,
    failed: checks.filter((item) => isRecord(item) && item.status === "fail")
      .length,
  };
}

function safeBundleRedaction(
  input: unknown,
): GaEvidencePostureReport["bundle"]["redaction"] {
  const redaction = isRecord(input) ? input : {};
  return {
    evidenceBodiesIncluded: redaction.evidenceBodiesIncluded === true,
    exceptionRationaleIncluded: redaction.exceptionRationaleIncluded === true,
    rawEvidencePathsIncluded: redaction.rawEvidencePathsIncluded === true,
    rawSecretsIncluded: redaction.rawSecretsIncluded === true,
    rawLogsIncluded: redaction.rawLogsIncluded === true,
    rawPromptsIncluded: redaction.rawPromptsIncluded === true,
    rawProviderPayloadsIncluded: redaction.rawProviderPayloadsIncluded === true,
    rawConnectorPayloadsIncluded:
      redaction.rawConnectorPayloadsIncluded === true,
  };
}

function redactionPosture(): GaEvidencePostureReport["redaction"] {
  return {
    absoluteChecklistPathReturned: false,
    absoluteBundlePathReturned: false,
    bundleBlockerMessagesReturned: false,
    bundleEvidenceFileBodiesReturned: false,
    bundleEvidencePathsReturned: false,
    evidenceFileBodiesReturned: false,
    exceptionApproverReturned: false,
    exceptionOwnerReturned: false,
    exceptionRationaleReturned: false,
    preflightCommandOutputReturned: false,
    preflightEnvironmentValuesReturned: false,
    preflightFileBodiesReturned: false,
    targetPlanCommandOutputReturned: false,
    targetPlanEnvironmentValuesReturned: false,
    targetPlanEvidenceBodiesReturned: false,
    targetExecutionCommandTextReturned: false,
    targetExecutionCommandOutputReturned: false,
    targetExecutionEnvironmentValuesReturned: false,
    targetExecutionEnvFileValuesReturned: false,
    targetExecutionEnvFileBodyReturned: false,
    targetExecutionEvidenceBodiesReturned: false,
    rawEvidencePathsReturned: false,
    rawPreflightEvidencePathsReturned: false,
    rawTargetPlanEvidencePathsReturned: false,
    rawTargetExecutionEvidencePathsReturned: false,
  };
}

function safeEvidencePath(input: unknown): string {
  if (typeof input !== "string" || input.length === 0) return "unknown";
  if (isAbsolute(input) || input.includes("..") || input.includes("\\")) {
    return "redacted_path";
  }
  return safeString(input, "redacted_path");
}

function safeString(input: unknown, fallback: string): string {
  if (typeof input !== "string" || input.length === 0) return fallback;
  if (!/^[A-Za-z0-9 _./:@-]{1,160}$/.test(input)) return fallback;
  return input;
}

function safeCommand(input: unknown): string {
  if (typeof input !== "string" || input.length === 0) {
    return "redacted_command";
  }
  if (input.length > 1_600 || /[\n\r\0]/.test(input)) {
    return "redacted_command";
  }
  if (hasUnsafeInlineCredentialAssignment(input)) return "redacted_command";
  if (!/^[A-Za-z0-9 _./:@$,=&?|+-]{1,1600}$/.test(input)) {
    return "redacted_command";
  }
  return input;
}

function hasUnsafeInlineCredentialAssignment(value: string): boolean {
  const assignments = value.match(
    /\b[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY)[A-Z0-9_]*=[^\s]+/giu,
  );
  if (assignments === null) return false;
  return assignments.some((assignment) => {
    const [, assigned = ""] = assignment.split("=");
    return !assigned.startsWith("$");
  });
}

function safeCheckName(input: unknown): string {
  if (typeof input !== "string" || input.length === 0) return "unknown";
  if (!/^[A-Za-z0-9:._|/-]{1,180}$/.test(input)) return "redacted_check";
  return input;
}

function safeOrigin(input: unknown): string {
  if (typeof input !== "string" || input.length === 0) return "unknown";
  try {
    const origin = new URL(input).origin;
    return safeString(origin, "redacted_origin");
  } catch {
    return input === "invalid_url" ? "invalid_url" : "redacted_origin";
  }
}

function safeTokens(input: unknown): string[] {
  return asArray(input).map((item) => safeToken(item));
}

function failurePresenceCodes(input: unknown, code: string): string[] {
  return asArray(input).length === 0 ? [] : [code];
}

function safeToken(input: unknown): string {
  if (typeof input !== "string" || input.length === 0) return "unknown";
  if (!/^[A-Za-z0-9:._-]{1,160}$/.test(input)) return "redacted_failure";
  return input;
}

function safeSha256(input: unknown): string {
  return typeof input === "string" && /^[A-Fa-f0-9]{64}$/.test(input)
    ? input.toLowerCase()
    : "redacted_sha256";
}

function safeCount(input: unknown): number {
  return typeof input === "number" && Number.isSafeInteger(input) && input >= 0
    ? input
    : 0;
}

function asArray(input: unknown): unknown[] {
  return Array.isArray(input) ? input : [];
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
