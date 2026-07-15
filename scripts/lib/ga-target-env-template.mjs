import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export const defaultTargetPlanPath = "dist/ci/ga-target-evidence-plan.json";

export function collectGaTargetEnvTemplate(config = {}) {
  const planPath = config.planPath ?? defaultTargetPlanPath;
  const plan = readPlan(planPath);
  const gates = asArray(plan.gates).map(sanitizeGate);
  const requirements = collectRequirements(gates);
  const summary = summarize(gates, requirements);
  return {
    schemaVersion: "romeo.ga-target-env-template.v1",
    generatedAt: new Date().toISOString(),
    status: "generated",
    source: {
      targetPlanPath: safeEvidencePath(planPath),
      targetPlanSchemaVersion: safeToken(plan.schemaVersion),
      targetPlanStatus: safeToken(plan.status),
      checklist: sanitizeChecklist(plan.source?.checklist),
    },
    summary,
    requirements,
    gates,
    operatorGuidance: {
      valuesIncluded: false,
      populateInTargetEnvironmentOnly: true,
      runTargetPreflightAfterPopulation: true,
      runReadyGatesWithExplicitConfirmation: true,
    },
    redaction: {
      commandTextReturned: false,
      commandOutputReturned: false,
      rawEnvironmentValuesReturned: false,
      rawTokensReturned: false,
      rawEvidenceBodiesReturned: false,
      unsafeAbsoluteEvidencePathsReturned: false,
      rawTargetPlanCheckBodiesReturned: false,
    },
  };
}

export function formatGaTargetEnvExample(report) {
  const lines = [
    "# Romeo GA target environment template",
    "# Values are intentionally blank. Populate them only in the target evidence-collection environment.",
    "# Regenerate target preflight after setting values, then run confirmed ready gates.",
    "",
  ];
  appendVariableSection(
    lines,
    "Required environment",
    report.requirements.environment,
  );
  appendAnyOfSection(lines, report.requirements.anyOfEnvironment);
  appendVariableSection(
    lines,
    "Optional environment",
    report.requirements.optionalEnvironment,
  );
  return `${lines.join("\n").replace(/\n{3,}/gu, "\n\n")}\n`;
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

function sanitizeGate(input) {
  const gate = isRecord(input) ? input : {};
  return {
    id: safeToken(gate.id),
    phase: safeToken(gate.phase),
    title: safeString(gate.title, "Untitled gate"),
    status:
      gate.status === "blocked" || gate.status === "ready"
        ? gate.status
        : "unknown",
    operatorActionState: safeOperatorActionState(gate.operatorAction?.state),
    requiredCommands: uniqueSorted(
      asArray(gate.requiredCommands).map(safeToken),
    ),
    requiredEnvironment: uniqueSorted(
      asArray(gate.requiredEnvironment).map(safeToken),
    ),
    anyOfEnvironment: asArray(gate.anyOfEnvironment)
      .map((group) => uniqueSorted(asArray(group).map(safeToken)))
      .filter((group) => group.length > 0),
    optionalEnvironment: uniqueSorted(
      asArray(gate.optionalEnvironment).map(safeToken),
    ),
    requiredFiles: uniqueSorted(
      asArray(gate.requiredFiles).map(safeEvidencePath),
    ),
    evidenceTargets: asArray(gate.evidenceTargets).map(sanitizeEvidenceTarget),
    blockedReasonCodes: uniqueSorted(
      asArray(gate.operatorAction?.blockedReasonCodes).map(safeToken),
    ),
  };
}

function collectRequirements(gates) {
  const commands = mergeItems(gates, (gate) => gate.requiredCommands);
  const environment = mergeItems(gates, (gate) => gate.requiredEnvironment);
  const optionalEnvironment = mergeItems(
    gates,
    (gate) => gate.optionalEnvironment,
  );
  const files = mergeItems(gates, (gate) => gate.requiredFiles);
  const evidenceTargets = mergeItems(gates, (gate) =>
    gate.evidenceTargets.map((target) => target.path),
  );
  const blockerReasonCodes = mergeItems(
    gates,
    (gate) => gate.blockedReasonCodes,
  );
  const anyOfEnvironment = mergeGroups(gates);
  return {
    commands,
    environment,
    anyOfEnvironment,
    optionalEnvironment,
    files,
    evidenceTargets,
    blockerReasonCodes,
  };
}

function summarize(gates, requirements) {
  return {
    totalGates: gates.length,
    readyToRun: gates.filter(
      (gate) => gate.operatorActionState === "ready_to_run",
    ).length,
    blockedGates: gates.filter((gate) => gate.status === "blocked").length,
    requiredCommandCount: requirements.commands.length,
    requiredEnvironmentCount: requirements.environment.length,
    anyOfEnvironmentGroupCount: requirements.anyOfEnvironment.length,
    optionalEnvironmentCount: requirements.optionalEnvironment.length,
    requiredFileCount: requirements.files.length,
    evidenceTargetCount: requirements.evidenceTargets.length,
    blockerReasonCount: requirements.blockerReasonCodes.length,
  };
}

function mergeItems(gates, selectItems) {
  const byName = new Map();
  for (const gate of gates) {
    for (const name of selectItems(gate)) {
      const entry = byName.get(name) ?? { name, requiredBy: [] };
      entry.requiredBy.push(gate.id);
      byName.set(name, entry);
    }
  }
  return [...byName.values()]
    .map((entry) => ({
      name: entry.name,
      requiredBy: uniqueSorted(entry.requiredBy),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function mergeGroups(gates) {
  const byGroup = new Map();
  for (const gate of gates) {
    for (const group of gate.anyOfEnvironment) {
      const names = uniqueSorted(group);
      const key = names.join("|");
      const entry = byGroup.get(key) ?? { names, requiredBy: [] };
      entry.requiredBy.push(gate.id);
      byGroup.set(key, entry);
    }
  }
  return [...byGroup.values()]
    .map((entry) => ({
      names: entry.names,
      requiredBy: uniqueSorted(entry.requiredBy),
    }))
    .sort((left, right) =>
      left.names.join("|").localeCompare(right.names.join("|")),
    );
}

function appendVariableSection(lines, title, entries) {
  if (!Array.isArray(entries) || entries.length === 0) return;
  lines.push(`# ${title}`);
  for (const entry of entries) {
    lines.push(`# Required by: ${entry.requiredBy.join(", ")}`);
    lines.push(`${entry.name}=`);
  }
  lines.push("");
}

function appendAnyOfSection(lines, groups) {
  if (!Array.isArray(groups) || groups.length === 0) return;
  lines.push("# Any-of environment groups");
  for (const group of groups) {
    lines.push(`# Provide at least one of: ${group.names.join(", ")}`);
    lines.push(`# Required by: ${group.requiredBy.join(", ")}`);
    for (const name of group.names) lines.push(`${name}=`);
  }
  lines.push("");
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

function safeOperatorActionState(input) {
  return input === "blocked_on_prerequisites" ||
    input === "command_redacted" ||
    input === "ready_to_run"
    ? input
    : "unknown";
}

function safeEvidencePath(input) {
  if (typeof input !== "string" || input.length === 0) return "unknown";
  if (isAbsolute(input) || input.includes("..") || input.includes("\\")) {
    return "redacted_path";
  }
  return safeString(input, "redacted_path");
}

function safeString(input, fallback) {
  if (typeof input !== "string" || input.length === 0) return fallback;
  if (!/^[A-Za-z0-9 _./:@,()'\-]{1,180}$/u.test(input)) return fallback;
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

function uniqueSorted(values) {
  return [...new Set(values)].filter((value) => value !== "unknown").sort();
}

function asArray(input) {
  return Array.isArray(input) ? input : [];
}

function isRecord(input) {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
