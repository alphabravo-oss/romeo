import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  argValue,
  assertComposeLogsRedacted,
  assertDurableSmokeRecords,
  assertProductWorkflowSmokeRecords,
  assertReadinessReady,
  cleanupComposeHarness,
  compose,
  composeFile,
  createAdminApiKey,
  createComposeHarness,
  createDurableSmokeRecords,
  createProductWorkflowSmokeRecords,
  expectUnauthorizedMe,
  externalPostgresComposeFile,
  parsePositiveInteger,
  randomProjectName,
  waitForHealth,
  writeComposeEnv,
} from "./lib/compose-smoke-support.mjs";

const keep = process.argv.includes("--keep");
const output = argValue("--output");
const projectName =
  argValue("--project-name") ?? randomProjectName("romeo_external_pg_smoke");
const timeoutMs = parsePositiveInteger("--timeout-ms", 180000);
const composeFiles = [composeFile, externalPostgresComposeFile];

const harness = await createComposeHarness({ projectName, timeoutMs });
const externalPostgresName = `${projectName}_external_postgres`;
const externalDatabaseUrl = `postgres://postgres:${harness.postgresPassword}@host.docker.internal:${harness.postgresPort}/postgres`;
let adminToken;
let records;
let workflowRecords;

try {
  startExternalPostgres(harness, externalPostgresName);
  await waitForExternalPostgres(harness, externalPostgresName);

  writeComposeEnv(harness, {
    databaseUrl: externalDatabaseUrl,
    devSeededLogin: true,
  });
  compose(harness, ["up", "-d", "--build", "app"], { composeFiles });
  await waitForHealth(harness);
  compose(
    harness,
    [
      "run",
      "--rm",
      "migrate",
      "pnpm",
      "seed:postgres",
      "--",
      "--confirm-development-seed",
    ],
    { composeFiles },
  );

  adminToken = await createAdminApiKey(harness);
  writeComposeEnv(harness, {
    databaseUrl: externalDatabaseUrl,
    devSeededLogin: false,
  });
  compose(harness, ["up", "-d", "--force-recreate", "app"], {
    composeFiles,
  });
  await waitForHealth(harness);
  await expectUnauthorizedMe(harness);
  await assertReadinessReady(harness, adminToken);

  records = await createDurableSmokeRecords(harness, adminToken, {
    titlePrefix: "External Postgres smoke",
  });
  workflowRecords = await createProductWorkflowSmokeRecords(
    harness,
    adminToken,
    records,
  );

  compose(harness, ["restart", "app"], { composeFiles });
  await waitForHealth(harness);
  await assertDurableSmokeRecords(harness, adminToken, records);
  await assertProductWorkflowSmokeRecords(harness, adminToken, workflowRecords);
  await assertReadinessReady(harness, adminToken);

  compose(
    harness,
    [
      "run",
      "--rm",
      "migrate",
      "pnpm",
      "validate:postgres",
      "--",
      "--output",
      "/tmp/romeo-compose-external-postgres-validation.json",
    ],
    { composeFiles },
  );

  assertComposeLogsRedacted(
    harness,
    [
      adminToken,
      externalDatabaseUrl,
      harness.postgresPassword,
      harness.s3Secret,
      harness.sessionSecret,
      harness.webhookSigningKey,
    ],
    "External Postgres Compose logs",
    { composeFiles },
  );

  writeEvidence({
    schemaVersion: "romeo.compose-external-postgres-smoke.v1",
    generatedAt: new Date().toISOString(),
    projectName,
    status: "passed",
    checks: [
      "external_pgvector_container",
      "compose_external_postgres_override",
      "migration_service_external_database_url",
      "explicit_development_seed",
      "secure_recreate_with_seeded_login_disabled",
      "admin_readiness_ready",
      "product_workflow_persisted_after_restart",
      "postgres_schema_validation",
      "compose_logs_redacted",
    ],
  });
} finally {
  if (!keep) {
    cleanupComposeHarness(harness, { composeFiles });
    removeExternalPostgres(externalPostgresName);
  } else {
    process.stderr.write(
      `Keeping Compose project ${projectName}, env file ${harness.envPath}, and external Postgres container ${externalPostgresName} for inspection.\n`,
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
  process.stderr.write(
    `Wrote external Postgres Compose smoke evidence to ${outputPath}\n`,
  );
}

function startExternalPostgres(harness, containerName) {
  removeExternalPostgres(containerName);
  const result = spawnSync(
    "docker",
    [
      "run",
      "-d",
      "--name",
      containerName,
      "-e",
      `POSTGRES_PASSWORD=${harness.postgresPassword}`,
      "-p",
      `${harness.postgresPort}:5432`,
      "pgvector/pgvector:pg18",
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(
      `Failed to start external Postgres container.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }
}

async function waitForExternalPostgres(harness, containerName) {
  const deadline = Date.now() + harness.timeoutMs;
  let lastOutput = "";
  while (Date.now() < deadline) {
    const result = spawnSync(
      "docker",
      ["exec", containerName, "pg_isready", "-U", "postgres", "-d", "postgres"],
      { encoding: "utf8" },
    );
    lastOutput = `${result.stdout}\n${result.stderr}`;
    if (result.status === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    `Timed out waiting for external Postgres container. Last output:\n${lastOutput}`,
  );
}

function removeExternalPostgres(containerName) {
  spawnSync("docker", ["rm", "-f", containerName], { stdio: "ignore" });
}
