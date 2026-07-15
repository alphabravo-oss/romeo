import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  generateScaleFixtures,
  summarizeScaleFixtures,
  validateScaleFixtures,
} from "./lib/scale-fixtures.mjs";

const outputPath = argValue("--output");
const baseUrl = argValue("--base-url");
const apiKey = argValue("--api-key") ?? process.env.ROMEO_API_KEY;
const dryRun = process.argv.includes("--dry-run") || baseUrl === undefined;
const fixtures = readFixtures();

validateScaleFixtures(fixtures);
const plan = loadPlan(fixtures);

const evidence = dryRun
  ? dryRunEvidence(fixtures, plan)
  : await liveEvidence(fixtures, plan);

const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
if (outputPath === undefined) process.stdout.write(serialized);
else {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, serialized);
}

function readFixtures() {
  const fixturePath = argValue("--fixture-file");
  if (fixturePath !== undefined) {
    return JSON.parse(readFileSync(fixturePath, "utf8"));
  }
  return generateScaleFixtures({
    tier: argValue("--tier") ?? "local",
    seed: argValue("--seed"),
  });
}

function loadPlan(input) {
  return {
    checks: [
      "scale_fixture_validation",
      "health_read",
      "admin_readiness_read",
      "chat_write_driver",
      "knowledge_source_write_driver",
      "run_write_driver",
      "attachment_write_driver",
      "comment_notification_driver",
      "knowledge_query_driver",
      "admin_listing_driver",
      "connector_sync_driver",
      "tool_dispatch_request_driver",
    ],
    operationCounts: {
      healthReads: 1,
      readinessReads: 1,
      chatWrites: input.chats.length,
      knowledgeSourceWrites: input.knowledgeSources.length,
      runWrites: input.runs.length,
      attachmentWrites: input.attachments.length,
      commentWrites: input.comments.length,
      knowledgeQueries: Math.min(input.knowledgeSources.length, 3),
      adminListReads: input.adminListReads.length,
      connectorSyncs: input.connectorSyncs.length,
      toolDispatchRequests: input.toolDispatches.length,
    },
  };
}

function dryRunEvidence(input, plan) {
  return {
    schemaVersion: "romeo.scale-load-smoke.v1",
    generatedAt: new Date().toISOString(),
    status: "planned",
    mode: "dry-run",
    fixtureReport: summarizeScaleFixtures(input),
    checks: plan.checks,
    operationCounts: plan.operationCounts,
    notes: [
      "Dry-run validates synthetic fixture safety and load-driver coverage without contacting a Romeo API.",
      "Run with --base-url and --api-key to collect live latency and read/write evidence.",
    ],
  };
}

async function liveEvidence(input, plan) {
  if (baseUrl === undefined || baseUrl.length === 0) {
    throw new Error("--base-url is required unless --dry-run is set.");
  }
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error("--api-key or ROMEO_API_KEY is required for live mode.");
  }

  const metrics = [];
  const chatIds = new Map();
  const sourceIds = [];
  const connectorSyncIds = [];
  const toolDispatchRequestIds = [];
  const cancelledToolDispatchRequestIds = [];

  await record(metrics, "health_read", () =>
    request("/api/v1/health", { token: undefined }),
  );
  await record(metrics, "admin_readiness_read", () =>
    request("/api/v1/admin/readiness"),
  );

  for (const chat of input.chats) {
    const response = await record(metrics, "chat_write", () =>
      request("/api/v1/chats", {
        method: "POST",
        expectedStatus: 201,
        body: { workspaceId: chat.workspaceId, title: chat.title },
      }),
    );
    chatIds.set(chat.id, response.data.id);
  }

  for (const source of input.knowledgeSources) {
    const response = await record(metrics, "knowledge_source_write", () =>
      request(`/api/v1/knowledge-bases/${source.knowledgeBaseId}/sources`, {
        method: "POST",
        expectedStatus: 202,
        body: {
          fileName: source.fileName,
          mimeType: source.mimeType,
          sizeBytes: source.sizeBytes,
          content: source.content,
        },
      }),
    );
    sourceIds.push({ id: response.data.id, marker: source.id });
  }

  for (const run of input.runs) {
    await record(metrics, "run_write", () =>
      request("/api/v1/runs", {
        method: "POST",
        expectedStatus: 202,
        body: {
          chatId: requireChatId(chatIds, run.chatFixtureId),
          agentId: run.agentId,
          content: run.content,
        },
      }),
    );
  }

  for (const attachment of input.attachments) {
    await record(metrics, "attachment_write", () =>
      request("/api/v1/runs", {
        method: "POST",
        expectedStatus: 202,
        body: {
          chatId: requireChatId(chatIds, attachment.chatFixtureId),
          agentId: attachment.agentId,
          content: attachment.content,
          attachments: [
            {
              fileName: attachment.fileName,
              mimeType: attachment.mimeType,
              sizeBytes: attachment.sizeBytes,
              dataBase64: attachment.dataBase64,
            },
          ],
        },
      }),
    );
  }

  for (const comment of input.comments) {
    await record(metrics, "comment_write", () =>
      request(
        `/api/v1/chats/${requireChatId(chatIds, comment.chatFixtureId)}/comments`,
        {
          method: "POST",
          expectedStatus: 201,
          body: { body: comment.body },
        },
      ),
    );
  }

  for (const source of input.knowledgeSources.slice(0, 3)) {
    await record(metrics, "knowledge_query", () =>
      request(`/api/v1/knowledge-bases/${source.knowledgeBaseId}/query`, {
        method: "POST",
        body: { query: source.id, maxResults: 5 },
      }),
    );
  }

  for (const path of input.adminListReads) {
    await record(metrics, "admin_list_read", () => request(path));
  }

  for (const connector of input.connectorSyncs) {
    const created = await record(metrics, "connector_create", () =>
      request("/api/v1/data-connectors", {
        method: "POST",
        expectedStatus: 201,
        body: {
          workspaceId: connector.workspaceId,
          knowledgeBaseId: connector.knowledgeBaseId,
          type: connector.type,
          name: connector.name,
          config: connector.config,
        },
      }),
    );
    const sync = await record(metrics, "connector_sync", () =>
      request(`/api/v1/data-connectors/${pathId(created.data.id)}/sync`, {
        method: "POST",
        expectedStatus: 202,
        body: { items: connector.items },
      }),
    );
    await record(metrics, "connector_sync_readback", () =>
      request(`/api/v1/data-connectors/${pathId(created.data.id)}/syncs`),
    );
    connectorSyncIds.push(sync.data.id);
  }

  for (const dispatch of input.toolDispatches) {
    const imported = await record(metrics, "tool_import_openapi", () =>
      request("/api/v1/tools/openapi", {
        method: "POST",
        expectedStatus: 201,
        body: {
          name: dispatch.name,
          approvalPolicy: "never",
          riskLevel: "low",
          spec: toolDispatchSpec(dispatch),
        },
      }),
    );
    const connectorId = imported.data.connector.id;
    const operationId =
      imported.data.operations[0]?.operationId ?? dispatch.operationId;
    await record(metrics, "tool_connector_enable", () =>
      request(`/api/v1/tool-connectors/${pathId(connectorId)}`, {
        method: "PATCH",
        body: { enabled: true },
      }),
    );
    await record(metrics, "tool_connector_network_policy", () =>
      request(`/api/v1/tool-connectors/${pathId(connectorId)}/network-policy`, {
        method: "PATCH",
        body: {
          mode: "allow_hosts",
          allowedHosts: [dispatch.allowedHost],
          allowPrivateNetwork: false,
        },
      }),
    );
    await record(metrics, "tool_operation_enable", () =>
      request(
        `/api/v1/tool-connectors/${pathId(connectorId)}/operations/${pathId(operationId)}`,
        {
          method: "PATCH",
          body: { enabled: true },
        },
      ),
    );
    await record(metrics, "tool_operation_preview", () =>
      request(
        `/api/v1/tool-connectors/${pathId(connectorId)}/operations/${pathId(operationId)}/test`,
        {
          method: "POST",
          body: {
            parameters: dispatch.parameters,
            body: dispatch.body,
          },
        },
      ),
    );
    const queued = await record(metrics, "tool_dispatch_request_enqueue", () =>
      request(
        `/api/v1/tool-connectors/${pathId(connectorId)}/operations/${pathId(operationId)}/dispatch-requests`,
        {
          method: "POST",
          body: {
            parameters: dispatch.parameters,
            body: dispatch.body,
            idempotencyKey: dispatch.id,
          },
        },
      ),
    );
    const jobId = queued.data.job.id;
    toolDispatchRequestIds.push(jobId);
    await record(metrics, "tool_dispatch_request_cancel", () =>
      request(
        `/api/v1/tool-operation-dispatch-requests/${pathId(jobId)}/cancel`,
        {
          method: "POST",
          body: { reasonCode: "scale_smoke_complete" },
        },
      ),
    );
    cancelledToolDispatchRequestIds.push(jobId);
  }

  return {
    schemaVersion: "romeo.scale-load-smoke.v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    mode: "live",
    fixtureReport: summarizeScaleFixtures(input),
    checks: plan.checks,
    operationCounts: plan.operationCounts,
    created: {
      chats: chatIds.size,
      knowledgeSources: sourceIds.length,
      connectorSyncs: connectorSyncIds.length,
      toolDispatchRequests: toolDispatchRequestIds.length,
    },
    cancelled: {
      toolDispatchRequests: cancelledToolDispatchRequestIds.length,
    },
    latencyMs: summarizeMetrics(metrics),
    workerExecution: {
      toolDispatchesExecuted: 0,
      reason:
        "Scale load smoke exercises dispatch-request queue lifecycle and cancellation without external worker network execution.",
    },
  };
}

function toolDispatchSpec(dispatch) {
  return {
    openapi: "3.1.0",
    info: { title: dispatch.name, version: "1.0.0" },
    servers: [{ url: dispatch.serverUrl }],
    paths: {
      [dispatch.path]: {
        [dispatch.method]: {
          operationId: dispatch.operationId,
          summary: dispatch.name,
          parameters: [
            {
              in: "path",
              name: "fixtureId",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    fixtureId: { type: "string" },
                    sequence: { type: "integer" },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Synthetic scale response",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: true,
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

async function record(metrics, name, operation) {
  const startedAt = performance.now();
  const result = await operation();
  metrics.push({ name, durationMs: Math.round(performance.now() - startedAt) });
  return result;
}

function summarizeMetrics(metrics) {
  const durations = metrics
    .map((metric) => metric.durationMs)
    .sort((a, b) => a - b);
  return {
    count: durations.length,
    min: durations[0] ?? 0,
    p50: percentile(durations, 0.5),
    p95: percentile(durations, 0.95),
    max: durations.at(-1) ?? 0,
    byOperation: Object.fromEntries(
      [...new Set(metrics.map((metric) => metric.name))].map((name) => {
        const subset = metrics
          .filter((metric) => metric.name === name)
          .map((metric) => metric.durationMs)
          .sort((a, b) => a - b);
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

function percentile(values, percentileValue) {
  if (values.length === 0) return 0;
  const index = Math.min(
    values.length - 1,
    Math.ceil(values.length * percentileValue) - 1,
  );
  return values[index];
}

async function request(path, options = {}) {
  const url = new URL(path, normalizedBaseUrl());
  const headers = { accept: "application/json" };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.token !== undefined || apiKey !== undefined) {
    headers.authorization = `Bearer ${options.token ?? apiKey}`;
  }
  const response = await fetch(url, {
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

function requireChatId(chatIds, fixtureId) {
  const id = chatIds.get(fixtureId);
  if (id === undefined) {
    throw new Error(`No live chat id for fixture ${fixtureId}.`);
  }
  return id;
}

function pathId(value) {
  return encodeURIComponent(value);
}

function normalizedBaseUrl() {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}
