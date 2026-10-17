import { apiJson } from "./compose-smoke-support.mjs";

export const composeWorkerCommands = [
  {
    name: "webhook_retry",
    profile: "workers",
    service: "webhook-retry-worker",
    component: "webhook-retry",
    command: [
      "pnpm",
      "--filter",
      "@romeo/cli",
      "start",
      "--",
      "workers",
      "webhook-retry",
      "--once",
      "--interval-ms",
      "0",
    ],
    numericChecks: ["retriedDeliveryCount"],
  },
  {
    name: "notification_retry",
    profile: "workers",
    service: "notification-retry-worker",
    component: "notification-retry",
    command: [
      "pnpm",
      "--filter",
      "@romeo/cli",
      "start",
      "--",
      "workers",
      "notification-retry",
      "--once",
      "--interval-ms",
      "0",
    ],
    numericChecks: ["retriedDeliveryCount"],
  },
  {
    name: "retention_enforce",
    profile: "workers",
    service: "retention-enforce-worker",
    component: "retention-enforce",
    command: [
      "pnpm",
      "--filter",
      "@romeo/cli",
      "start",
      "--",
      "workers",
      "retention-enforce",
      "--once",
      "--interval-ms",
      "0",
    ],
    numericChecks: ["deletedAuditLogCount"],
  },
  {
    name: "billing_entitlement_reconcile",
    profile: "workers",
    service: "billing-entitlement-reconcile-worker",
    component: "billing-entitlement-reconcile",
    command: [
      "pnpm",
      "--filter",
      "@romeo/cli",
      "start",
      "--",
      "workers",
      "billing-entitlement-reconcile",
      "--once",
      "--interval-ms",
      "0",
    ],
    numericChecks: [
      "createdQuotaCount",
      "updatedQuotaCount",
      "unchangedQuotaCount",
    ],
  },
  {
    name: "billing_lifecycle_enforce",
    profile: "workers",
    service: "billing-lifecycle-enforce-worker",
    component: "billing-lifecycle-enforce",
    command: [
      "pnpm",
      "--filter",
      "@romeo/cli",
      "start",
      "--",
      "workers",
      "billing-lifecycle-enforce",
      "--once",
      "--interval-ms",
      "0",
    ],
    numericChecks: ["statusChangedCount"],
  },
  {
    name: "knowledge_extraction",
    profile: "knowledge",
    service: "knowledge-extraction-worker",
    component: "knowledge-extraction",
    command: [
      "pnpm",
      "--filter",
      "@romeo/cli",
      "start",
      "--",
      "workers",
      "knowledge-extraction",
      "--kb",
      "kb_default",
      "--once",
      "--interval-ms",
      "0",
      "--max-sources",
      "1",
    ],
    numericChecks: ["pendingCount", "extractedCount", "failedCount"],
  },
  {
    name: "voice_catalog_sync",
    profile: "voice",
    service: "voice-catalog-sync-worker",
    component: "voice-catalog-sync",
    command: [
      "pnpm",
      "--filter",
      "@romeo/cli",
      "start",
      "--",
      "workers",
      "voice-catalog-sync",
      "--once",
      "--interval-ms",
      "0",
    ],
    numericChecks: ["imported", "existing", "providerVoiceCount"],
  },
];

export const kubernetesCoreWorkerSpecs = composeWorkerCommands.filter(
  (worker) =>
    !["knowledge_extraction", "voice_catalog_sync"].includes(worker.name),
);

export const composeLoopRestartWorkers = [
  {
    name: "webhook_retry",
    profile: "workers",
    service: "webhook-retry-worker",
  },
  {
    name: "notification_retry",
    profile: "workers",
    service: "notification-retry-worker",
  },
];

export const workerApiKeyScopes = [
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
];

export function parseWorkerOutput(name, text) {
  const firstJson = text.indexOf("{");
  const lastJson = text.lastIndexOf("}");
  if (firstJson < 0 || lastJson <= firstJson) {
    throw new Error(`${name} did not emit a JSON object.`);
  }
  return JSON.parse(text.slice(firstJson, lastJson + 1));
}

export function assertWorkerOutput(worker, output) {
  if (output.iteration !== 1) {
    throw new Error(`${worker.name} did not run exactly one iteration.`);
  }
  for (const key of worker.numericChecks) {
    if (typeof output[key] !== "number" || output[key] < 0) {
      throw new Error(`${worker.name} output did not include numeric ${key}.`);
    }
  }
}

export function assertNoSensitiveLeak(label, text, values) {
  for (const secret of values) {
    if (
      typeof secret === "string" &&
      secret.length > 0 &&
      text.includes(secret)
    ) {
      throw new Error(`${label} worker output leaked a generated sentinel.`);
    }
  }
}

export async function createSmokeAgent(harness, token, options = {}) {
  const response = await apiJson(harness, "/api/v1/agents", {
    method: "POST",
    token,
    body: {
      workspaceId: "workspace_default",
      name: options.name ?? "Worker smoke agent",
      baseModelId: "model_openai_compatible_default",
      systemPrompt:
        "You are a deterministic smoke-test agent. Return a short acknowledgement.",
      parameters: { temperature: 0, maxTokens: 64 },
      memoryPolicy: { mode: "disabled" },
      safetySettings: {},
    },
    expectedStatus: 201,
  });
  if (typeof response.data?.id !== "string") {
    throw new Error("Smoke agent creation did not return an agent id.");
  }
  const published = await apiJson(
    harness,
    `/api/v1/agents/${encodeURIComponent(response.data.id)}/versions`,
    {
      method: "POST",
      token,
      expectedStatus: 201,
    },
  );
  if (typeof published.data?.id !== "string") {
    throw new Error("Smoke agent publish did not return a version id.");
  }
  return { ...response.data, publishedVersionId: published.data.id };
}

export async function waitForRunStatus(harness, token, runId, status) {
  const deadline = Date.now() + harness.timeoutMs;
  let lastStatus = "unknown";
  while (Date.now() < deadline) {
    try {
      const run = await apiJson(harness, `/api/v1/runs/${runId}`, { token });
      lastStatus = run.data?.status ?? "missing";
      if (lastStatus === status) return run.data;
    } catch (error) {
      if (!isFetchFailure(error)) throw error;
      lastStatus = "transient_fetch_failure";
    }
    await sleep(1000);
  }
  throw new Error(
    `Timed out waiting for run ${runId} to reach ${status}; last status ${lastStatus}.`,
  );
}

function isFetchFailure(error) {
  if (error === null || typeof error !== "object") return false;
  return error.message === "fetch failed";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
