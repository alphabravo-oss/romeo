import {
  argValue,
  assertComposeLogsRedacted,
  assertReadinessReady,
  cleanupComposeHarness,
  compose,
  composeOutput,
  createAdminApiKey,
  createComposeHarness,
  expectUnauthorizedMe,
  parsePositiveInteger,
  randomProjectName,
  waitForHealth,
  writeJsonEvidence,
  writeComposeEnv,
} from "./lib/compose-smoke-support.mjs";
import {
  assertNoSensitiveLeak,
  assertWorkerOutput,
  composeLoopRestartWorkers,
  composeWorkerCommands,
  parseWorkerOutput,
} from "./lib/worker-smoke-support.mjs";

const keep = process.argv.includes("--keep");
const projectName =
  argValue("--project-name") ?? randomProjectName("romeo_workers_smoke");
const timeoutMs = parsePositiveInteger("--timeout-ms", 180000);

const harness = await createComposeHarness({ projectName, timeoutMs });
let adminToken;

try {
  writeComposeEnv(harness, { devSeededLogin: true });
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
    romeoApiKey: adminToken,
    webhookRetryIntervalMs: 1000,
  });
  compose(harness, ["up", "-d", "--force-recreate", "app"]);
  await waitForHealth(harness);
  await expectUnauthorizedMe(harness);
  await assertReadinessReady(harness, adminToken);

  const results = [];
  for (const worker of composeWorkerCommands) {
    const result = composeOutput(harness, [
      "--profile",
      worker.profile,
      "run",
      "--rm",
      worker.service,
      ...worker.command,
    ]);
    assertNoSensitiveLeak(worker.name, `${result.stdout}\n${result.stderr}`, [
      adminToken,
      harness.postgresPassword,
      harness.s3Secret,
      harness.sessionSecret,
      harness.webhookSigningKey,
    ]);
    const parsed = parseWorkerOutput(worker.name, result.stdout);
    assertWorkerOutput(worker, parsed);
    results.push({
      name: worker.name,
      service: worker.service,
      iteration: parsed.iteration,
      checks: worker.numericChecks.reduce(
        (checks, key) => ({ ...checks, [key]: parsed[key] }),
        {},
      ),
    });
  }

  const restartResults = [];
  for (const worker of composeLoopRestartWorkers) {
    restartResults.push(await runLoopRestartSmoke(harness, worker));
  }

  assertComposeLogsRedacted(harness, [
    adminToken,
    harness.postgresPassword,
    harness.s3Secret,
    harness.sessionSecret,
    harness.webhookSigningKey,
  ]);

  writeJsonEvidence({
    schemaVersion: "romeo.compose-workers-smoke.v1",
    generatedAt: new Date().toISOString(),
    projectName,
    status: "passed",
    workerCount: results.length,
    workers: results,
    loopRestartCount: restartResults.length,
    loopRestarts: restartResults,
    checks: [
      "compose_build_and_start",
      "migration_service",
      "explicit_development_seed",
      "secure_recreate_with_seeded_login_disabled",
      "admin_readiness_ready",
      "worker_commands_ran_once",
      "worker_output_json_valid",
      "worker_output_secret_redaction",
      "loop_workers_emit_after_restart",
      "compose_logs_redacted",
    ],
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
async function runLoopRestartSmoke(harness, worker) {
  compose(harness, ["--profile", worker.profile, "up", "-d", worker.service]);
  const beforeRestartIterations = await waitForServiceIterations(
    harness,
    worker.service,
    1,
  );
  compose(harness, ["restart", worker.service]);
  const afterRestartIterations = await waitForServiceIterations(
    harness,
    worker.service,
    beforeRestartIterations + 1,
  );
  compose(harness, ["stop", worker.service]);
  return {
    name: worker.name,
    service: worker.service,
    beforeRestartIterations,
    afterRestartIterations,
  };
}

async function waitForServiceIterations(harness, service, minimumCount) {
  const deadline = Date.now() + harness.timeoutMs;
  let count = 0;
  while (Date.now() < deadline) {
    const logs = composeOutput(harness, ["logs", "--no-color", service], {
      allowFailure: true,
    });
    count = countOccurrences(`${logs.stdout}\n${logs.stderr}`, '"iteration"');
    if (count >= minimumCount) return count;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    `${service} did not emit ${minimumCount} worker loop iteration log entries.`,
  );
}

function countOccurrences(text, needle) {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = text.indexOf(needle);
  while (index >= 0) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}
