import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defaultProviderCapabilities } from "../packages/providers/src/index.ts";
import {
  createLivePostgresRepositoryFixture,
  postgresConformanceDatabaseUrl,
} from "../packages/db/src/test-support/postgres-conformance-harness.ts";
import {
  S3ObjectStore,
  createS3PresignedRequest,
} from "../packages/storage/src/index.ts";

const adminDatabaseUrl = postgresConformanceDatabaseUrl();
if (adminDatabaseUrl === undefined) {
  throw new Error("ROMEO_POSTGRES_CONFORMANCE_DATABASE_URL is required.");
}
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const serverEntry = resolve(repoRoot, "apps/app/.output/server/index.mjs");
const s3 = {
  endpoint: requiredEnv("S3_ENDPOINT"),
  bucket: requiredEnv("S3_BUCKET"),
  region: process.env.S3_REGION?.trim() || "us-east-1",
  accessKeyId: requiredEnv("S3_ACCESS_KEY_ID"),
  secretAccessKey: requiredEnv("S3_SECRET_ACCESS_KEY"),
};
const outputPath = resolve(
  repoRoot,
  argValue("--output") ??
    "dist/evidence/live-multi-replica-recovery-acceptance.json",
);
const sentinels = {
  prompt: "MULTI_REPLICA_PROMPT_SENTINEL_2f08a9",
  queuedPrompt: "MULTI_REPLICA_QUEUE_SENTINEL_7b31cd",
  file: "MULTI_REPLICA_FILE_SENTINEL_91e4b2",
  secret: `multi_replica_secret_${randomUUID()}`,
} as const;

await ensureBucket(s3);
const fixture = await createLivePostgresRepositoryFixture(adminDatabaseUrl);
const objectStore = new S3ObjectStore(s3);
const provider = await controlledProviderServer();
const ports = [await freePort(), await freePort()];
const replicas: AppReplica[] = [];
const startedAt = performance.now();
const checks: Record<string, boolean | number> = {};

try {
  await seedRuntime(provider.baseUrl);
  const first = await startReplica("replica-a", ports[0]!);
  const second = await startReplica("replica-b", ports[1]!);
  checks.healthyReplicas = 2;

  const sharedBytes = Buffer.from(sentinels.file);
  const uploaded = await apiJson(first, "/api/v1/files", {
    method: "POST",
    expectedStatus: 201,
    body: {
      workspaceId: "workspace_default",
      fileName: "multi-replica-shared.txt",
      mimeType: "text/plain",
      sizeBytes: sharedBytes.byteLength,
      dataBase64: sharedBytes.toString("base64"),
      purpose: "general",
    },
  });
  const readAcrossReplica = await fetch(
    url(second, `/api/v1/files/${uploaded.data.id}/content`),
  );
  if (
    readAcrossReplica.status !== 200 ||
    !Buffer.from(await readAcrossReplica.arrayBuffer()).equals(sharedBytes)
  ) {
    throw new Error(
      "Replica B could not read the object uploaded by replica A.",
    );
  }
  checks.sharedPostgresAndObjectStore = true;

  const chat = await apiJson(first, "/api/v1/chats", {
    method: "POST",
    expectedStatus: 201,
    body: { workspaceId: "workspace_default", title: "Replica recovery" },
  });
  const run = await apiJson(first, "/api/v1/runs", {
    method: "POST",
    expectedStatus: 202,
    body: {
      chatId: chat.data.id,
      agentId: "agent_multi_replica",
      content: sentinels.prompt,
    },
  });
  await waitFor(
    () => provider.requestCount() >= 1,
    10_000,
    "the first provider stream to begin",
  );
  const queued = await apiJson(first, `/api/v1/chats/${chat.data.id}/queue`, {
    method: "POST",
    expectedStatus: 202,
    body: {
      agentId: "agent_multi_replica",
      content: sentinels.queuedPrompt,
      idempotencyKey: "multi-replica-queued-turn",
    },
  });
  await waitFor(
    async () => {
      const jobs = await fixture.repository.listBackgroundJobs("org_default");
      return jobs.some(
        (job) =>
          job.type === `run.execution:${run.data.id}` &&
          job.status === "running",
      );
    },
    10_000,
    "the durable run lease",
  );

  await stopReplica(first, "SIGKILL");
  checks.replicaKilledDuringProviderStream = true;
  await sleep(4_000);
  await apiJson(second, `/api/v1/chats/${chat.data.id}/runs/active`);
  let recoveryState = { run: "missing", queue: "missing", runCount: 0 };
  try {
    await waitFor(
      async () => {
        const recovered = await fixture.repository.getRun(run.data.id);
        const queue = await fixture.repository.getQueuedChatTurn(
          queued.data.id,
        );
        const runs = await fixture.repository.listRuns(chat.data.id);
        recoveryState = {
          run: recovered?.status ?? "missing",
          queue: queue?.status ?? "missing",
          runCount: runs.length,
        };
        return (
          recovered?.status === "completed" && queue?.status === "completed"
        );
      },
      20_000,
      "recovered run completion and queued-turn drain",
    );
  } catch {
    throw new Error(
      `Recovery state did not converge: run=${recoveryState.run}, queue=${recoveryState.queue}, runCount=${recoveryState.runCount}.`,
    );
  }
  const recoveredRuns = await fixture.repository.listRuns(chat.data.id);
  if (
    recoveredRuns.length !== 2 ||
    recoveredRuns.some((item) => item.status !== "completed")
  ) {
    throw new Error("Run recovery or queued-turn continuation was incomplete.");
  }
  const streamResponse = await fetch(
    url(second, `/api/v1/runs/${run.data.id}/events?after=0`),
  );
  const streamText = await streamResponse.text();
  if (streamResponse.status !== 200 || !streamText.includes("run.completed")) {
    throw new Error(
      "Replica B did not replay the recovered terminal SSE event.",
    );
  }
  checks.sseReconnectedToSecondReplica = true;
  checks.durableRunRecoveredExactlyOnce = true;
  checks.queuedTurnDrainedAfterRecovery = true;

  const replacement = await startReplica("replica-a-replacement", ports[0]!);
  const retention = await seedRetentionFixtures(300);
  const retentionProbe = await fixture.repository.getFileObject(
    retention.ids[0]!,
  );
  if (
    retentionProbe === undefined ||
    retentionProbe.createdAt !== "2020-01-01T00:00:00.000Z" ||
    retentionProbe.metadata.expiresAt !== "2020-01-01T00:00:00.000Z"
  ) {
    throw new Error("The persisted retention fixture lost its expiry fields.");
  }
  const visiblePolicy = await apiJson(
    replacement,
    "/api/v1/governance/retention",
  );
  if (visiblePolicy.data.fileRetentionDays !== 1) {
    throw new Error(
      "The replacement replica did not load the seeded retention policy.",
    );
  }
  checks.retentionFixturePersistedWithExpiry = true;
  checks.retentionPolicyVisibleAcrossReplica = true;
  let enforcementStatus = 0;
  let enforcementSettled = false;
  let enforcementDeletedCount = -1;
  const enforcement = fetch(
    url(replacement, "/api/v1/governance/retention/enforce"),
    { method: "POST" },
  )
    .then(async (response) => {
      enforcementStatus = response.status;
      const responseBody = await response.json().catch(() => undefined);
      enforcementDeletedCount =
        typeof responseBody?.data?.deletedFileObjectCount === "number"
          ? responseBody.data.deletedFileObjectCount
          : -1;
      enforcementSettled = true;
    })
    .catch(() => {
      enforcementStatus = -1;
      enforcementSettled = true;
      return undefined;
    });
  let remainingAtKill = retention.ids.length;
  try {
    await waitFor(
      async () => {
        const remaining = (
          await fixture.repository.listFileObjects("org_default")
        ).filter(
          (file) =>
            retention.ids.includes(file.id) && file.status === "available",
        ).length;
        remainingAtKill = remaining;
        return remaining > 0 && remaining < retention.ids.length;
      },
      20_000,
      "partial retention progress before replica termination",
      10,
    );
  } catch {
    throw new Error(
      `Retention did not expose partial progress: status=${enforcementStatus}, settled=${enforcementSettled}, deleted=${enforcementDeletedCount}, remaining=${remainingAtKill}.`,
    );
  }
  await stopReplica(replacement, "SIGKILL");
  await enforcement;
  checks.replicaKilledDuringRetentionCleanup = true;
  checks.retentionItemsRemainingAtKill = remainingAtKill;

  const completedRetention = await apiJson(
    second,
    "/api/v1/governance/retention/enforce",
    { method: "POST" },
  );
  const remaining = (
    await fixture.repository.listFileObjects("org_default")
  ).filter(
    (file) => retention.ids.includes(file.id) && file.status === "available",
  );
  if (remaining.length !== 0) {
    throw new Error("Replica B did not finish interrupted retention cleanup.");
  }
  for (const key of retention.keys.slice(0, 10)) {
    if ((await objectStore.getObject(key)) !== undefined) {
      throw new Error("A retained object remained after cleanup recovery.");
    }
  }
  if (completedRetention.data.deletedFileObjectCount < 1) {
    throw new Error("Replica B reported no recovered retention work.");
  }
  checks.retentionCleanupRecoveredOnSecondReplica = true;

  await seedTemporaryChat();
  await waitFor(
    async () =>
      (await fixture.repository.getChat("chat_multi_replica_temporary")) ===
      undefined,
    15_000,
    "the shared durable temporary-chat worker",
  );
  if (
    (await objectStore.getObject(
      "chat-attachments/msg_multi_replica_temporary/part_multi_replica_temporary/document.txt",
    )) !== undefined
  ) {
    throw new Error(
      "The surviving worker left the temporary-chat object behind.",
    );
  }
  checks.survivingReplicaWorkerCompleted = true;

  const eventTypes = (await fixture.repository.listRunEvents(run.data.id)).map(
    (event) => event.type,
  );
  if (eventTypes.filter((type) => type === "run.completed").length !== 1) {
    throw new Error("Recovered run emitted a duplicate terminal event.");
  }
  const logs = replicas.flatMap((replica) => replica.logs).join("\n");
  for (const sentinel of Object.values(sentinels)) {
    if (logs.includes(sentinel))
      throw new Error("Replica logs leaked a sentinel.");
  }
  checks.replicaLogsRedacted = true;

  await writeEvidence("passed");
  console.log("Live multi-replica recovery acceptance passed.");
  console.log(`Wrote multi-replica evidence to ${outputPath}`);
} catch (error) {
  await writeEvidence("failed", error);
  throw error;
} finally {
  await Promise.all(replicas.map((replica) => stopReplica(replica, "SIGTERM")));
  await closeServer(provider.server);
  await fixture.close();
}

interface AppReplica {
  name: string;
  port: number;
  process: ChildProcess;
  logs: string[];
}

async function seedRuntime(baseUrl: string): Promise<void> {
  const capabilities = defaultProviderCapabilities("openai-compatible");
  await fixture.repository.createProvider({
    id: "provider_multi_replica",
    orgId: "org_default",
    type: "openai-compatible",
    name: "Controlled multi-replica provider",
    baseUrl: `${baseUrl}/v1`,
    credentialRef: "env://CONTROLLED_PROVIDER_API_KEY",
    modelIds: ["multi-replica-model"],
    enabled: true,
    capabilities,
  });
  await fixture.repository.upsertModels([
    {
      id: "model_multi_replica",
      providerId: "provider_multi_replica",
      name: "multi-replica-model",
      displayName: "Multi-replica model",
      enabled: true,
      capabilities,
      contextWindow: 8_192,
    },
  ]);
  const agent = await fixture.repository.createAgent({
    id: "agent_multi_replica",
    orgId: "org_default",
    workspaceId: "workspace_default",
    name: "Multi-replica agent",
    createdBy: "user_dev_admin",
    baseModelId: "model_multi_replica",
    systemPrompt: "Return a short controlled answer.",
    parameters: { temperature: 0 },
    memoryPolicy: { mode: "disabled" },
    safetySettings: {},
    updatedAt: new Date().toISOString(),
  });
  await fixture.repository.createAgentVersion({
    id: "agent_version_multi_replica_v1",
    agentId: "agent_multi_replica",
    orgId: "org_default",
    workspaceId: "workspace_default",
    version: 1,
    status: "published",
    baseModelId: "model_multi_replica",
    systemPrompt: "Return a short controlled answer.",
    parameters: { temperature: 0 },
    memoryPolicy: { mode: "disabled" },
    safetySettings: {},
    createdBy: "user_dev_admin",
    createdAt: new Date().toISOString(),
    publishedAt: new Date().toISOString(),
  });
  await fixture.repository.updateAgent({
    ...agent,
    publishedVersionId: "agent_version_multi_replica_v1",
    updatedAt: new Date().toISOString(),
  });
  await fixture.repository.upsertRetentionPolicy({
    orgId: "org_default",
    auditLogRetentionDays: 365,
    fileRetentionDays: 1,
    workspaceFileRetentionDays: {},
    userFileRetentionDays: {},
    updatedBy: "user_dev_admin",
    updatedAt: new Date().toISOString(),
  });
}

async function seedRetentionFixtures(count: number): Promise<{
  ids: string[];
  keys: string[];
}> {
  const ids: string[] = [];
  const keys: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = `file_multi_replica_retention_${index}`;
    const key = `multi-replica-retention/${id}.txt`;
    const bytes = Buffer.from(`synthetic retention fixture ${index}`);
    await objectStore.putObject({
      key,
      body: bytes,
      contentType: "text/plain",
    });
    await fixture.repository.createFileObject({
      id,
      orgId: "org_default",
      workspaceId: "workspace_default",
      ownerType: "user",
      ownerId: "user_dev_admin",
      fileName: `retention-${index}.txt`,
      mimeType: "text/plain",
      sizeBytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      objectKey: key,
      purpose: "general",
      status: "available",
      metadata: { expiresAt: "2020-01-01T00:00:00.000Z" },
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    });
    ids.push(id);
    keys.push(key);
  }
  return { ids, keys };
}

async function seedTemporaryChat(): Promise<void> {
  const key =
    "chat-attachments/msg_multi_replica_temporary/part_multi_replica_temporary/document.txt";
  await fixture.repository.createChat({
    id: "chat_multi_replica_temporary",
    orgId: "org_default",
    workspaceId: "workspace_default",
    title: "Expired temporary replica chat",
    temporary: true,
    expiresAt: "2020-01-01T00:00:00.000Z",
    createdBy: "user_dev_admin",
    updatedAt: "2020-01-01T00:00:00.000Z",
  });
  await fixture.repository.createMessage({
    id: "msg_multi_replica_temporary",
    chatId: "chat_multi_replica_temporary",
    role: "user",
    content: "synthetic temporary chat",
    createdAt: "2020-01-01T00:00:00.000Z",
  });
  await fixture.repository.createMessageParts([
    {
      id: "part_multi_replica_temporary",
      messageId: "msg_multi_replica_temporary",
      type: "attachment",
      content: key,
      metadata: {},
    },
  ]);
  await objectStore.putObject({
    key,
    body: Buffer.from("synthetic temporary object"),
    contentType: "text/plain",
  });
}

async function startReplica(name: string, port: number): Promise<AppReplica> {
  const logs: string[] = [];
  const child = spawn(process.execPath, [serverEntry], {
    cwd: repoRoot,
    env: {
      ...process.env,
      APP_ORIGIN: `http://127.0.0.1:${port}`,
      CONTROLLED_PROVIDER_API_KEY: sentinels.secret,
      DATABASE_URL: fixture.databaseUrl,
      DEV_SEEDED_LOGIN: "true",
      LOCAL_AUTH_SECRET_ENCRYPTION_KEY: "multi-replica-local-auth-key-32-bytes",
      MANAGED_SECRET_ENCRYPTION_KEY: "multi-replica-managed-key-32-bytes-long",
      MODEL_PROVIDER_RETRY_ATTEMPTS: "0",
      MODEL_PROVIDER_STREAM_TIMEOUT_MS: "300000",
      OBJECT_STORE_DRIVER: "s3",
      PORT: String(port),
      REPOSITORY_DRIVER: "postgres",
      RUN_EXECUTION_LEASE_SECONDS: "2",
      RUN_RECOVERY_STALE_MS: "3000",
      S3_ACCESS_KEY_ID: s3.accessKeyId,
      S3_BUCKET: s3.bucket,
      S3_ENDPOINT: s3.endpoint,
      S3_REGION: s3.region,
      S3_SECRET_ACCESS_KEY: s3.secretAccessKey,
      SECRET_RESOLVER_DRIVER: "env",
      SESSION_SECRET: "multi-replica-session-key-32-bytes-long",
      TEMPORARY_CHAT_CLEANUP_BATCH_SIZE: "100",
      TEMPORARY_CHAT_CLEANUP_ENABLED: "true",
      TEMPORARY_CHAT_CLEANUP_INTERVAL_MS: "10000",
      TEMPORARY_CHAT_CLEANUP_LEASE_SECONDS: "30",
      WEBHOOK_SIGNING_KEY: "multi-replica-webhook-key-32-bytes-long",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const collect = (chunk: Buffer) => {
    logs.push(chunk.toString("utf8"));
    if (logs.length > 200) logs.shift();
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  const replica = { name, port, process: child, logs };
  replicas.push(replica);
  await waitFor(
    async () => {
      if (child.exitCode !== null) {
        throw new Error(`${name} exited before becoming healthy.`);
      }
      const response = await fetch(url(replica, "/api/v1/health"));
      if (!response.ok) {
        throw new Error(`${name} health returned HTTP ${response.status}.`);
      }
      return true;
    },
    20_000,
    `${name} health`,
  );
  return replica;
}

async function stopReplica(
  replica: AppReplica,
  signal: NodeJS.Signals,
): Promise<void> {
  if (replica.process.exitCode !== null || replica.process.signalCode !== null)
    return;
  replica.process.kill(signal);
  await Promise.race([
    new Promise<void>((resolveExit) =>
      replica.process.once("exit", () => resolveExit()),
    ),
    sleep(5_000),
  ]);
  if (
    replica.process.exitCode === null &&
    replica.process.signalCode === null
  ) {
    replica.process.kill("SIGKILL");
  }
}

async function controlledProviderServer(): Promise<{
  server: Server;
  baseUrl: string;
  requestCount: () => number;
}> {
  let requests = 0;
  const server = createServer((request, response) => {
    if (request.url === "/v1/models") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ data: [{ id: "multi-replica-model" }] }));
      return;
    }
    if (request.url !== "/v1/chat/completions" || request.method !== "POST") {
      response.statusCode = 404;
      response.end();
      return;
    }
    requests += 1;
    request.resume();
    if (requests === 1) {
      request.socket.once("close", () => {
        if (!response.writableEnded) response.destroy();
      });
      return;
    }
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
    });
    for (const payload of [
      { choices: [{ delta: { role: "assistant" }, finish_reason: null }] },
      {
        choices: [
          {
            delta: { content: `recovered response ${requests}` },
            finish_reason: null,
          },
        ],
      },
      {
        choices: [{ delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
      },
    ]) {
      response.write(`data: ${JSON.stringify(payload)}\n\n`);
    }
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Controlled provider did not expose a TCP port.");
  }
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    requestCount: () => requests,
  };
}

async function apiJson(
  replica: AppReplica,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    expectedStatus?: number;
  } = {},
): Promise<any> {
  const response = await fetch(url(replica, path), {
    method: options.method ?? "GET",
    ...(options.body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(options.body),
        }),
  });
  const body = await response.json().catch(() => ({}));
  const expected = options.expectedStatus ?? 200;
  if (response.status !== expected) {
    throw new Error(
      `${replica.name} ${options.method ?? "GET"} ${path} returned ${response.status} instead of ${expected}: ${JSON.stringify(body)}`,
    );
  }
  return body;
}

function url(replica: AppReplica, path: string): string {
  return `http://127.0.0.1:${replica.port}${path}`;
}

async function waitFor(
  check: () => boolean | Promise<boolean>,
  timeoutMs: number,
  label: string,
  pollMs = 100,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(pollMs);
  }
  throw new Error(
    `Timed out waiting for ${label}.${lastError instanceof Error ? ` ${lastError.message}` : ""}`,
  );
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Could not allocate a local port.");
  }
  const port = address.port;
  await closeServer(server);
  return port;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose) => server.close(() => resolveClose()));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function ensureBucket(input: typeof s3): Promise<void> {
  const request = await createS3PresignedRequest({
    ...input,
    key: "",
    method: "PUT",
    expiresInSeconds: 300,
  });
  const response = await fetch(request.url, {
    method: "PUT",
    headers: request.headers,
  });
  if (response.ok) return;
  const body = await response.text();
  if (response.status === 409 && /BucketAlreadyOwnedByYou/u.test(body)) return;
  throw new Error(`Bucket creation failed with HTTP ${response.status}.`);
}

async function writeEvidence(
  status: "failed" | "passed",
  error?: unknown,
): Promise<void> {
  const serializedReplicaLogs = replicas
    .flatMap((replica) => replica.logs)
    .join("\n");
  const evidence = {
    schemaVersion: "romeo.live-multi-replica-recovery-acceptance.v1",
    generatedAt: new Date().toISOString(),
    status,
    durationMs: Math.round(performance.now() - startedAt),
    target: {
      appProcesses: 2,
      replacementProcesses: replicas.length > 2 ? 1 : 0,
      repositoryDriver: "postgres",
      objectStoreDriver: "s3",
      providerProtocol: "openai-compatible-sse",
    },
    checks,
    observations: {
      providerRequestCount: provider.requestCount(),
      replicaLogBytes: Buffer.byteLength(serializedReplicaLogs, "utf8"),
      replicaLogSha256: createHash("sha256")
        .update(serializedReplicaLogs)
        .digest("hex"),
    },
    redaction: {
      databaseUrlReturned: false,
      objectStoreEndpointReturned: false,
      objectStoreCredentialsReturned: false,
      promptBodiesReturned: false,
      providerPayloadsReturned: false,
      replicaLogsReturned: false,
    },
    ...(error === undefined
      ? {}
      : {
          failureCode:
            error instanceof Error
              ? createHash("sha256")
                  .update(error.message)
                  .digest("hex")
                  .slice(0, 16)
              : "unknown",
        }),
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}
