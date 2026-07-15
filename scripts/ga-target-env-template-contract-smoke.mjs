import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  collectGaTargetEnvTemplate,
  formatGaTargetEnvExample,
} from "./lib/ga-target-env-template.mjs";

const outputPath = argValue("--output");
const envOutputPath = argValue("--env-output");
const tempDir = mkdtempSync(join(tmpdir(), "romeo-ga-target-env-template-"));
const originalCwd = process.cwd();
const secretSentinels = [
  "SECRET_RAW_COMMAND",
  "SECRET_RAW_OUTPUT",
  "SECRET_RAW_ENV",
  "SECRET_RAW_PATH",
  "SECRET_RAW_VALUE",
];

try {
  process.chdir(tempDir);
  writeJson("dist/ci/ga-target-evidence-plan.json", planFixture());

  const report = collectGaTargetEnvTemplate({
    planPath: "dist/ci/ga-target-evidence-plan.json",
  });
  const envExample = formatGaTargetEnvExample(report);

  assertEqual(
    report.schemaVersion,
    "romeo.ga-target-env-template.v1",
    "schema",
  );
  assertEqual(report.status, "generated", "status");
  assertEqual(report.summary.totalGates, 3, "gate count");
  assertEqual(report.summary.readyToRun, 1, "ready-to-run count");
  assertEqual(report.summary.requiredEnvironmentCount, 2, "required env count");
  assertEqual(report.summary.anyOfEnvironmentGroupCount, 1, "any-of count");
  assertEqual(report.summary.optionalEnvironmentCount, 1, "optional env count");
  assertEqual(report.requirements.commands[0]?.name, "kubectl", "command");
  assertEqual(
    report.requirements.environment.some(
      (item) => item.name === "ROMEO_API_KEY",
    ),
    true,
    "required env present",
  );
  assertEqual(
    report.requirements.anyOfEnvironment[0]?.names.includes("NPM_TOKEN"),
    true,
    "any-of env present",
  );
  assertEqual(
    report.requirements.files[0]?.name,
    "redacted_path",
    "unsafe required file redacted",
  );
  assertEqual(
    envExample.includes("ROMEO_API_KEY="),
    true,
    "env example required var",
  );
  assertEqual(
    envExample.includes("NODE_AUTH_TOKEN="),
    true,
    "env example any-of var",
  );
  assertRedacted(report);
  assertRedacted(envExample);
  if (envExample.includes("pnpm smoke:kubernetes:networkpolicy")) {
    throw new Error("Env example leaked raw command text.");
  }

  if (outputPath !== undefined) {
    const resolved = resolve(originalCwd, outputPath);
    mkdirSync(dirname(resolved), { recursive: true });
    writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`Wrote GA target env template contract smoke to ${resolved}`);
  } else {
    console.log(JSON.stringify(report, null, 2));
  }

  if (envOutputPath !== undefined) {
    const resolved = resolve(originalCwd, envOutputPath);
    mkdirSync(dirname(resolved), { recursive: true });
    writeFileSync(resolved, envExample, "utf8");
    console.log(`Wrote GA target env example contract smoke to ${resolved}`);
  }
} finally {
  process.chdir(originalCwd);
  rmSync(tempDir, { recursive: true, force: true });
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
          total: 3,
          satisfied: 1,
          excepted: 0,
          blocked: 2,
          environmentRequired: 2,
          securityCriticalBlocked: 1,
        },
      },
    },
    gates: [
      gate({
        id: "phase21.kubernetes_networkpolicy_enforcement",
        status: "blocked",
        action: "blocked_on_prerequisites",
        requiredCommands: ["kubectl"],
        requiredEnvironment: ["ROMEO_API_KEY"],
        requiredFiles: ["/tmp/SECRET_RAW_PATH/release-manifest.json"],
        blockedReasonCodes: ["cluster_unreachable"],
        evidenceTargets: [
          {
            path: "/tmp/SECRET_RAW_PATH/kubernetes-networkpolicy.json",
            status: "missing",
          },
        ],
      }),
      gate({
        id: "phase22.credentialed_release_readback",
        status: "ready",
        action: "ready_to_run",
        requiredEnvironment: ["RELEASE_READBACK_PLAN_FILE"],
        anyOfEnvironment: [["NPM_TOKEN", "NODE_AUTH_TOKEN"]],
        optionalEnvironment: ["RELEASE_ASSET_TOKEN"],
        evidenceTargets: [
          {
            path: "dist/release/readback-validation.json",
            status: "ready",
          },
        ],
      }),
      gate({
        id: "phase33.live_edge_enforcement",
        status: "blocked",
        action: "command_redacted",
        requiredEnvironment: ["ROMEO_API_KEY"],
        blockedReasonCodes: ["command_redacted"],
      }),
    ],
    rawCommand: "SECRET_RAW_COMMAND",
    rawOutput: "SECRET_RAW_OUTPUT",
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
    command:
      "pnpm smoke:kubernetes:networkpolicy -- --output SECRET_RAW_OUTPUT",
    commandRedacted: input.action === "command_redacted",
    operatorAction: {
      state: input.action,
      commandAvailable: input.action !== "command_redacted",
      prerequisiteBlocked: input.status === "blocked",
      blockedReasonCodes: input.blockedReasonCodes ?? [],
    },
    evidenceTargets: input.evidenceTargets ?? [],
    requiredCommands: input.requiredCommands ?? [],
    requiredEnvironment: input.requiredEnvironment ?? [],
    anyOfEnvironment: input.anyOfEnvironment ?? [],
    optionalEnvironment: input.optionalEnvironment ?? [],
    requiredFiles: input.requiredFiles ?? [],
    checks: {
      total: 1,
      ready: input.status === "ready" ? 1 : 0,
      blocked: input.status === "ready" ? 0 : 1,
      optional: 0,
      unknown: 0,
      blockedReasons: input.blockedReasonCodes ?? [],
    },
    blockedChecks: [],
    notes: ["SECRET_RAW_VALUE"],
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
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  for (const sentinel of secretSentinels) {
    if (serialized.includes(sentinel)) {
      throw new Error(`Target env template leaked sentinel ${sentinel}.`);
    }
  }
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}
