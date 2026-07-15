import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export const defaultTargetPreflightPath = "dist/ci/ga-target-preflight.json";

export function collectGaTargetEvidencePlan(config = {}) {
  const preflightPath = config.preflightPath ?? defaultTargetPreflightPath;
  const preflight = readPreflight(preflightPath);
  const gates = asArray(preflight.gates).map(planGate);
  const phases = planPhases(gates);
  const summary = summarize(gates, phases);
  return {
    schemaVersion: "romeo.ga-target-evidence-plan.v1",
    generatedAt: new Date().toISOString(),
    status: summary.blocked === 0 ? "ready" : "blocked",
    source: {
      preflightPath: safeEvidencePath(preflightPath),
      preflightSchemaVersion: safeToken(preflight.schemaVersion),
      preflightStatus:
        preflight.status === "ready" || preflight.status === "blocked"
          ? preflight.status
          : "unknown",
      checklist: sanitizePreflightChecklist(preflight.checklist),
    },
    summary,
    phases,
    gates,
    executionPolicy: {
      planOnly: true,
      commandsExecuted: false,
      preflightRequiredBeforeExecution: true,
      liveEvidenceStillRequired: true,
      manualTargetExecutionOnly: true,
    },
    redaction: {
      commandOutputReturned: false,
      rawEnvironmentValuesReturned: false,
      rawTokensReturned: false,
      rawEvidenceBodiesReturned: false,
      unsafeAbsoluteEvidencePathsReturned: false,
      rawPreflightCheckBodiesReturned: false,
    },
  };
}

function readPreflight(path) {
  const resolved = resolve(process.cwd(), path);
  if (!existsSync(resolved)) {
    throw new Error(
      `GA target preflight not found at ${path}. Run pnpm ga:target-preflight -- --output ${path} first.`,
    );
  }
  const parsed = JSON.parse(readFileSync(resolved, "utf8"));
  if (
    !isRecord(parsed) ||
    parsed.schemaVersion !== "romeo.ga-target-preflight.v1"
  ) {
    throw new Error(
      `GA target preflight at ${path} must use schema romeo.ga-target-preflight.v1.`,
    );
  }
  return parsed;
}

function planGate(input, index) {
  const gate = isRecord(input) ? input : {};
  const checks = asArray(gate.checks).map(sanitizeCheck);
  const command = sanitizeCommand(gate.command);
  const status =
    gate.status === "blocked" || gate.status === "ready"
      ? gate.status
      : "unknown";
  const checkSummary = summarizeChecks(checks);
  return {
    order: index + 1,
    id: safeToken(gate.id),
    phase: safeToken(gate.phase),
    title: safeString(gate.title, "Untitled gate"),
    status,
    environmentRequired: gate.environmentRequired === true,
    securityCritical: gate.securityCritical === true,
    ...(command.value === undefined ? {} : { command: command.value }),
    commandRedacted: command.redacted,
    operatorAction: operatorAction({
      status,
      commandAvailable: command.value !== undefined,
      commandRedacted: command.redacted,
      checks: checkSummary,
    }),
    evidenceTargets: asArray(gate.evidence).map(sanitizeEvidence),
    requiredCommands: checks
      .filter((check) => check.name.startsWith("command:"))
      .map((check) => check.name.slice("command:".length)),
    requiredEnvironment: checks
      .filter(
        (check) => check.name.startsWith("env:") && check.status !== "optional",
      )
      .map((check) => check.name.slice("env:".length)),
    anyOfEnvironment: checks
      .filter((check) => check.name.startsWith("env_any:"))
      .map((check) => check.name.slice("env_any:".length).split("|")),
    optionalEnvironment: checks
      .filter(
        (check) => check.name.startsWith("env:") && check.status === "optional",
      )
      .map((check) => check.name.slice("env:".length)),
    requiredFiles: checks
      .filter((check) => check.name.startsWith("file:"))
      .map((check) => safeEvidencePath(check.name.slice("file:".length))),
    checks: checkSummary,
    blockedChecks: checks
      .filter((check) => check.status === "blocked")
      .map((check) => ({
        name: check.name,
        reason: check.reason ?? `${check.name}_blocked`,
        ...(typeof check.configured === "boolean"
          ? { configured: check.configured }
          : {}),
      })),
    notes: asArray(gate.notes)
      .map((note) => safeNote(note))
      .filter((note) => note.length > 0),
  };
}

function operatorAction(input) {
  let state = "unknown";
  if (input.commandRedacted) {
    state = "command_redacted";
  } else if (input.status === "blocked") {
    state = "blocked_on_prerequisites";
  } else if (input.status === "ready" && input.commandAvailable) {
    state = "ready_to_run";
  }
  return {
    state,
    commandAvailable: input.commandAvailable,
    prerequisiteBlocked: input.checks.blocked > 0,
    blockedReasonCodes: input.checks.blockedReasons,
  };
}

function planPhases(gates) {
  const byPhase = new Map();
  for (const gate of gates) {
    const current = byPhase.get(gate.phase) ?? {
      phase: gate.phase,
      status: "ready",
      total: 0,
      ready: 0,
      blocked: 0,
      securityCriticalBlocked: 0,
      gateIds: [],
    };
    current.total += 1;
    current.gateIds.push(gate.id);
    if (gate.status === "ready") current.ready += 1;
    if (gate.status === "blocked") {
      current.blocked += 1;
      current.status = "blocked";
      if (gate.securityCritical) current.securityCriticalBlocked += 1;
    }
    byPhase.set(gate.phase, current);
  }
  return [...byPhase.values()].sort((left, right) =>
    left.phase.localeCompare(right.phase, "en", { numeric: true }),
  );
}

function summarize(gates, phases) {
  return {
    total: gates.length,
    ready: gates.filter((gate) => gate.status === "ready").length,
    blocked: gates.filter((gate) => gate.status === "blocked").length,
    environmentRequired: gates.filter((gate) => gate.environmentRequired)
      .length,
    securityCriticalBlocked: gates.filter(
      (gate) => gate.status === "blocked" && gate.securityCritical,
    ).length,
    phaseCount: phases.length,
    commandCount: gates.filter((gate) => gate.command !== undefined).length,
    evidenceTargetCount: gates.reduce(
      (sum, gate) => sum + gate.evidenceTargets.length,
      0,
    ),
    blockedCheckCount: gates.reduce(
      (sum, gate) => sum + gate.checks.blocked,
      0,
    ),
  };
}

function summarizeChecks(checks) {
  const blockedReasons = [
    ...new Set(
      checks
        .filter((check) => check.status === "blocked")
        .map((check) => check.reason ?? `${check.name}_blocked`),
    ),
  ].sort();
  return {
    total: checks.length,
    ready: checks.filter((check) => check.status === "ready").length,
    blocked: checks.filter((check) => check.status === "blocked").length,
    optional: checks.filter((check) => check.status === "optional").length,
    unknown: checks.filter((check) => check.status === "unknown").length,
    blockedReasons,
  };
}

function sanitizePreflightChecklist(input) {
  const checklist = isRecord(input) ? input : {};
  return {
    status: safeToken(checklist.status),
    ...(typeof checklist.schemaVersion === "string"
      ? { schemaVersion: safeToken(checklist.schemaVersion) }
      : {}),
    summary: sanitizeChecklistSummary(checklist.summary),
  };
}

function sanitizeChecklistSummary(input) {
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

function sanitizeEvidence(input) {
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

function sanitizeCheck(input) {
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
  };
}

function sanitizeCommand(input) {
  if (typeof input !== "string" || input.length === 0) {
    return { redacted: true };
  }
  if (input.length > 1_600 || /[\n\r\0]/u.test(input)) {
    return { redacted: true };
  }
  if (hasUnsafeInlineCredentialAssignment(input)) {
    return { redacted: true };
  }
  if (!/^[A-Za-z0-9 _./:@$,=&?|+-]{1,1600}$/u.test(input)) {
    return { redacted: true };
  }
  return { value: input, redacted: false };
}

function hasUnsafeInlineCredentialAssignment(value) {
  const assignments = value.match(
    /\b[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY)[A-Z0-9_]*=[^\s]+/giu,
  );
  if (assignments === null) return false;
  return assignments.some((assignment) => {
    const [, assigned = ""] = assignment.split("=");
    return !assigned.startsWith("$");
  });
}

function safeEvidencePath(input) {
  if (typeof input !== "string" || input.length === 0) return "unknown";
  if (isAbsolute(input) || input.includes("..") || input.includes("\\")) {
    return "redacted_path";
  }
  return safeString(input, "redacted_path");
}

function safeCheckName(input) {
  if (typeof input !== "string" || input.length === 0) return "unknown";
  if (!/^[A-Za-z0-9:._|/-]{1,180}$/u.test(input)) return "redacted_check";
  return input;
}

function safeNote(input) {
  if (typeof input !== "string" || input.length === 0) return "";
  if (/(SECRET_|TOKEN|PASSWORD|PRIVATE_KEY|BEGIN\s+RSA)/iu.test(input)) {
    return "redacted_note";
  }
  return safeString(input, "redacted_note", 500);
}

function safeString(input, fallback, maxLength = 160) {
  if (typeof input !== "string" || input.length === 0) return fallback;
  const pattern = new RegExp(`^[A-Za-z0-9 _./:@,()'\\-]{1,${maxLength}}$`, "u");
  if (!pattern.test(input)) return fallback;
  return input;
}

function safeToken(input) {
  if (typeof input !== "string" || input.length === 0) return "unknown";
  if (!/^[A-Za-z0-9_.:-]{1,160}$/u.test(input)) return "unknown";
  return input;
}

function safeCount(input) {
  return Number.isInteger(input) && input >= 0 ? input : 0;
}

function asArray(input) {
  return Array.isArray(input) ? input : [];
}

function isRecord(input) {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
