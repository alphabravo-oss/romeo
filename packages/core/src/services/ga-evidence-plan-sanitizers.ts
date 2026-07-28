import type {
  GaEvidencePostureReport,
  GaTargetEvidencePlanGate,
} from "./ga-evidence-types";
import {
  sanitizePreflightChecklist,
  sanitizeTargetPreflightEvidence,
} from "./ga-evidence-checklist-sanitizers";
import {
  asArray,
  isRecord,
  safeCheckName,
  safeCommand,
  safeCount,
  safeEvidencePath,
  safeString,
  safeToken,
} from "./ga-evidence-sanitize-support";

export function sanitizeTargetPlanSource(
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

export function sanitizeTargetPlanSummary(
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

export function sanitizeTargetPlanPhase(
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

export function sanitizeTargetPlanGate(
  input: unknown,
): GaTargetEvidencePlanGate {
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
