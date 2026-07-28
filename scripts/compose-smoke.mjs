import { randomBytes } from "node:crypto";

import {
  apiJson,
  assertAttachmentReadable,
  argValue,
  assertComposeLogsRedacted,
  assertDurableSmokeRecords,
  assertProductWorkflowSmokeRecords,
  assertReadinessReady,
  cleanupComposeHarness,
  compose,
  createAdminApiKey,
  createComposeHarness,
  createDurableSmokeRecords,
  createProductWorkflowSmokeRecords,
  expectUnauthorizedMe,
  randomProjectName,
  restartComposeService,
  waitForHealth,
  writeJsonEvidence,
  writeComposeEnv,
} from "./lib/compose-smoke-support.mjs";

const keep = process.argv.includes("--keep");
const projectName =
  argValue("--project-name") ?? randomProjectName("romeo_smoke");
const timeoutMs = Number.parseInt(argValue("--timeout-ms") ?? "180000", 10);
if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
  throw new Error("--timeout-ms must be a positive integer.");
}

const harness = await createComposeHarness({ projectName, timeoutMs });
const rawContentSentinel = `compose_raw_content_${randomBytes(18).toString("hex")}`;
let adminToken;
let records;
let workflowRecords;
let webhookRecords;

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

  records = await createDurableSmokeRecords(harness, adminToken, {
    createAttachment: true,
    content: `Romeo Compose smoke raw document sentinel ${rawContentSentinel}.`,
  });
  workflowRecords = await createProductWorkflowSmokeRecords(
    harness,
    adminToken,
    records,
    { rawContentSentinel },
  );
  webhookRecords = await createWebhookDeliveryReadback(
    harness,
    adminToken,
    rawContentSentinel,
  );

  compose(harness, ["restart", "app"]);
  await waitForHealth(harness);
  await assertDurableSmokeRecords(harness, adminToken, records);
  await assertProductWorkflowSmokeRecords(harness, adminToken, workflowRecords);
  await assertWebhookDeliveryReadback(
    harness,
    adminToken,
    webhookRecords,
    rawContentSentinel,
  );
  await assertAttachmentReadable(harness, adminToken, records.attachment);
  await assertReadinessReady(harness, adminToken);

  await restartAndAssertService("valkey", "healthy");
  await restartAndAssertService("rustfs", "running");
  await restartAndAssertService("postgres", "healthy", { restartApp: true });

  compose(harness, [
    "run",
    "--rm",
    "migrate",
    "pnpm",
    "validate:postgres",
    "--",
    "--output",
    "/tmp/romeo-compose-smoke-postgres-validation.json",
  ]);

  assertComposeLogsRedacted(harness, [
    adminToken,
    harness.postgresPassword,
    rawContentSentinel,
    webhookRecords.signingSecret,
    harness.s3Secret,
    harness.sessionSecret,
    harness.webhookSigningKey,
  ]);

  writeJsonEvidence({
    schemaVersion: "romeo.compose-smoke.v1",
    generatedAt: new Date().toISOString(),
    projectName,
    status: "passed",
    checks: [
      "compose_build_and_start",
      "migration_service",
      "explicit_development_seed",
      "secure_recreate_with_seeded_login_disabled",
      "unauthenticated_api_denied",
      "admin_readiness_ready",
      "chat_persisted_after_restart",
      "knowledge_source_persisted_after_restart",
      "attachment_persisted_after_object_store_restart",
      "run_usage_audit_notification_persisted_after_restart",
      "webhook_delivery_readback",
      "webhook_delivery_payload_redacted",
      "valkey_restart_readback",
      "rustfs_restart_readback",
      "postgres_restart_readback",
      "postgres_schema_validation",
      "compose_logs_redacted",
      "compose_raw_content_logs_redacted",
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

async function restartAndAssertService(service, state, options = {}) {
  await restartComposeService(harness, service, { state });
  if (options.restartApp) {
    compose(harness, ["restart", "app"]);
  }
  await waitForHealth(harness);
  await assertDurableSmokeRecords(harness, adminToken, records);
  await assertProductWorkflowSmokeRecords(harness, adminToken, workflowRecords);
  await assertWebhookDeliveryReadback(
    harness,
    adminToken,
    webhookRecords,
    rawContentSentinel,
  );
  await assertAttachmentReadable(harness, adminToken, records.attachment);
  await assertReadinessReady(harness, adminToken);
}

async function createWebhookDeliveryReadback(harness, token, sentinel) {
  const created = await apiJson(harness, "/api/v1/webhooks", {
    method: "POST",
    token,
    body: {
      url: "https://romeo-compose-webhook.invalid/romeo",
      eventTypes: ["webhook.test"],
    },
    expectedStatus: 201,
  });
  const subscriptionId = created.data?.subscription?.id;
  const signingSecret = created.data?.signingSecret;
  if (typeof subscriptionId !== "string" || subscriptionId.length === 0) {
    throw new Error("Webhook smoke subscription did not return an id.");
  }
  if (typeof signingSecret !== "string" || signingSecret.length === 0) {
    throw new Error(
      "Webhook smoke subscription did not return a signing secret.",
    );
  }

  const delivery = await apiJson(
    harness,
    `/api/v1/webhooks/${subscriptionId}/test`,
    {
      method: "POST",
      token,
      body: {
        payload: {
          check: "compose-smoke",
          rawBody: sentinel,
          nested: { rawBody: sentinel },
        },
      },
      expectedStatus: 202,
    },
  );
  const deliveryId = delivery.data?.id;
  if (typeof deliveryId !== "string" || deliveryId.length === 0) {
    throw new Error("Webhook smoke delivery did not return an id.");
  }
  assertWebhookDeliveryRedacted(delivery.data, sentinel);
  return { subscriptionId, deliveryId, signingSecret };
}

async function assertWebhookDeliveryReadback(
  harness,
  token,
  webhook,
  sentinel,
) {
  const response = await apiJson(
    harness,
    `/api/v1/webhooks/${webhook.subscriptionId}/deliveries`,
    { token },
  );
  const delivery = response.data?.find(
    (item) => item.id === webhook.deliveryId,
  );
  if (delivery === undefined) {
    throw new Error("Webhook smoke delivery was not readable after restart.");
  }
  assertWebhookDeliveryRedacted(delivery, sentinel);
}

function assertWebhookDeliveryRedacted(delivery, sentinel) {
  if (delivery.status !== "failed" || delivery.errorCode !== "network_error") {
    throw new Error(
      "Webhook smoke delivery did not record the expected local network failure.",
    );
  }
  if (delivery.payload?.redacted !== true) {
    throw new Error("Webhook smoke delivery payload was not redacted.");
  }
  const keys = delivery.payload?.keys;
  if (
    !Array.isArray(keys) ||
    !keys.includes("check") ||
    !keys.includes("nested") ||
    !keys.includes("rawBody")
  ) {
    throw new Error(
      "Webhook smoke delivery payload summary did not preserve payload keys.",
    );
  }
  if (sentinel !== undefined && JSON.stringify(delivery).includes(sentinel)) {
    throw new Error(
      "Webhook smoke delivery readback leaked raw payload content.",
    );
  }
}
