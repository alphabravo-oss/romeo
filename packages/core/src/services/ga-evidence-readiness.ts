import type {
  GaEvidencePostureGate,
  GaEvidencePostureGateEvidence,
  GaEvidencePostureReport,
  GaTargetPreflightCheck,
  GaTargetPreflightGateEvidence,
} from "./ga-evidence-types";
import {
  emptyBundleCheckSummary,
  emptyBundleInventory,
  emptyBundleRequirements,
  emptyPreflightSummary,
  emptyTargetExecutionEnvFile,
  emptyTargetExecutionRun,
  emptyTargetExecutionSummary,
  emptyTargetPlanSummary,
} from "./ga-evidence-defaults";
import { safeBundleRedaction } from "./ga-evidence-execution-sanitizers";
import { safeToken } from "./ga-evidence-sanitize-support";

export function buildLiveGateReadiness(input: {
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

export function invalidTargetPreflight(
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

export function invalidTargetPlan(
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

export function invalidTargetExecution(
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

export function invalidBundle(
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
