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

const adminDatabaseUrl = postgresConformanceDatabaseUrl();
if (adminDatabaseUrl === undefined) {
  throw new Error("ROMEO_POSTGRES_CONFORMANCE_DATABASE_URL is required.");
}

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const serverEntry = resolve(repoRoot, "apps/app/.output/server/index.mjs");
const outputPath = resolve(
  repoRoot,
  argValue("--output") ?? "dist/evidence/live-chat-load-soak.json",
);
const chatCount = positiveIntegerArg("--chats", 40);
const concurrency = positiveIntegerArg("--concurrency", 10);
const soakSeconds = positiveIntegerArg("--soak-seconds", 15);
const thresholds = {
  chatCreateP95Ms: positiveIntegerArg("--chat-create-p95-ms", 750),
  searchP95Ms: positiveIntegerArg("--search-p95-ms", 750),
  runStartP95Ms: positiveIntegerArg("--run-start-p95-ms", 1_000),
  queueEnqueueP95Ms: positiveIntegerArg("--queue-enqueue-p95-ms", 1_000),
  loadCompletionMs: positiveIntegerArg("--load-completion-ms", 30_000),
} as const;
const secret = `load_soak_secret_${randomUUID()}`;
const promptMarker = `LOAD_SOAK_PROMPT_${randomUUID()}`;
const titleMarker = `Load soak ${randomUUID()}`;
const fixture = await createLivePostgresRepositoryFixture(adminDatabaseUrl);
const provider = await controlledProviderServer();
const ports = [await freePort(), await freePort()];
const replicas: AppReplica[] = [];
const metrics: Metric[] = [];
const startedAt = performance.now();
const checks: Record<string, boolean | number> = {};

try {
  await seedRuntime(provider.baseUrl);
  const first = await startReplica("load-replica-a", ports[0]!);
  const second = await startReplica("load-replica-b", ports[1]!);
  checks.healthyReplicas = 2;

  const chatInputs = Array.from({ length: chatCount }, (_, index) => index);
  const chats = await mapConcurrent(chatInputs, concurrency, async (index) => {
    const replica = replicas[index % replicas.length]!;
    const response = await timed("chat_create", () =>
      apiJson(replica, "/api/v1/chats", {
        method: "POST",
        expectedStatus: 201,
        body: {
          workspaceId: "workspace_default",
          title: `${titleMarker} ${index}`,
        },
      }),
    );
    return response.data as { id: string };
  });
  checks.chatsCreated = chats.length;

  for (let index = 0; index < Math.min(10, chatCount); index += 1) {
    const result = await timed("chat_search", () =>
      apiJson(
        replicas[index % replicas.length]!,
        `/api/v1/chats/query?workspaceId=workspace_default&q=${encodeURIComponent(`${titleMarker} ${index}`)}`,
      ),
    );
    if (
      !result.data.some((chat: { id: string }) => chat.id === chats[index]!.id)
    ) {
      throw new Error("Chat search did not return its generated load fixture.");
    }
  }
  checks.searchReadAfterWrite = true;

  const runs = await mapConcurrent(chats, concurrency, async (chat, index) => {
    const response = await timed("run_start", () =>
      apiJson(replicas[index % replicas.length]!, "/api/v1/runs", {
        method: "POST",
        expectedStatus: 202,
        body: {
          chatId: chat.id,
          agentId: "agent_load_soak",
          content: `${promptMarker} initial ${index}`,
        },
      }),
    );
    return response.data as { id: string };
  });

  const disconnectedAfter = await disconnectAfterFirstSseChunk(
    first,
    runs[0]!.id,
  );
  checks.sseConnectionInterrupted = true;

  const queuedTurns = await mapConcurrent(
    chats,
    concurrency,
    async (chat, index) => {
      const response = await timed("queue_enqueue", () =>
        apiJson(
          replicas[(index + 1) % replicas.length]!,
          `/api/v1/chats/${chat.id}/queue`,
          {
            method: "POST",
            expectedStatus: 202,
            body: {
              agentId: "agent_load_soak",
              content: `${promptMarker} queued ${index}`,
              idempotencyKey: `load-soak-${index}`,
            },
          },
        ),
      );
      return response.data as { id: string };
    },
  );
  const queuedDepth = await currentQueueDepth(chats.map((chat) => chat.id));
  checks.observedQueueDepth = queuedDepth;
  if (queuedDepth < Math.floor(chatCount * 0.8)) {
    throw new Error(
      "The load test did not establish representative queue depth.",
    );
  }

  const reconnectedSse = fetch(
    url(
      second,
      `/api/v1/runs/${runs[0]!.id}/events?after=${disconnectedAfter}`,
    ),
  ).then(async (response) => {
    const text = await response.text();
    if (response.status !== 200 || !text.includes("run.completed")) {
      throw new Error("Cross-replica SSE reconnect missed the terminal event.");
    }
  });

  const loadDeadline = performance.now() + thresholds.loadCompletionMs;
  let maxObservedQueueDepth = queuedDepth;
  while (performance.now() < loadDeadline) {
    const [runRecords, queuedRecords, chatRuns, queueDepth] = await Promise.all(
      [
        Promise.all(runs.map((run) => fixture.repository.getRun(run.id))),
        Promise.all(
          queuedTurns.map((turn) =>
            fixture.repository.getQueuedChatTurn(turn.id),
          ),
        ),
        Promise.all(chats.map((chat) => fixture.repository.listRuns(chat.id))),
        currentQueueDepth(chats.map((chat) => chat.id)),
      ],
    );
    maxObservedQueueDepth = Math.max(maxObservedQueueDepth, queueDepth);
    if (
      runRecords.every((run) => run?.status === "completed") &&
      queuedRecords.every((turn) => turn?.status === "completed") &&
      chatRuns.every(
        (records) =>
          records.length === 2 &&
          records.every((run) => run.status === "completed"),
      )
    ) {
      break;
    }
    await sleep(50);
  }
  const loadDurationMs = Math.round(
    thresholds.loadCompletionMs - Math.max(0, loadDeadline - performance.now()),
  );
  const completedRuns = await Promise.all(
    chats.map((chat) => fixture.repository.listRuns(chat.id)),
  );
  if (
    completedRuns.some(
      (chatRuns) =>
        chatRuns.length !== 2 ||
        chatRuns.some((run) => run.status !== "completed"),
    )
  ) {
    const distribution = completedRuns.reduce<Record<string, number>>(
      (result, chatRuns) => {
        const key = `${chatRuns.length}:${chatRuns
          .map((run) => run.status)
          .sort()
          .join(",")}`;
        result[key] = (result[key] ?? 0) + 1;
        return result;
      },
      {},
    );
    throw new Error(
      `Run or queued-turn load did not drain before the threshold: ${JSON.stringify(distribution)}.`,
    );
  }
  await reconnectedSse;
  checks.runsCompleted = completedRuns.reduce(
    (count, chatRuns) => count + chatRuns.length,
    0,
  );
  checks.maximumQueueDepth = maxObservedQueueDepth;
  checks.queueDrained = true;
  checks.sseReconnectedAcrossReplicas = true;

  const soakStartedAt = performance.now();
  let soakIterations = 0;
  while (performance.now() - soakStartedAt < soakSeconds * 1_000) {
    const index = soakIterations % chatCount;
    await Promise.all([
      timed("soak_health", () =>
        apiJson(replicas[index % replicas.length]!, "/api/v1/health"),
      ),
      timed("chat_search", () =>
        apiJson(
          replicas[(index + 1) % replicas.length]!,
          `/api/v1/chats/query?workspaceId=workspace_default&q=${encodeURIComponent(`${titleMarker} ${index}`)}`,
        ),
      ),
    ]);
    soakIterations += 1;
    await sleep(100);
  }
  const observedSoakMs = Math.round(performance.now() - soakStartedAt);
  checks.soakDurationObserved = observedSoakMs >= soakSeconds * 1_000;
  checks.soakIterations = soakIterations;

  const summary = summarizeMetrics(metrics);
  assertP95(summary, "chat_create", thresholds.chatCreateP95Ms);
  assertP95(summary, "chat_search", thresholds.searchP95Ms);
  assertP95(summary, "run_start", thresholds.runStartP95Ms);
  assertP95(summary, "queue_enqueue", thresholds.queueEnqueueP95Ms);
  if (provider.requestCount() !== chatCount * 2) {
    throw new Error(
      "Provider request count did not match completed run count.",
    );
  }
  checks.latencyThresholdsPassed = true;
  checks.zeroRequestErrors = true;

  const logs = replicas.flatMap((replica) => replica.logs).join("\n");
  for (const sentinel of [secret, promptMarker, titleMarker]) {
    if (logs.includes(sentinel))
      throw new Error("Replica logs leaked a load sentinel.");
  }
  checks.replicaLogsRedacted = true;

  await writeEvidence("passed", {
    loadDurationMs,
    observedSoakMs,
    soakIterations,
    summary,
  });
  console.log("Live chat load/soak acceptance passed.");
  console.log(`Wrote load/soak evidence to ${outputPath}`);
} catch (error) {
  await writeEvidence("failed", undefined, error);
  throw error;
} finally {
  await Promise.all(replicas.map((replica) => stopReplica(replica)));
  await closeServer(provider.server);
  await fixture.close();
}

interface AppReplica {
  name: string;
  port: number;
  process: ChildProcess;
  logs: string[];
}

interface Metric {
  name: string;
  durationMs: number;
}

interface MetricSummary {
  count: number;
  min: number;
  p50: number;
  p95: number;
  max: number;
  byOperation: Record<string, { count: number; p50: number; p95: number }>;
}

async function seedRuntime(baseUrl: string): Promise<void> {
  const capabilities = defaultProviderCapabilities("openai-compatible");
  await fixture.repository.createProvider({
    id: "provider_load_soak",
    orgId: "org_default",
    type: "openai-compatible",
    name: "Controlled load/soak provider",
    baseUrl: `${baseUrl}/v1`,
    credentialRef: "env://LOAD_SOAK_PROVIDER_API_KEY",
    modelIds: ["load-soak-model"],
    enabled: true,
    capabilities,
  });
  await fixture.repository.upsertModels([
    {
      id: "model_load_soak",
      providerId: "provider_load_soak",
      name: "load-soak-model",
      displayName: "Load/soak model",
      enabled: true,
      capabilities,
      contextWindow: 8_192,
    },
  ]);
  const agent = await fixture.repository.createAgent({
    id: "agent_load_soak",
    orgId: "org_default",
    workspaceId: "workspace_default",
    name: "Load/soak agent",
    createdBy: "user_dev_admin",
    baseModelId: "model_load_soak",
    systemPrompt: "Return a short controlled answer.",
    parameters: { temperature: 0 },
    memoryPolicy: { mode: "disabled" },
    safetySettings: {},
    updatedAt: new Date().toISOString(),
  });
  await fixture.repository.createAgentVersion({
    id: "agent_version_load_soak_v1",
    agentId: "agent_load_soak",
    orgId: "org_default",
    workspaceId: "workspace_default",
    version: 1,
    status: "published",
    baseModelId: "model_load_soak",
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
    publishedVersionId: "agent_version_load_soak_v1",
    updatedAt: new Date().toISOString(),
  });
}

async function startReplica(name: string, port: number): Promise<AppReplica> {
  const logs: string[] = [];
  const child = spawn(process.execPath, [serverEntry], {
    cwd: repoRoot,
    env: {
      ...process.env,
      APP_ORIGIN: `http://127.0.0.1:${port}`,
      DATABASE_URL: fixture.databaseUrl,
      DEV_SEEDED_LOGIN: "true",
      LOAD_SOAK_PROVIDER_API_KEY: secret,
      LOCAL_AUTH_SECRET_ENCRYPTION_KEY: "load-soak-local-auth-key-32-bytes",
      MANAGED_SECRET_ENCRYPTION_KEY: "load-soak-managed-key-32-bytes-long",
      MODEL_PROVIDER_RETRY_ATTEMPTS: "0",
      MODEL_PROVIDER_STREAM_TIMEOUT_MS: "30000",
      OBJECT_STORE_DRIVER: "memory",
      PORT: String(port),
      REPOSITORY_DRIVER: "postgres",
      RUN_EXECUTION_LEASE_SECONDS: "5",
      RUN_RECOVERY_STALE_MS: "10000",
      SECRET_RESOLVER_DRIVER: "env",
      SESSION_SECRET: "load-soak-session-key-32-bytes-long",
      TEMPORARY_CHAT_CLEANUP_ENABLED: "false",
      WEBHOOK_SIGNING_KEY: "load-soak-webhook-key-32-bytes-long",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const collect = (chunk: Buffer) => {
    logs.push(chunk.toString("utf8"));
    if (logs.length > 500) logs.shift();
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  const replica = { name, port, process: child, logs };
  replicas.push(replica);
  await waitFor(
    async () => {
      if (child.exitCode !== null)
        throw new Error(`${name} exited during startup.`);
      return (await fetch(url(replica, "/api/v1/health"))).ok;
    },
    20_000,
    `${name} health`,
  );
  return replica;
}

async function stopReplica(replica: AppReplica): Promise<void> {
  if (replica.process.exitCode !== null || replica.process.signalCode !== null)
    return;
  replica.process.kill("SIGTERM");
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
  const server = createServer(async (request, response) => {
    if (request.url === "/v1/models") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ data: [{ id: "load-soak-model" }] }));
      return;
    }
    if (request.url !== "/v1/chat/completions" || request.method !== "POST") {
      response.statusCode = 404;
      response.end();
      return;
    }
    requests += 1;
    request.resume();
    await sleep(250);
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
    });
    response.write(
      `data: ${JSON.stringify({ choices: [{ delta: { role: "assistant" }, finish_reason: null }] })}\n\n`,
    );
    await sleep(25);
    response.write(
      `data: ${JSON.stringify({ choices: [{ delta: { content: "controlled load response" }, finish_reason: null }] })}\n\n`,
    );
    response.write(
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 } })}\n\n`,
    );
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

async function disconnectAfterFirstSseChunk(
  replica: AppReplica,
  runId: string,
): Promise<number> {
  const controller = new AbortController();
  const response = await fetch(
    url(replica, `/api/v1/runs/${runId}/events?after=0`),
    {
      signal: controller.signal,
    },
  );
  const reader = response.body?.getReader();
  const chunk = await reader?.read();
  controller.abort();
  const text =
    chunk?.value === undefined ? "" : new TextDecoder().decode(chunk.value);
  const sequenceMatches = [...text.matchAll(/^id:\s*(\d+)$/gmu)];
  return sequenceMatches.length === 0 ? 0 : Number(sequenceMatches.at(-1)![1]);
}

async function currentQueueDepth(chatIds: string[]): Promise<number> {
  const queues = await Promise.all(
    chatIds.map((chatId) => fixture.repository.listQueuedChatTurns(chatId)),
  );
  return queues.reduce(
    (count, turns) =>
      count +
      turns.filter((turn) => ["queued", "running"].includes(turn.status))
        .length,
    0,
  );
}

async function timed<T>(name: string, operation: () => Promise<T>): Promise<T> {
  const operationStartedAt = performance.now();
  const result = await operation();
  metrics.push({
    name,
    durationMs: Math.round(performance.now() - operationStartedAt),
  });
  return result;
}

function summarizeMetrics(input: Metric[]): MetricSummary {
  const durations = input.map((metric) => metric.durationMs).sort(numberSort);
  const names = [...new Set(input.map((metric) => metric.name))];
  return {
    count: durations.length,
    min: durations[0] ?? 0,
    p50: percentile(durations, 0.5),
    p95: percentile(durations, 0.95),
    max: durations.at(-1) ?? 0,
    byOperation: Object.fromEntries(
      names.map((name) => {
        const subset = input
          .filter((metric) => metric.name === name)
          .map((metric) => metric.durationMs)
          .sort(numberSort);
        return [
          name,
          {
            count: subset.length,
            p50: percentile(subset, 0.5),
            p95: percentile(subset, 0.95),
          },
        ];
      }),
    ),
  };
}

function assertP95(
  summary: MetricSummary,
  operation: string,
  maximumMs: number,
): void {
  const observed = summary.byOperation[operation]?.p95;
  if (observed === undefined || observed > maximumMs) {
    throw new Error(`${operation} exceeded its p95 latency threshold.`);
  }
}

async function writeEvidence(
  status: "failed" | "passed",
  result?: {
    loadDurationMs: number;
    observedSoakMs: number;
    soakIterations: number;
    summary: MetricSummary;
  },
  error?: unknown,
): Promise<void> {
  const serializedLogs = replicas.flatMap((replica) => replica.logs).join("\n");
  const evidence = {
    schemaVersion: "romeo.live-chat-load-soak.v1",
    generatedAt: new Date().toISOString(),
    status,
    durationMs: Math.round(performance.now() - startedAt),
    target: {
      appProcesses: 2,
      repositoryDriver: "postgres",
      providerProtocol: "openai-compatible-sse",
      chatCount,
      concurrentClients: concurrency,
      queuedTurnsPerChat: 1,
    },
    thresholds,
    checks,
    ...(result === undefined
      ? {}
      : {
          observations: {
            loadDurationMs: result.loadDurationMs,
            requestedSoakMs: soakSeconds * 1_000,
            observedSoakMs: result.observedSoakMs,
            soakIterations: result.soakIterations,
            providerRequestCount: provider.requestCount(),
            latencyMs: result.summary,
            replicaLogBytes: Buffer.byteLength(serializedLogs, "utf8"),
            replicaLogSha256: createHash("sha256")
              .update(serializedLogs)
              .digest("hex"),
          },
        }),
    redaction: {
      databaseUrlReturned: false,
      providerEndpointReturned: false,
      credentialsReturned: false,
      chatTitlesReturned: false,
      promptsReturned: false,
      responsesReturned: false,
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

async function apiJson(
  replica: AppReplica,
  path: string,
  options: { method?: string; body?: unknown; expectedStatus?: number } = {},
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
  const expectedStatus = options.expectedStatus ?? 200;
  if (response.status !== expectedStatus) {
    throw new Error(
      `${options.method ?? "GET"} ${path} returned an unexpected status.`,
    );
  }
  return body;
}

async function mapConcurrent<T, U>(
  values: T[],
  limit: number,
  operation: (value: T, index: number) => Promise<U>,
): Promise<U[]> {
  const output = new Array<U>(values.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        output[index] = await operation(values[index]!, index);
      }
    }),
  );
  return output;
}

async function waitFor(
  check: () => boolean | Promise<boolean>,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch {
      // A replica may be accepting TCP just before its health route is ready.
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Could not allocate a loopback port.");
  }
  const port = address.port;
  await closeServer(server);
  return port;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose) => server.close(() => resolveClose()));
}

function url(replica: AppReplica, path: string): string {
  return `http://127.0.0.1:${replica.port}${path}`;
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  return values[
    Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1)
  ]!;
}

function numberSort(left: number, right: number): number {
  return left - right;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function positiveIntegerArg(name: string, fallback: number): number {
  const value = argValue(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}
