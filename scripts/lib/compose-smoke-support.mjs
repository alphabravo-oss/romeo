import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../..", import.meta.url));
export const composeFile = "deploy/compose/compose.yml";
export const externalPostgresComposeFile =
  "deploy/compose/external-postgres.compose.yml";
const composeProfiles = [
  "workers",
  "knowledge",
  "voice",
  "backup",
  "monitoring",
];

export function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

export function parsePositiveInteger(name, fallback) {
  const parsed = Number.parseInt(argValue(name) ?? String(fallback), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

export function repoPath(path) {
  return resolve(root, path);
}

export function writeJsonEvidence(value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  process.stdout.write(serialized);
  const outputPath = argValue("--output");
  if (outputPath !== undefined) {
    const absolute = resolve(process.cwd(), outputPath);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, serialized, "utf8");
  }
}

export function randomProjectName(prefix) {
  return `${prefix}_${Date.now()}_${randomBytes(3).toString("hex")}`;
}

export async function createComposeHarness(options) {
  const tempDir =
    options.tempDir ?? mkdtempSync(join(tmpdir(), "romeo-compose-smoke-"));
  mkdirSync(tempDir, { recursive: true });
  const harness = {
    projectName: options.projectName,
    tempDir,
    envPath: join(tempDir, "compose.env"),
    timeoutMs: options.timeoutMs,
    appPort: await freePort(),
    postgresPort: await freePort(),
    valkeyPort: await freePort(),
    rustfsPort: await freePort(),
    postgresPassword: `pg_${randomBytes(18).toString("hex")}`,
    s3Secret: `s3_${randomBytes(18).toString("hex")}`,
    sessionSecret: `session_${randomBytes(32).toString("hex")}`,
    webhookSigningKey: `webhook_${randomBytes(32).toString("hex")}`,
  };
  return harness;
}

export function writeComposeEnv(harness, options = {}) {
  writeFileSync(
    harness.envPath,
    [
      `APP_ORIGIN=http://127.0.0.1:${harness.appPort}`,
      `APP_PORT=${harness.appPort}`,
      `DATABASE_URL=${options.databaseUrl ?? `postgres://romeo:${harness.postgresPassword}@postgres:5432/romeo`}`,
      `TENANCY_MODE=${options.tenancyMode ?? "single"}`,
      `HTTP_RATE_LIMIT_DRIVER=${options.httpRateLimitDriver ?? "memory"}`,
      `HTTP_RATE_LIMIT_KEY_PREFIX=${options.httpRateLimitKeyPrefix ?? "romeo:http-rate-limit:v1"}`,
      `HTTP_RATE_LIMIT_WINDOW_SECONDS=${options.httpRateLimitWindowSeconds ?? 60}`,
      `HTTP_RATE_LIMIT_AUTH_MAX=${options.httpRateLimitAuthMax ?? 60}`,
      `HTTP_RATE_LIMIT_PUBLIC_MAX=${options.httpRateLimitPublicMax ?? 600}`,
      `HTTP_RATE_LIMIT_AUTHENTICATED_MAX=${options.httpRateLimitAuthenticatedMax ?? 6000}`,
      `HTTP_RATE_LIMIT_WEBHOOK_MAX=${options.httpRateLimitWebhookMax ?? 1200}`,
      `POSTGRES_PORT=${harness.postgresPort}`,
      `POSTGRES_PASSWORD=${harness.postgresPassword}`,
      "POSTGRES_BACKUP_RETENTION_DAYS=30",
      "POSTGRES_BACKUP_UPLOAD_URL=",
      "POSTGRES_BACKUP_MANIFEST_UPLOAD_URL=",
      "S3_ACCESS_KEY_ID=romeo",
      `S3_SECRET_ACCESS_KEY=${harness.s3Secret}`,
      "S3_BUCKET=romeo",
      `RUSTFS_PORT=${harness.rustfsPort}`,
      "MINIO_MC_IMAGE=minio/mc:latest",
      `WEBHOOK_SIGNING_KEY=${options.webhookSigningKey ?? harness.webhookSigningKey}`,
      `SESSION_SECRET=${options.sessionSecret ?? harness.sessionSecret}`,
      `SESSION_SECRET_PREVIOUS=${options.sessionSecretPrevious ?? ""}`,
      `MANAGED_SECRET_ENCRYPTION_KEY=${options.managedSecretEncryptionKey ?? harness.sessionSecret}`,
      `DEV_SEEDED_LOGIN=${options.devSeededLogin ? "true" : "false"}`,
      `ROMEO_API_KEY=${options.romeoApiKey ?? ""}`,
      `DATA_CONNECTOR_EXECUTION_DRIVER=${options.dataConnectorExecutionDriver ?? "disabled"}`,
      `TOOL_OPERATION_EXECUTION_DRIVER=${options.toolOperationExecutionDriver ?? "disabled"}`,
      `VALKEY_PORT=${harness.valkeyPort}`,
      `QUOTA_COORDINATION_DRIVER=${options.quotaCoordinationDriver ?? "disabled"}`,
      `QUOTA_COORDINATION_KEY_PREFIX=${options.quotaCoordinationKeyPrefix ?? "romeo:quota:v1"}`,
      `QUOTA_COORDINATION_TIMEOUT_MS=${options.quotaCoordinationTimeoutMs ?? 2000}`,
      "OIDC_ISSUER_URL=",
      "OIDC_CLIENT_ID=",
      "OIDC_ADMIN_GROUPS=",
      "OIDC_GROUP_MAP=",
      "OIDC_WORKSPACE_GROUP_MAP=",
      "OIDC_WORKSPACE_GROUP_PREFIX=",
      `DATA_CONNECTOR_SYNC_INTERVAL_MS=${options.dataConnectorSyncIntervalMs ?? 60000}`,
      "DATA_CONNECTOR_SYNC_MAX_CONNECTORS=10",
      "DATA_CONNECTOR_SYNC_WORKSPACE_ID=",
      `WORKFLOW_RESUME_INTERVAL_MS=${options.workflowResumeIntervalMs ?? 60000}`,
      "WORKFLOW_RESUME_MAX_RUNS=10",
      "WORKFLOW_RESUME_MAX_WORKFLOWS=10",
      "WORKFLOW_RESUME_WORKSPACE_ID=",
      `WEBHOOK_RETRY_INTERVAL_MS=${options.webhookRetryIntervalMs ?? 60000}`,
      `BILLING_ENTITLEMENT_RECONCILE_INTERVAL_MS=${options.billingEntitlementReconcileIntervalMs ?? 300000}`,
      `BILLING_LIFECYCLE_ENFORCE_INTERVAL_MS=${options.billingLifecycleEnforceIntervalMs ?? 900000}`,
      `RETENTION_ENFORCE_INTERVAL_MS=${options.retentionEnforceIntervalMs ?? 86400000}`,
      `KNOWLEDGE_EXTRACTION_WORKER_INTERVAL_MS=${options.knowledgeExtractionIntervalMs ?? 60000}`,
      "KNOWLEDGE_EXTRACTION_WORKER_KB_ID=",
      "KNOWLEDGE_EXTRACTION_WORKER_MAX_SOURCES=10",
      `VOICE_CATALOG_SYNC_INTERVAL_MS=${options.voiceCatalogSyncIntervalMs ?? 86400000}`,
      "",
    ].join("\n"),
  );
}

export function compose(harness, args, options = {}) {
  const result = spawnSync(
    "docker",
    [
      "compose",
      ...composeFileArgs(options.composeFiles),
      "--env-file",
      harness.envPath,
      "-p",
      harness.projectName,
      ...args,
    ],
    { cwd: root, stdio: options.stdio ?? "inherit" },
  );
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(`docker compose ${args.join(" ")} failed.`);
  }
  return result;
}

export function composeOutput(harness, args, options = {}) {
  const result = spawnSync(
    "docker",
    [
      "compose",
      ...composeFileArgs(options.composeFiles),
      "--env-file",
      harness.envPath,
      "-p",
      harness.projectName,
      ...args,
    ],
    { cwd: root, encoding: "utf8" },
  );
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(
      `docker compose ${args.join(" ")} failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }
  return result;
}

export async function restartComposeService(harness, service, options = {}) {
  compose(harness, ["restart", service], {
    composeFiles: options.composeFiles,
  });
  await waitForComposeServiceState(harness, service, {
    composeFiles: options.composeFiles,
    state: options.state ?? "running",
  });
}

export async function waitForComposeServiceState(
  harness,
  service,
  options = {},
) {
  const expectedState = options.state ?? "running";
  const deadline = Date.now() + harness.timeoutMs;
  let lastStatus = "";
  while (Date.now() < deadline) {
    const containerId = composeOutput(harness, ["ps", "-q", service], {
      allowFailure: true,
      composeFiles: options.composeFiles,
    }).stdout.trim();
    if (containerId.length > 0) {
      const inspect = spawnSync(
        "docker",
        [
          "inspect",
          "--format",
          "{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}",
          containerId,
        ],
        { encoding: "utf8" },
      );
      lastStatus = `${inspect.stdout}\n${inspect.stderr}`.trim();
      const [status, health] = inspect.stdout.trim().split(/\s+/, 2);
      if (expectedState === "healthy" && health === "healthy") return;
      if (expectedState === "running" && status === "running") return;
    }
    await sleep(1000);
  }
  throw new Error(
    `Timed out waiting for Compose service ${service} to be ${expectedState}. Last status: ${lastStatus}`,
  );
}

function composeFileArgs(composeFiles = [composeFile]) {
  return composeFiles.flatMap((file) => ["-f", file]);
}

export function cleanupComposeHarness(harness, options = {}) {
  if (existsSync(harness.envPath)) {
    compose(
      harness,
      [
        ...composeProfiles.flatMap((profile) => ["--profile", profile]),
        "down",
        "-v",
        "--remove-orphans",
      ],
      {
        allowFailure: true,
        composeFiles: options.composeFiles,
      },
    );
    compose(harness, ["down", "-v", "--remove-orphans"], {
      allowFailure: true,
      composeFiles: options.composeFiles,
    });
  }
  removeProjectVolumes(harness.projectName);
  if (!options.keepFiles) {
    rmSync(harness.tempDir, { force: true, recursive: true });
  }
}

export function assertComposeLogsRedacted(
  harness,
  secrets,
  label = "Compose logs",
  options = {},
) {
  const result = composeOutput(harness, ["logs", "--no-color"], {
    allowFailure: true,
    composeFiles: options.composeFiles,
  });
  const text = `${result.stdout}\n${result.stderr}`;
  for (const secret of secrets) {
    if (
      typeof secret === "string" &&
      secret.length > 0 &&
      text.includes(secret)
    ) {
      throw new Error(`${label} leaked a generated secret.`);
    }
  }
}

export async function waitForHealth(harness) {
  const deadline = Date.now() + harness.timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl(harness, "/api/v1/health"));
      if (response.ok) {
        const body = await response.json();
        if (body?.data?.status === "ok") return;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(1000);
  }
  throw new Error(
    `Timed out waiting for app health.${lastError instanceof Error ? ` Last error: ${lastError.message}` : ""}`,
  );
}

export async function apiJson(harness, path, options = {}) {
  const headers = { accept: "application/json" };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.token !== undefined)
    headers.authorization = `Bearer ${options.token}`;
  const response = await fetch(baseUrl(harness, path), {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const body = text.length === 0 ? undefined : JSON.parse(text);
  const expectedStatus = options.expectedStatus ?? 200;
  if (response.status !== expectedStatus) {
    throw new Error(
      `${options.method ?? "GET"} ${path} returned ${response.status}, expected ${expectedStatus}: ${text}`,
    );
  }
  return body;
}

export async function createAdminApiKey(harness) {
  const response = await apiJson(harness, "/api/v1/api-keys", {
    method: "POST",
    body: {
      name: "Compose smoke admin",
      scopes: [
        "me:read",
        "organizations:read",
        "workspaces:read",
        "providers:read",
        "providers:write",
        "models:read",
        "models:use",
        "agents:read",
        "agents:create",
        "agents:write",
        "agents:run",
        "chats:read",
        "chats:write",
        "runs:read",
        "runs:create",
        "runs:cancel",
        "knowledge:read",
        "knowledge:write",
        "knowledge:query",
        "audit:read",
        "usage:read",
        "webhooks:read",
        "webhooks:write",
        "voices:use",
        "voices:manage",
        "tools:use",
        "tools:manage",
        "admin:read",
        "admin:write",
      ],
    },
    expectedStatus: 201,
  });
  if (typeof response.data?.token !== "string") {
    throw new Error("API key creation did not return a token.");
  }
  return response.data.token;
}

export async function expectUnauthorizedMe(harness) {
  const response = await fetch(baseUrl(harness, "/api/v1/me"));
  if (response.status !== 401) {
    throw new Error(
      `Expected /api/v1/me to require auth, got ${response.status}.`,
    );
  }
}

export async function assertReadinessReady(harness, token) {
  const readiness = await apiJson(harness, "/api/v1/admin/readiness", {
    token,
  });
  assertReady(readiness.data);
  return readiness.data;
}

export function assertReady(report) {
  if (report?.status !== "ready") {
    throw new Error(
      `Readiness did not pass: ${JSON.stringify(report, null, 2)}`,
    );
  }
  const failed =
    report.checks?.filter((check) => check.status !== "pass") ?? [];
  if (failed.length > 0) {
    throw new Error(
      `Readiness checks are not all passing: ${JSON.stringify(failed, null, 2)}`,
    );
  }
}

export async function createDurableSmokeRecords(harness, token, options = {}) {
  const timestamp = new Date().toISOString();
  const titlePrefix = options.titlePrefix ?? "Compose smoke";
  const chat = await apiJson(harness, "/api/v1/chats", {
    method: "POST",
    token,
    body: {
      workspaceId: "workspace_default",
      title: `${titlePrefix} ${timestamp}`,
    },
    expectedStatus: 201,
  });

  const source = await apiJson(
    harness,
    "/api/v1/knowledge-bases/kb_default/sources",
    {
      method: "POST",
      token,
      body: {
        fileName: options.fileName ?? "compose-smoke.txt",
        mimeType: "text/plain",
        sizeBytes: 73,
        content:
          options.content ??
          "Romeo Compose smoke validates Postgres, RustFS object storage, and restart durability.",
      },
      expectedStatus: 202,
    },
  );

  const attachment = options.createAttachment
    ? await createRunAttachment(harness, token, chat.data.id, titlePrefix)
    : undefined;

  return {
    chatId: chat.data.id,
    sourceId: source.data.id,
    ...(attachment === undefined ? {} : { attachment }),
  };
}

export async function assertDurableSmokeRecords(harness, token, records) {
  const chats = await apiJson(
    harness,
    "/api/v1/chats?workspaceId=workspace_default",
    { token },
  );
  if (
    !Array.isArray(chats.data) ||
    !chats.data.some((chat) => chat.id === records.chatId)
  ) {
    throw new Error("Created chat was not readable after restore/restart.");
  }

  const sources = await apiJson(
    harness,
    "/api/v1/knowledge-bases/kb_default/sources",
    { token },
  );
  if (
    !Array.isArray(sources.data) ||
    !sources.data.some(
      (source) => source.id === records.sourceId && source.status === "indexed",
    )
  ) {
    throw new Error(
      "Created knowledge source was not readable after restore/restart.",
    );
  }
}

export async function createProductWorkflowSmokeRecords(
  harness,
  token,
  records,
  options = {},
) {
  const rawContentSuffix =
    options.rawContentSentinel === undefined
      ? ""
      : ` ${options.rawContentSentinel}`;
  await apiJson(harness, "/api/v1/notification-channels", {
    method: "POST",
    token,
    body: {
      type: "webhook",
      name: "Compose smoke notifications",
      config: { url: "https://hooks.example/compose-smoke" },
    },
    expectedStatus: 201,
  });

  const run = await apiJson(harness, "/api/v1/runs", {
    method: "POST",
    token,
    body: {
      chatId: records.chatId,
      agentId: "agent_default",
      content: `Compose product workflow durability check.${rawContentSuffix}`,
    },
    expectedStatus: 202,
  });

  const comment = await apiJson(
    harness,
    `/api/v1/chats/${records.chatId}/comments`,
    {
      method: "POST",
      token,
      body: {
        body: `Please review @user_dev_admin compose smoke workflow.${rawContentSuffix}`,
      },
      expectedStatus: 201,
    },
  );

  const notifications = await apiJson(harness, "/api/v1/notifications", {
    token,
  });
  const notification = notifications.data?.find(
    (item) => item.metadata?.commentId === comment.data.id,
  );
  if (notification === undefined) {
    throw new Error("Compose smoke mention notification was not created.");
  }

  const deliveries = await apiJson(harness, "/api/v1/notification-deliveries", {
    token,
  });
  const delivery = deliveries.data?.find(
    (item) => item.notificationId === notification.id,
  );
  if (delivery === undefined) {
    throw new Error("Compose smoke notification delivery was not created.");
  }

  const usageEvents = await apiJson(harness, "/api/v1/usage/events", {
    token,
  });
  if (
    !usageEvents.data?.some(
      (event) => event.sourceType === "run" && event.sourceId === run.data.id,
    )
  ) {
    throw new Error("Compose smoke run usage event was not recorded.");
  }

  const auditLogs = await apiJson(
    harness,
    `/api/v1/audit-logs?action=chat.comment`,
    { token },
  );
  const auditLog = auditLogs.data?.find(
    (log) =>
      log.resourceId === records.chatId &&
      log.metadata?.mentionedUserIds?.includes("user_dev_admin"),
  );
  if (auditLog === undefined) {
    throw new Error("Compose smoke comment audit log was not recorded.");
  }

  return {
    auditLogId: auditLog.id,
    commentId: comment.data.id,
    deliveryId: delivery.id,
    notificationId: notification.id,
    runId: run.data.id,
  };
}

export async function assertProductWorkflowSmokeRecords(
  harness,
  token,
  workflow,
) {
  const run = await apiJson(harness, `/api/v1/runs/${workflow.runId}`, {
    token,
  });
  if (run.data?.id !== workflow.runId) {
    throw new Error("Created run was not readable after restart.");
  }

  const notifications = await apiJson(harness, "/api/v1/notifications", {
    token,
  });
  if (
    !notifications.data?.some((item) => item.id === workflow.notificationId)
  ) {
    throw new Error("Created notification was not readable after restart.");
  }

  const deliveries = await apiJson(harness, "/api/v1/notification-deliveries", {
    token,
  });
  if (!deliveries.data?.some((item) => item.id === workflow.deliveryId)) {
    throw new Error(
      "Created notification delivery was not readable after restart.",
    );
  }

  const usageEvents = await apiJson(harness, "/api/v1/usage/events", {
    token,
  });
  if (
    !usageEvents.data?.some(
      (event) =>
        event.sourceType === "run" && event.sourceId === workflow.runId,
    )
  ) {
    throw new Error("Created usage event was not readable after restart.");
  }

  const auditLogs = await apiJson(
    harness,
    `/api/v1/audit-logs?action=chat.comment`,
    { token },
  );
  if (!auditLogs.data?.some((log) => log.id === workflow.auditLogId)) {
    throw new Error("Created audit log was not readable after restart.");
  }
}

export async function assertAttachmentReadable(harness, token, attachment) {
  const response = await fetch(baseUrl(harness, attachment.previewUrl), {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(
      `Restored attachment read returned ${response.status}, expected 200.`,
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const expected = Buffer.from(attachment.dataBase64, "base64");
  if (response.headers.get("content-type") !== attachment.mimeType) {
    throw new Error("Restored attachment content type did not match.");
  }
  if (bytes.byteLength !== expected.byteLength) {
    throw new Error("Restored attachment byte count did not match.");
  }
  for (const [index, byte] of bytes.entries()) {
    if (byte !== expected[index]) {
      throw new Error("Restored attachment bytes did not match.");
    }
  }
}

export async function assertKnowledgeQuery(harness, token, query, sourceId) {
  const hits = await apiJson(
    harness,
    "/api/v1/knowledge-bases/kb_default/query",
    {
      method: "POST",
      token,
      body: { query, maxResults: 5 },
    },
  );
  if (
    !Array.isArray(hits.data) ||
    !hits.data.some((hit) => hit.citation?.documentId === sourceId)
  ) {
    throw new Error("Restored knowledge chunks were not queryable.");
  }
}

export function baseUrl(harness, path) {
  return `http://127.0.0.1:${harness.appPort}${path}`;
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === "object" && address !== null)
          resolvePort(address.port);
        else reject(new Error("Unable to allocate a local port."));
      });
    });
  });
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function createRunAttachment(harness, token, chatId, titlePrefix) {
  const dataBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
  const bytes = Buffer.from(dataBase64, "base64");
  await apiJson(harness, "/api/v1/runs", {
    method: "POST",
    token,
    body: {
      chatId,
      agentId: "agent_default",
      content: `${titlePrefix} attachment durability`,
      attachments: [
        {
          fileName: "../compose-artifact.png",
          mimeType: "image/png",
          sizeBytes: bytes.byteLength,
          dataBase64,
        },
      ],
    },
    expectedStatus: 202,
  });

  const messages = await apiJson(harness, `/api/v1/chats/${chatId}/messages`, {
    token,
  });
  const attachment = messages.data
    ?.flatMap((message) => message.attachments ?? [])
    .find((part) => part.fileName === "compose-artifact.png");
  if (attachment?.previewUrl === undefined) {
    throw new Error("Run attachment was not returned from chat messages.");
  }
  return {
    fileName: attachment.fileName,
    id: attachment.id,
    messageId: attachment.messageId,
    mimeType: "image/png",
    previewUrl: attachment.previewUrl,
    sizeBytes: bytes.byteLength,
    dataBase64,
  };
}

function removeProjectVolumes(projectName) {
  const list = spawnSync(
    "docker",
    [
      "volume",
      "ls",
      "--filter",
      `label=com.docker.compose.project=${projectName}`,
      "--format",
      "{{.Name}}",
    ],
    { encoding: "utf8" },
  );
  if (list.status !== 0) return;
  const volumes = list.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (volumes.length === 0) return;
  spawnSync("docker", ["volume", "rm", ...volumes], { stdio: "inherit" });
}
