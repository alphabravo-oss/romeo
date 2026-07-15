import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { loadGaTargetEnvFile } from "./ga-target-env-file.mjs";

export const defaultTargetPlanPath = "dist/ci/ga-target-evidence-plan.json";

export function executeGaTargetPlan(config = {}) {
  const planPath = config.planPath ?? defaultTargetPlanPath;
  const plan = readPlan(planPath);
  const gateIds = new Set(asArray(config.gateIds).map(safeToken));
  const selectedGates = asArray(plan.gates).filter(
    (gate) => gateIds.size === 0 || gateIds.has(safeToken(gate.id)),
  );
  const confirm = config.confirm === true;
  const timeoutMs = boundedTimeoutMs(config.timeoutMs);
  const continueOnFailure = config.continueOnFailure === true;
  const envFile = loadGaTargetEnvFile(config.envFilePath);
  const startedAt = new Date().toISOString();
  const results = [];

  for (const gate of selectedGates) {
    const result = executeGate(gate, {
      confirm,
      timeoutMs,
      env: envFile.env,
    });
    results.push(result);
    if (result.executionStatus === "failed" && !continueOnFailure) break;
  }

  const completedAt = new Date().toISOString();
  const summary = summarize(selectedGates, results);
  return {
    schemaVersion: "romeo.ga-target-execution.v1",
    generatedAt: completedAt,
    status: executionStatus(summary),
    source: {
      targetPlanPath: safeEvidencePath(planPath),
      targetPlanSchemaVersion: safeToken(plan.schemaVersion),
      targetPlanStatus: safeToken(plan.status),
      checklist: sanitizeChecklist(plan.source?.checklist),
    },
    execution: {
      startedAt,
      completedAt,
      confirmed: confirm,
      continueOnFailure,
      timeoutMs,
      selectedGateCount: selectedGates.length,
      commandsExecuted: summary.executed,
    },
    envFile: envFile.evidence,
    summary,
    gates: results,
    executionPolicy: {
      readyGatesOnly: true,
      blockedGatesSkipped: true,
      redactedCommandsSkipped: true,
      explicitConfirmationRequired: true,
      commandOutputCaptured: false,
      commandOutputStored: false,
      commandTextStored: false,
      shellExecution: true,
      envFileShellSourced: false,
      blankEnvFileValuesApplied: false,
    },
    redaction: {
      commandTextReturned: false,
      commandOutputReturned: false,
      rawEnvironmentValuesReturned: false,
      rawEnvFileValuesReturned: false,
      rawEnvFileBodyReturned: false,
      rawTokensReturned: false,
      rawEvidenceBodiesReturned: false,
      unsafeAbsoluteEvidencePathsReturned: false,
      rawTargetPlanCheckBodiesReturned: false,
    },
  };
}

function executeGate(gate, options) {
  const startedAt = new Date().toISOString();
  const command = typeof gate.command === "string" ? gate.command : undefined;
  const commandHash = command === undefined ? undefined : sha256(command);
  const base = {
    id: safeToken(gate.id),
    phase: safeToken(gate.phase),
    title: safeString(gate.title, "Untitled gate", 180),
    targetStatus: gate.status === "ready" ? "ready" : "blocked",
    operatorActionState: safeToken(gate.operatorAction?.state),
    commandHash,
    commandAvailable: command !== undefined,
    commandRedacted: gate.commandRedacted === true,
    evidenceTargets: asArray(gate.evidenceTargets).map(sanitizeEvidenceTarget),
    blockedReasonCodes: asArray(gate.operatorAction?.blockedReasonCodes).map(
      safeToken,
    ),
  };

  if (!gateReadyToRun(gate, command)) {
    return {
      ...base,
      executionStatus: "skipped",
      skippedReason: skipReason(gate, command),
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: 0,
    };
  }

  if (!options.confirm) {
    return {
      ...base,
      executionStatus: "skipped",
      skippedReason: "confirmation_required",
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: 0,
    };
  }

  const startMs = Date.now();
  process.stdout.write(`Executing GA target gate ${base.id}\n`);
  const result = spawnSync(command, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    shell: true,
    stdio: ["ignore", "ignore", "ignore"],
    timeout: options.timeoutMs,
  });
  const completedAt = new Date().toISOString();
  const durationMs = Math.max(0, Date.now() - startMs);
  if (result.status === 0) {
    process.stdout.write(`GA target gate ${base.id} passed\n`);
    return {
      ...base,
      executionStatus: "passed",
      exitCode: 0,
      startedAt,
      completedAt,
      durationMs,
    };
  }

  const failureReason =
    result.error?.code === "ETIMEDOUT"
      ? "timed_out"
      : result.error === undefined
        ? "exit_nonzero"
        : "spawn_error";
  process.stdout.write(`GA target gate ${base.id} failed: ${failureReason}\n`);
  return {
    ...base,
    executionStatus: "failed",
    failureReason,
    exitCode:
      Number.isInteger(result.status) && result.status !== null
        ? result.status
        : undefined,
    signal:
      typeof result.signal === "string" ? safeToken(result.signal) : undefined,
    startedAt,
    completedAt,
    durationMs,
  };
}

function gateReadyToRun(gate, command) {
  return (
    gate.status === "ready" &&
    gate.commandRedacted !== true &&
    gate.operatorAction?.state === "ready_to_run" &&
    command !== undefined
  );
}

function skipReason(gate, command) {
  if (gate.commandRedacted === true) return "command_redacted";
  if (command === undefined) return "command_missing";
  if (gate.status !== "ready") return "preflight_not_ready";
  if (gate.operatorAction?.state !== "ready_to_run") {
    return "operator_action_not_ready";
  }
  return "not_ready";
}

function readPlan(path) {
  const resolved = resolve(process.cwd(), path);
  if (!existsSync(resolved)) {
    throw new Error(
      `GA target evidence plan not found at ${path}. Run pnpm ga:target-plan -- --output ${path} first.`,
    );
  }
  const parsed = JSON.parse(readFileSync(resolved, "utf8"));
  if (
    !isRecord(parsed) ||
    parsed.schemaVersion !== "romeo.ga-target-evidence-plan.v1"
  ) {
    throw new Error(
      `GA target evidence plan at ${path} must use schema romeo.ga-target-evidence-plan.v1.`,
    );
  }
  return parsed;
}

function summarize(selectedGates, results) {
  return {
    total: selectedGates.length,
    readyToRun: selectedGates.filter((gate) =>
      gateReadyToRun(
        gate,
        typeof gate.command === "string" ? gate.command : undefined,
      ),
    ).length,
    executed: results.filter((gate) =>
      ["failed", "passed"].includes(gate.executionStatus),
    ).length,
    passed: results.filter((gate) => gate.executionStatus === "passed").length,
    failed: results.filter((gate) => gate.executionStatus === "failed").length,
    skipped: results.filter((gate) => gate.executionStatus === "skipped")
      .length,
    confirmationRequired: results.filter(
      (gate) => gate.skippedReason === "confirmation_required",
    ).length,
    blocked: results.filter(
      (gate) => gate.skippedReason === "preflight_not_ready",
    ).length,
    redacted: results.filter(
      (gate) => gate.skippedReason === "command_redacted",
    ).length,
    commandMissing: results.filter(
      (gate) => gate.skippedReason === "command_missing",
    ).length,
  };
}

function executionStatus(summary) {
  if (summary.failed > 0) return "failed";
  if (summary.executed > 0 && summary.skipped > 0) return "partial";
  if (summary.executed > 0) return "passed";
  if (summary.confirmationRequired > 0) return "not_run";
  return "blocked";
}

function sanitizeChecklist(input) {
  const checklist = isRecord(input) ? input : {};
  return {
    status: safeToken(checklist.status),
    schemaVersion: safeToken(checklist.schemaVersion),
    summary: {
      total: safeCount(checklist.summary?.total),
      satisfied: safeCount(checklist.summary?.satisfied),
      excepted: safeCount(checklist.summary?.excepted),
      blocked: safeCount(checklist.summary?.blocked),
      environmentRequired: safeCount(checklist.summary?.environmentRequired),
      securityCriticalBlocked: safeCount(
        checklist.summary?.securityCriticalBlocked,
      ),
    },
  };
}

function sanitizeEvidenceTarget(input) {
  const target = isRecord(input) ? input : {};
  return {
    path: safeEvidencePath(target.path),
    status: safeToken(target.status),
    schemaVersion: safeToken(target.schemaVersion),
  };
}

function boundedTimeoutMs(input) {
  const value = Number(input ?? process.env.GA_TARGET_EXECUTE_TIMEOUT_MS);
  if (!Number.isInteger(value)) return 60 * 60 * 1000;
  return Math.min(Math.max(value, 1_000), 24 * 60 * 60 * 1000);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeEvidencePath(input) {
  if (typeof input !== "string" || input.length === 0) return "unknown";
  if (isAbsolute(input) || input.includes("..") || input.includes("\\")) {
    return "redacted_path";
  }
  return safeString(input, "redacted_path", 240);
}

function safeString(input, fallback, maxLength = 160) {
  if (typeof input !== "string" || input.length === 0) return fallback;
  const pattern = new RegExp(`^[A-Za-z0-9 _./:@,()'\\-]{1,${maxLength}}$`, "u");
  if (!pattern.test(input)) return fallback;
  return input;
}

function safeToken(input) {
  if (typeof input !== "string" || input.length === 0) return "unknown";
  if (!/^[A-Za-z0-9_.:-]{1,180}$/u.test(input)) return "unknown";
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
