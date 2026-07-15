import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  argValue,
  assertComposeLogsRedacted,
  assertReadinessReady,
  baseUrl,
  cleanupComposeHarness,
  compose,
  createAdminApiKey,
  createComposeHarness,
  expectUnauthorizedMe,
  parsePositiveInteger,
  randomProjectName,
  repoPath,
  waitForHealth,
  writeComposeEnv,
} from "./lib/compose-smoke-support.mjs";
import {
  generateScaleFixtures,
  summarizeScaleFixtures,
} from "./lib/scale-fixtures.mjs";

const keep = process.argv.includes("--keep");
const output = argValue("--output");
const projectName =
  argValue("--project-name") ?? randomProjectName("romeo_scale_smoke");
const timeoutMs = parsePositiveInteger("--timeout-ms", 180000);
const tier = argValue("--tier") ?? "local";

const harness = await createComposeHarness({ projectName, timeoutMs });
let adminToken;
let fixtures;
let loadEvidence;

try {
  writeComposeEnv(harness, {
    devSeededLogin: true,
    toolOperationExecutionDriver: "http-fetch",
  });
  compose(harness, ["up", "-d", "--build", "app"]);
  await waitForHealth(harness);
  compose(harness, [
    "run",
    "--rm",
    "migrate",
    "pnpm",
    "seed:postgres",
    "--",
    "--confirm-development-seed",
  ]);

  adminToken = await createAdminApiKey(harness);
  writeComposeEnv(harness, {
    devSeededLogin: false,
    toolOperationExecutionDriver: "http-fetch",
  });
  compose(harness, ["up", "-d", "--force-recreate", "app"]);
  await waitForHealth(harness);
  await expectUnauthorizedMe(harness);
  await assertReadinessReady(harness, adminToken);

  fixtures = generateScaleFixtures({
    tier,
    seed: `${projectName}-scale-fixtures`,
  });
  const fixturePath = join(harness.tempDir, "scale-fixtures.json");
  const loadEvidencePath = join(harness.tempDir, "scale-load-smoke.json");
  writeFileSync(fixturePath, `${JSON.stringify(fixtures, null, 2)}\n`);

  runScaleLoadSmoke({
    fixturePath,
    loadEvidencePath,
    token: adminToken,
    url: baseUrl(harness, "/"),
  });
  loadEvidence = JSON.parse(readFile(loadEvidencePath));
  assertScaleLoadEvidence(loadEvidence, fixtures);

  await assertReadinessReady(harness, adminToken);
  assertComposeLogsRedacted(harness, [
    adminToken,
    harness.postgresPassword,
    harness.s3Secret,
    harness.sessionSecret,
    harness.webhookSigningKey,
    ...rawFixtureSentinels(fixtures),
  ]);

  writeEvidence({
    schemaVersion: "romeo.compose-scale-smoke.v1",
    generatedAt: new Date().toISOString(),
    projectName,
    tier,
    status: "passed",
    checks: [
      "compose_build_and_start",
      "migration_service",
      "explicit_development_seed",
      "secure_recreate_with_seeded_login_disabled",
      "unauthenticated_api_denied",
      "admin_readiness_ready",
      "scale_fixture_generation",
      "live_scale_load_smoke",
      "scale_fixture_raw_content_logs_redacted",
      "compose_logs_redacted",
    ],
    fixtureReport: summarizeScaleFixtures(fixtures),
    loadEvidence,
  });
} finally {
  if (!keep) {
    cleanupComposeHarness(harness);
  } else {
    process.stderr.write(
      `Keeping Compose project ${projectName} and env file ${harness.envPath} for inspection.\n`,
    );
  }
}

function writeEvidence(evidence) {
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (output === undefined) {
    process.stdout.write(serialized);
    return;
  }
  const outputPath = resolve(process.env.INIT_CWD ?? process.cwd(), output);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, serialized, "utf8");
  process.stderr.write(`Wrote scale Compose smoke evidence to ${outputPath}\n`);
}

function runScaleLoadSmoke({ fixturePath, loadEvidencePath, token, url }) {
  const result = spawnSync(
    "node",
    [
      "scripts/scale-load-smoke.mjs",
      "--fixture-file",
      fixturePath,
      "--base-url",
      url,
      "--api-key",
      token,
      "--output",
      loadEvidencePath,
    ],
    {
      cwd: repoPath("."),
      encoding: "utf8",
      timeout: timeoutMs,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `scale-load-smoke failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }
}

function assertScaleLoadEvidence(evidence, input) {
  if (
    evidence.schemaVersion !== "romeo.scale-load-smoke.v1" ||
    evidence.status !== "passed" ||
    evidence.mode !== "live"
  ) {
    throw new Error(
      `Scale load smoke did not produce live passing evidence: ${JSON.stringify(evidence, null, 2)}`,
    );
  }
  if (evidence.created?.chats !== input.chats.length) {
    throw new Error("Scale load smoke did not create every planned chat.");
  }
  if (evidence.created?.knowledgeSources !== input.knowledgeSources.length) {
    throw new Error(
      "Scale load smoke did not create every planned knowledge source.",
    );
  }
  if (evidence.created?.connectorSyncs !== input.connectorSyncs.length) {
    throw new Error("Scale load smoke did not sync every planned connector.");
  }
  if (
    evidence.created?.toolDispatchRequests !== input.toolDispatches.length ||
    evidence.cancelled?.toolDispatchRequests !== input.toolDispatches.length
  ) {
    throw new Error(
      "Scale load smoke did not queue and cancel every planned tool dispatch request.",
    );
  }
  if (evidence.latencyMs?.count < input.chats.length) {
    throw new Error("Scale load smoke did not record request latency.");
  }
}

function rawFixtureSentinels(input) {
  return [
    ...input.knowledgeSources.map((source) => source.content),
    ...input.runs.map((run) => run.content),
    ...input.comments.map((comment) => comment.body),
    ...input.attachments.map((attachment) => attachment.content),
    ...input.connectorSyncs.flatMap((sync) =>
      sync.items.map((item) => item.content),
    ),
    ...input.toolDispatches.flatMap((dispatch) =>
      Object.values(dispatch.body)
        .filter((value) => typeof value === "string" && value.length >= 12)
        .map((value) => String(value)),
    ),
  ];
}

function readFile(path) {
  return readFileSync(path, "utf8");
}
