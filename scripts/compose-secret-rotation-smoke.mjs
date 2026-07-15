import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  apiJson,
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
} from "./lib/compose-smoke-support.mjs";

const keep = process.argv.includes("--keep");
const output = argValue("--output");
const projectName =
  argValue("--project-name") ??
  randomProjectName("romeo_secret_rotation_smoke");
const timeoutMs = parsePositiveInteger("--timeout-ms", 180000);

const harness = await createComposeHarness({ projectName, timeoutMs });
const oldSessionSecret = harness.sessionSecret;
const newSessionSecret = `session_${randomBytes(32).toString("hex")}`;
const oldWebhookSigningKey = harness.webhookSigningKey;
const newWebhookSigningKey = `webhook_${randomBytes(32).toString("hex")}`;
let adminToken;
let oldWebhookSecret;
let newWebhookSecret;

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
  writeComposeEnv(harness, { devSeededLogin: false });
  compose(harness, ["up", "-d", "--force-recreate", "app"]);
  await waitForHealth(harness);
  await expectUnauthorizedMe(harness);
  await assertReadinessReady(harness, adminToken);

  oldWebhookSecret = await createWebhookSigningSecret(
    "https://hooks.example/rotation-before",
  );

  writeComposeEnv(harness, {
    devSeededLogin: false,
    sessionSecret: newSessionSecret,
    sessionSecretPrevious: oldSessionSecret,
    webhookSigningKey: newWebhookSigningKey,
  });
  compose(harness, ["up", "-d", "--force-recreate", "app"]);
  await waitForHealth(harness);
  await assertReadinessReady(harness, adminToken);

  newWebhookSecret = await createWebhookSigningSecret(
    "https://hooks.example/rotation-after",
  );
  if (newWebhookSecret === oldWebhookSecret) {
    throw new Error("Webhook signing-key rotation did not change new secrets.");
  }
  await assertWebhookListDoesNotExposeSecrets();

  writeComposeEnv(harness, {
    devSeededLogin: false,
    sessionSecret: newSessionSecret,
    webhookSigningKey: newWebhookSigningKey,
  });
  compose(harness, ["up", "-d", "--force-recreate", "app"]);
  await waitForHealth(harness);
  await assertReadinessReady(harness, adminToken);

  assertComposeLogsRedacted(harness, [
    adminToken,
    oldSessionSecret,
    newSessionSecret,
    oldWebhookSigningKey,
    newWebhookSigningKey,
    oldWebhookSecret,
    newWebhookSecret,
    harness.postgresPassword,
    harness.s3Secret,
  ]);

  writeEvidence({
    schemaVersion: "romeo.compose-secret-rotation-smoke.v1",
    generatedAt: new Date().toISOString(),
    projectName,
    status: "passed",
    checks: [
      "compose_build_and_start",
      "migration_service",
      "explicit_development_seed",
      "secure_recreate_with_seeded_login_disabled",
      "session_secret_previous_dual_read_readiness",
      "api_key_continues_after_session_secret_rotation",
      "webhook_signing_key_cutover_changes_new_subscription_secret",
      "session_secret_previous_removed_readiness",
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
    `Wrote secret rotation Compose smoke evidence to ${outputPath}\n`,
  );
}

async function createWebhookSigningSecret(url) {
  const created = await apiJson(harness, "/api/v1/webhooks", {
    method: "POST",
    token: adminToken,
    body: { url, eventTypes: ["webhook.test"] },
    expectedStatus: 201,
  });
  const signingSecret = created.data?.signingSecret;
  if (typeof signingSecret !== "string" || signingSecret.length === 0) {
    throw new Error("Webhook creation did not return a signing secret.");
  }
  return signingSecret;
}

async function assertWebhookListDoesNotExposeSecrets() {
  const list = await apiJson(harness, "/api/v1/webhooks", {
    token: adminToken,
  });
  const serialized = JSON.stringify(list);
  if (
    serialized.includes(oldWebhookSecret) ||
    serialized.includes(newWebhookSecret)
  ) {
    throw new Error("Webhook list exposed a one-time signing secret.");
  }
}
