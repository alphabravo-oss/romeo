import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  apiJson,
  argValue,
  assertAttachmentReadable,
  assertComposeLogsRedacted,
  assertDurableSmokeRecords,
  assertReadinessReady,
  baseUrl,
  cleanupComposeHarness,
  compose,
  createAdminApiKey,
  createComposeHarness,
  createDurableSmokeRecords,
  expectUnauthorizedMe,
  parsePositiveInteger,
  randomProjectName,
  waitForComposeServiceState,
  waitForHealth,
  writeComposeEnv,
} from "./lib/compose-smoke-support.mjs";

const keep = process.argv.includes("--keep");
const output = argValue("--output");
const projectName =
  argValue("--project-name") ?? randomProjectName("romeo_object_store_outage");
const timeoutMs = parsePositiveInteger("--timeout-ms", 180000);
const harness = await createComposeHarness({ projectName, timeoutMs });
const rawContentSentinel = `object_store_outage_raw_${randomBytes(18).toString("hex")}`;
const outageAttachment = createOutageAttachment();
let adminToken;
let records;

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
    titlePrefix: "Compose object-store outage",
  });
  await assertAttachmentReadable(harness, adminToken, records.attachment);

  compose(harness, ["stop", "rustfs"]);

  await assertAttachmentReadFailsDuringOutage(records.attachment);
  await assertAttachmentWriteFailsDuringOutage(records.chatId);
  await assertOutageWriteNotPersisted(records.chatId);

  compose(harness, ["start", "rustfs"]);
  await waitForComposeServiceState(harness, "rustfs", { state: "running" });
  await waitForHealth(harness);
  await assertDurableSmokeRecords(harness, adminToken, records);
  await assertAttachmentReadable(harness, adminToken, records.attachment);

  const recoveredAttachment = await createAttachmentRun(records.chatId, {
    content: "Object-store outage recovery attachment write.",
    dataBase64: outageAttachment.dataBase64,
    fileName: "recovered-object-store-artifact.png",
  });
  await assertAttachmentReadable(harness, adminToken, recoveredAttachment);

  assertComposeLogsRedacted(harness, [
    adminToken,
    harness.postgresPassword,
    harness.s3Secret,
    harness.sessionSecret,
    harness.webhookSigningKey,
    rawContentSentinel,
    outageAttachment.dataBase64,
  ]);

  writeEvidence({
    schemaVersion: "romeo.compose-object-store-outage-smoke.v1",
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
      "baseline_attachment_readable",
      "rustfs_outage_injected",
      "attachment_read_fails_during_object_store_outage",
      "attachment_write_fails_during_object_store_outage",
      "failed_attachment_write_not_persisted",
      "rustfs_restarted",
      "baseline_attachment_readable_after_recovery",
      "attachment_write_recovers_after_object_store_restart",
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
    `Wrote object-store outage Compose smoke evidence to ${outputPath}\n`,
  );
}

async function assertAttachmentReadFailsDuringOutage(attachment) {
  const response = await fetch(baseUrl(harness, attachment.previewUrl), {
    headers: { authorization: `Bearer ${adminToken}` },
  });
  const text = await response.text();
  if (response.ok) {
    throw new Error("Attachment read unexpectedly succeeded during outage.");
  }
  assertTextRedacted(text, "attachment read outage response");
}

async function assertAttachmentWriteFailsDuringOutage(chatId) {
  const response = await fetch(baseUrl(harness, "/api/v1/runs"), {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      chatId,
      agentId: "agent_default",
      content: `Object-store outage failed write ${rawContentSentinel}.`,
      attachments: [
        {
          fileName: "../outage-object-store-artifact.png",
          mimeType: "image/png",
          sizeBytes: outageAttachment.sizeBytes,
          dataBase64: outageAttachment.dataBase64,
        },
      ],
    }),
  });
  const text = await response.text();
  if (response.ok) {
    throw new Error("Attachment write unexpectedly succeeded during outage.");
  }
  assertTextRedacted(text, "attachment write outage response");
}

async function assertOutageWriteNotPersisted(chatId) {
  const afterMessages = await listChatMessages(chatId);
  const serialized = JSON.stringify(afterMessages);
  assertTextRedacted(serialized, "chat messages after failed outage write");
  if (serialized.includes("outage-object-store-artifact.png")) {
    throw new Error(
      "Failed outage attachment write persisted attachment metadata.",
    );
  }
}

async function createAttachmentRun(chatId, input) {
  await apiJson(harness, "/api/v1/runs", {
    method: "POST",
    token: adminToken,
    body: {
      chatId,
      agentId: "agent_default",
      content: input.content,
      attachments: [
        {
          fileName: input.fileName,
          mimeType: "image/png",
          sizeBytes: outageAttachment.sizeBytes,
          dataBase64: input.dataBase64,
        },
      ],
    },
    expectedStatus: 202,
  });
  const messages = await listChatMessages(chatId);
  const attachment = messages
    .flatMap((message) => message.attachments ?? [])
    .find((part) => part.fileName === input.fileName);
  if (attachment?.previewUrl === undefined) {
    throw new Error(
      "Recovered attachment was not returned from chat messages.",
    );
  }
  return {
    fileName: attachment.fileName,
    id: attachment.id,
    messageId: attachment.messageId,
    mimeType: "image/png",
    previewUrl: attachment.previewUrl,
    sizeBytes: outageAttachment.sizeBytes,
    dataBase64: input.dataBase64,
  };
}

async function listChatMessages(chatId) {
  const response = await apiJson(harness, `/api/v1/chats/${chatId}/messages`, {
    token: adminToken,
  });
  if (!Array.isArray(response.data)) {
    throw new Error("Chat messages response was not an array.");
  }
  return response.data;
}

function createOutageAttachment() {
  const dataBase64 = randomBytes(48).toString("base64");
  return {
    dataBase64,
    sizeBytes: Buffer.from(dataBase64, "base64").byteLength,
  };
}

function assertTextRedacted(text, label) {
  if (text.includes(rawContentSentinel)) {
    throw new Error(`${label} leaked raw run content.`);
  }
  if (text.includes(outageAttachment.dataBase64)) {
    throw new Error(`${label} leaked raw attachment bytes.`);
  }
}
