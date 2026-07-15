import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { executeGaTargetPlan } from "./lib/ga-target-execution.mjs";

const outputPath = argValue("--output");
const tempDir = mkdtempSync(join(tmpdir(), "romeo-ga-target-execution-"));
const originalCwd = process.cwd();
const secretSentinels = [
  "SECRET_RAW_COMMAND_VALUE",
  "SECRET_RAW_OUTPUT_VALUE",
  "SECRET_RAW_ENV_VALUE",
  "SECRET_RAW_PATH_VALUE",
];

try {
  process.chdir(tempDir);
  writeJson("dist/ci/ga-target-evidence-plan.json", planFixture());
  writeFileSync(
    "dist/ci/ga-target.env.private",
    [
      "# Synthetic private target env file",
      "GA_TARGET_EXECUTION_SMOKE_SECRET=SECRET_RAW_ENV_VALUE",
      "GA_TARGET_EXECUTION_BLANK_PLACEHOLDER=",
      "",
    ].join("\n"),
    "utf8",
  );

  const dry = executeGaTargetPlan({
    planPath: "dist/ci/ga-target-evidence-plan.json",
  });
  assertEqual(dry.status, "not_run", "dry execution status");
  assertEqual(dry.summary.readyToRun, 2, "dry ready-to-run count");
  assertEqual(dry.summary.confirmationRequired, 2, "ready gate confirmation");
  assertEqual(dry.summary.executed, 0, "dry commands executed");

  const executed = executeGaTargetPlan({
    planPath: "dist/ci/ga-target-evidence-plan.json",
    confirm: true,
    continueOnFailure: true,
    envFilePath: "dist/ci/ga-target.env.private",
  });
  assertEqual(executed.status, "failed", "failed execution status");
  assertEqual(executed.summary.readyToRun, 2, "executed ready-to-run count");
  assertEqual(executed.summary.executed, 2, "executed gate count");
  assertEqual(executed.summary.passed, 1, "passed gate count");
  assertEqual(executed.summary.failed, 1, "failed gate count");
  assertEqual(executed.summary.blocked, 1, "blocked gate skipped");
  assertEqual(executed.summary.redacted, 1, "redacted gate skipped");
  assertEqual(
    executed.gates.some((gate) => gate.commandHash?.length === 64),
    true,
    "command hashes stored",
  );
  assertEqual(executed.envFile.configured, true, "env file configured");
  assertEqual(
    executed.envFile.populatedVariableCount,
    1,
    "populated env count",
  );
  assertEqual(executed.envFile.blankVariableCount, 1, "blank env count");
  assertEqual(executed.envFile.rawValuesReturned, false, "env values redacted");
  assertEqual(executed.envFile.rawFileBodyReturned, false, "env body redacted");
  assertRedacted(executed);

  const report = contractReport({ dry, executed });
  if (outputPath !== undefined) {
    const resolved = resolve(originalCwd, outputPath);
    mkdirSync(dirname(resolved), { recursive: true });
    writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`Wrote GA target execution contract smoke to ${resolved}`);
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
} finally {
  process.chdir(originalCwd);
  rmSync(tempDir, { recursive: true, force: true });
}

function contractReport({ dry, executed }) {
  return {
    schemaVersion: "romeo.ga-target-execution-contract-smoke.v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    checks: [
      "confirmation_required_without_explicit_approval",
      "private_env_file_loaded_without_raw_values",
      "ready_gate_execution_pass_and_failure_accounting",
      "blocked_gate_skipped",
      "redacted_command_skipped",
      "command_hashes_stored_without_command_text",
      "command_output_not_captured",
      "secret_sentinels_redacted",
    ],
    dryRun: {
      status: dry.status,
      summary: dry.summary,
      executionPolicy: dry.executionPolicy,
      redaction: dry.redaction,
    },
    executionFixture: {
      status: executed.status,
      summary: executed.summary,
      envFile: executed.envFile,
      gates: executed.gates.map((gate) => ({
        id: gate.id,
        executionStatus: gate.executionStatus,
        skippedReason: gate.skippedReason,
        failureReason: gate.failureReason,
        commandHashPresent: typeof gate.commandHash === "string",
        exitCode: gate.exitCode,
      })),
      executionPolicy: executed.executionPolicy,
      redaction: executed.redaction,
    },
  };
}

function planFixture() {
  return {
    schemaVersion: "romeo.ga-target-evidence-plan.v1",
    generatedAt: "2026-07-07T00:00:00.000Z",
    status: "blocked",
    source: {
      preflightPath: "dist/ci/ga-target-preflight.json",
      preflightSchemaVersion: "romeo.ga-target-preflight.v1",
      preflightStatus: "blocked",
      checklist: {
        status: "blocked",
        schemaVersion: "romeo.ga-checklist.v1",
        summary: {
          total: 4,
          satisfied: 0,
          excepted: 0,
          blocked: 4,
          environmentRequired: 4,
          securityCriticalBlocked: 1,
        },
      },
    },
    gates: [
      gate({
        id: "phase21.kubernetes_live_smoke",
        status: "ready",
        command:
          'node -e "process.exit(process.env.GA_TARGET_EXECUTION_SMOKE_SECRET ? 0 : 1)"',
        operatorAction: {
          state: "ready_to_run",
          commandAvailable: true,
          prerequisiteBlocked: false,
          blockedReasonCodes: [],
        },
      }),
      gate({
        id: "phase34.live_alert_firing",
        status: "ready",
        command: "node --bad-option",
        operatorAction: {
          state: "ready_to_run",
          commandAvailable: true,
          prerequisiteBlocked: false,
          blockedReasonCodes: [],
        },
      }),
      gate({
        id: "phase33.live_edge_enforcement",
        status: "blocked",
        command: "node --version",
        operatorAction: {
          state: "blocked_on_prerequisites",
          commandAvailable: true,
          prerequisiteBlocked: true,
          blockedReasonCodes: ["base_url_missing"],
        },
      }),
      gate({
        id: "phase22.credentialed_release_readback",
        status: "ready",
        command: "SECRET_RAW_COMMAND_VALUE=SECRET_TOKEN_VALUE node --version",
        commandRedacted: true,
        operatorAction: {
          state: "command_redacted",
          commandAvailable: false,
          prerequisiteBlocked: true,
          blockedReasonCodes: ["command_redacted"],
        },
      }),
    ],
  };
}

function gate(input) {
  return {
    order: 1,
    id: input.id,
    phase: input.id.slice(5, 7),
    title: "Synthetic gate",
    status: input.status,
    environmentRequired: true,
    securityCritical: false,
    command: input.command,
    commandRedacted: input.commandRedacted === true,
    operatorAction: input.operatorAction,
    evidenceTargets: [
      {
        path: "dist/ci/synthetic-evidence.json",
        status: "missing",
        schemaVersion: "romeo.synthetic.v1",
      },
    ],
    requiredCommands: ["node"],
    requiredEnvironment: ["SECRET_RAW_ENV"],
    anyOfEnvironment: [],
    optionalEnvironment: [],
    requiredFiles: [],
    checks: {
      total: 1,
      ready: input.status === "ready" ? 1 : 0,
      blocked: input.status === "ready" ? 0 : 1,
      optional: 0,
      unknown: 0,
      blockedReasons: input.status === "ready" ? [] : ["base_url_missing"],
    },
    blockedChecks: [],
    notes: ["Synthetic gate fixture."],
  };
}

function writeJson(path, value) {
  const resolved = resolve(process.cwd(), path);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function assertRedacted(value) {
  const serialized = JSON.stringify(value);
  for (const sentinel of secretSentinels) {
    if (serialized.includes(sentinel)) {
      throw new Error(`Execution evidence leaked sentinel ${sentinel}.`);
    }
  }
  if (serialized.includes("node --version")) {
    throw new Error("Execution evidence leaked raw command text.");
  }
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}
