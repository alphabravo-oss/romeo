import { randomBytes } from "node:crypto";

import {
  assertLocalAuthFallbackFlow,
  localAuthFallbackChecks,
  setAdminLocalPassword,
} from "./lib/auth-smoke-support.mjs";
import {
  argValue,
  assertComposeLogsRedacted,
  assertReadinessReady,
  cleanupComposeHarness,
  compose,
  createAdminApiKey,
  createComposeHarness,
  expectUnauthorizedMe,
  parsePositiveInteger,
  randomProjectName,
  waitForHealth,
  writeComposeEnv,
  writeJsonEvidence,
} from "./lib/compose-smoke-support.mjs";

const keep = process.argv.includes("--keep");
const projectName =
  argValue("--project-name") ?? randomProjectName("romeo_auth_smoke");
const timeoutMs = parsePositiveInteger("--timeout-ms", 180000);
const harness = await createComposeHarness({ projectName, timeoutMs });
const localPassword = `local_${randomBytes(18).toString("hex")}A1!`;
const rawAuthSentinel = `compose_auth_raw_${randomBytes(18).toString("hex")}`;
let adminToken;
let authEvidence;

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
  await setAdminLocalPassword(harness, adminToken, localPassword);

  writeComposeEnv(harness, { devSeededLogin: false });
  compose(harness, ["up", "-d", "--force-recreate", "app"]);
  await waitForHealth(harness);
  await expectUnauthorizedMe(harness);
  await assertReadinessReady(harness, adminToken);
  authEvidence = await assertLocalAuthFallbackFlow(harness, adminToken, {
    label: "Compose auth smoke",
    localPassword,
    rawAuthSentinel,
  });

  assertComposeLogsRedacted(harness, [
    adminToken,
    localPassword,
    authEvidence.enrollmentSecret,
    authEvidence.recoveryCode,
    rawAuthSentinel,
    harness.postgresPassword,
    harness.s3Secret,
    harness.sessionSecret,
    harness.webhookSigningKey,
  ]);

  writeJsonEvidence({
    schemaVersion: "romeo.compose-auth-smoke.v1",
    generatedAt: new Date().toISOString(),
    projectName,
    status: "passed",
    checks: [
      "compose_build_and_start",
      "migration_service",
      "explicit_development_seed",
      "admin_local_password_set",
      "secure_recreate_with_seeded_login_disabled",
      "unauthenticated_api_denied",
      "admin_readiness_ready",
      ...localAuthFallbackChecks,
      "compose_auth_logs_redacted",
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
