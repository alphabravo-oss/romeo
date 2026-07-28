import type { GaTargetExecutionStatus } from "./ga-evidence-status";
import type {
  GaEvidencePostureReport,
  GaTargetExecutionGate,
} from "./ga-evidence-types";
import {
  sanitizePreflightChecklist,
  sanitizeSummary,
  sanitizeTargetPreflightEvidence,
} from "./ga-evidence-checklist-sanitizers";
import {
  asArray,
  isRecord,
  safeCount,
  safeSha256,
  safeString,
  safeToken,
  sanitizeChecklistTargetProfile,
} from "./ga-evidence-sanitize-support";

export function sanitizeTargetExecutionSource(
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

export function sanitizeTargetExecutionRun(
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

export function sanitizeTargetExecutionEnvFile(
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

export function sanitizeTargetExecutionSummary(
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

export function sanitizeTargetExecutionGate(
  input: unknown,
): GaTargetExecutionGate {
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

export function safeTargetExecutionStatus(
  input: unknown,
): GaTargetExecutionStatus {
  return input === "blocked" ||
    input === "failed" ||
    input === "not_run" ||
    input === "partial" ||
    input === "passed"
    ? input
    : "invalid";
}

export function sanitizeBundleRequirements(
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

export function sanitizeBundleRelease(
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

export function sanitizeBundleGa(
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

export function sanitizeBundleInventory(
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

export function summarizeBundleChecks(
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

export function safeBundleRedaction(
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

export function redactionPosture(): GaEvidencePostureReport["redaction"] {
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
