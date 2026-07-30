import type {
  GaEvidencePostureGate,
  GaEvidencePostureGateEvidence,
  GaEvidencePostureReport,
  GaTargetPreflightCheck,
  GaTargetPreflightGate,
  GaTargetPreflightGateEvidence,
} from "./ga-evidence-types";
import {
  asArray,
  failurePresenceCodes,
  isRecord,
  safeCheckName,
  safeCommand,
  safeCount,
  safeEvidencePath,
  safeOrigin,
  safeString,
  safeToken,
  sanitizeChecklistTargetProfile,
} from "./ga-evidence-sanitize-support";

export function sanitizeGate(input: unknown): GaEvidencePostureGate {
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

export function sanitizeSummary(
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

export function sanitizeTarget(
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

export function sanitizePreflightChecklist(
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

export function sanitizePreflightSummary(
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

export function sanitizeTargetPreflightGate(
  input: unknown,
): GaTargetPreflightGate {
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

export function sanitizeTargetPreflightEvidence(
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
