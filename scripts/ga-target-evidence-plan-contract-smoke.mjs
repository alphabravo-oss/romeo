import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { collectGaTargetEvidencePlan } from "./lib/ga-target-evidence-plan.mjs";

const outputPath = argValue("--output");
const tempDir = mkdtempSync(join(tmpdir(), "romeo-ga-target-plan-"));
const originalCwd = process.cwd();
const secretSentinels = [
  "SECRET_INLINE_API_KEY",
  "SECRET_RAW_CONTEXT",
  "SECRET_RAW_NOTE",
  "SECRET_RAW_PATH",
  "SECRET_RAW_OUTPUT",
  "SECRET_TOKEN_VALUE",
];

try {
  process.chdir(tempDir);
  writeJson("dist/ci/ga-target-preflight.json", preflightFixture());

  const plan = collectGaTargetEvidencePlan({
    preflightPath: "dist/ci/ga-target-preflight.json",
  });

  assertEqual(plan.schemaVersion, "romeo.ga-target-evidence-plan.v1", "schema");
  assertEqual(plan.status, "blocked", "plan status");
  assertEqual(plan.summary.total, 3, "gate count");
  assertEqual(plan.summary.blocked, 2, "blocked gate count");
  assertEqual(plan.summary.ready, 1, "ready gate count");
  assertEqual(plan.summary.phaseCount, 3, "phase count");
  assertEqual(plan.phases[0]?.phase, "21", "first phase");
  assertEqual(plan.phases[0]?.blocked, 1, "phase 21 blocked count");
  assertEqual(plan.phases[1]?.phase, "22", "second phase");
  assertEqual(plan.gates[0]?.order, 1, "gate order");
  assertEqual(
    plan.gates[0]?.requiredEnvironment.includes("ROMEO_API_KEY"),
    true,
    "required env extracted",
  );
  assertEqual(
    plan.gates[0]?.requiredCommands.includes("kubectl"),
    true,
    "required command extracted",
  );
  assertEqual(
    plan.gates[0]?.evidenceTargets[0]?.path,
    "redacted_path",
    "unsafe evidence path redacted",
  );
  assertEqual(
    plan.gates[0]?.checks.blockedReasons.includes("cluster_unreachable"),
    true,
    "blocked reason summarized",
  );
  assertEqual(
    plan.gates[0]?.operatorAction.state,
    "blocked_on_prerequisites",
    "blocked gate action",
  );
  assertEqual(
    plan.gates[0]?.operatorAction.prerequisiteBlocked,
    true,
    "blocked gate prerequisite flag",
  );
  assertEqual(
    plan.gates[1]?.anyOfEnvironment[0]?.includes("NPM_TOKEN"),
    true,
    "any-of env extracted",
  );
  assertEqual(
    plan.gates[1]?.operatorAction.state,
    "ready_to_run",
    "ready gate action",
  );
  assertEqual(
    plan.gates[1]?.operatorAction.commandAvailable,
    true,
    "ready gate command availability",
  );
  assertEqual(
    plan.gates[2]?.commandRedacted,
    true,
    "unsafe inline credential command redacted",
  );
  assertEqual(
    plan.gates[2]?.operatorAction.state,
    "command_redacted",
    "redacted command action",
  );
  assertEqual(
    plan.gates[2]?.operatorAction.blockedReasonCodes.includes(
      "base_url_missing",
    ),
    true,
    "redacted command blocked reason",
  );
  assertRedacted(plan);

  if (outputPath !== undefined) {
    const resolved = resolve(originalCwd, outputPath);
    mkdirSync(dirname(resolved), { recursive: true });
    writeFileSync(resolved, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    console.log(`Wrote GA target evidence plan contract smoke to ${resolved}`);
  } else {
    console.log(JSON.stringify(plan, null, 2));
  }
} finally {
  process.chdir(originalCwd);
  rmSync(tempDir, { recursive: true, force: true });
}

function preflightFixture() {
  return {
    schemaVersion: "romeo.ga-target-preflight.v1",
    generatedAt: "2026-07-06T00:00:00.000Z",
    status: "blocked",
    checklist: {
      path: "/tmp/SECRET_RAW_PATH/checklist.json",
      schemaVersion: "romeo.ga-checklist.v1",
      status: "blocked",
      summary: {
        total: 3,
        satisfied: 1,
        excepted: 0,
        blocked: 2,
        environmentRequired: 2,
        securityCriticalBlocked: 1,
      },
    },
    summary: {
      total: 3,
      ready: 1,
      blocked: 2,
      securityCriticalBlocked: 1,
    },
    gates: [
      {
        id: "phase21.kubernetes_networkpolicy_enforcement",
        phase: "21",
        title: "Kubernetes NetworkPolicy CNI enforcement",
        status: "blocked",
        environmentRequired: true,
        securityCritical: true,
        evidence: [
          {
            path: "/tmp/SECRET_RAW_PATH/kubernetes-networkpolicy.json",
            status: "missing",
          },
        ],
        command:
          "KUBERNETES_NETWORKPOLICY_CONFIRM_CNI_ENFORCEMENT=true pnpm smoke:kubernetes:networkpolicy -- --output dist/ci/kubernetes-networkpolicy-smoke.json",
        checks: [
          { name: "command:kubectl", status: "ready" },
          {
            name: "env:ROMEO_API_KEY",
            status: "blocked",
            configured: false,
            rawValue: "SECRET_TOKEN_VALUE",
          },
          {
            name: "kubernetes_cluster",
            status: "blocked",
            reason: "cluster_unreachable",
            context: "SECRET_RAW_CONTEXT",
          },
          {
            name: "file:dist/release/release-manifest.json",
            status: "blocked",
            path: "/tmp/SECRET_RAW_PATH/release-manifest.json",
          },
        ],
        notes: [
          "Run from the operator network only.",
          "Do not return SECRET_RAW_NOTE.",
        ],
      },
      {
        id: "phase22.credentialed_release_readback",
        phase: "22",
        title: "Credentialed release readback",
        status: "ready",
        environmentRequired: true,
        securityCritical: false,
        evidence: [
          {
            path: "dist/release/readback-validation.json",
            status: "ready",
          },
        ],
        command:
          "pnpm release:readback-collect -- --readback-plan-file $RELEASE_READBACK_PLAN_FILE --output dist/release/release-readback.json",
        checks: [
          { name: "env_any:NPM_TOKEN|NODE_AUTH_TOKEN", status: "ready" },
          { name: "env:RELEASE_READBACK_PLAN_FILE", status: "ready" },
          {
            name: "env:RELEASE_ASSET_TOKEN",
            status: "optional",
            configured: false,
          },
        ],
        notes: ["Release readback must use credentialed package evidence."],
      },
      {
        id: "phase33.live_edge_enforcement",
        phase: "33",
        title: "Live edge enforcement",
        status: "blocked",
        environmentRequired: true,
        securityCritical: false,
        evidence: [],
        command:
          "ROMEO_API_KEY=SECRET_INLINE_API_KEY pnpm smoke:edge:live -- --output dist/ci/live-edge-enforcement.json",
        checks: [
          {
            name: "target_api",
            status: "blocked",
            reason: "base_url_missing",
          },
        ],
        notes: [],
      },
    ],
    redaction: {
      commandOutputReturned: false,
      rawEnvironmentValuesReturned: false,
      rawTokensReturned: false,
      rawEvidenceBodiesReturned: false,
      unsafeAbsoluteEvidencePathsReturned: false,
    },
    rawCommandOutput: "SECRET_RAW_OUTPUT",
  };
}

function assertRedacted(value) {
  const serialized = JSON.stringify(value);
  for (const sentinel of secretSentinels) {
    if (serialized.includes(sentinel)) {
      throw new Error(`Plan leaked ${sentinel}.`);
    }
  }
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

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}
