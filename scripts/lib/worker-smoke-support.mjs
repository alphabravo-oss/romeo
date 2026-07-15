import { apiJson } from "./compose-smoke-support.mjs";

export const composeWorkerCommands = [
  {
    name: "data_connector_sync",
    profile: "workers",
    service: "data-connector-sync-worker",
    component: "data-connector-sync",
    command: [
      "pnpm",
      "--filter",
      "@romeo/cli",
      "start",
      "--",
      "workers",
      "data-connector-sync",
      "--workspace",
      "workspace_default",
      "--once",
      "--interval-ms",
      "0",
      "--max-connectors",
      "1",
    ],
    numericChecks: ["candidateCount", "syncedCount", "failedCount"],
  },
  {
    name: "workflow_resume",
    profile: "workers",
    service: "workflow-resume-worker",
    component: "workflow-resume",
    command: [
      "pnpm",
      "--filter",
      "@romeo/cli",
      "start",
      "--",
      "workers",
      "workflow-resume",
      "--workspace",
      "workspace_default",
      "--once",
      "--interval-ms",
      "0",
      "--max-workflows",
      "1",
      "--max-runs",
      "1",
    ],
    numericChecks: ["workflowCount", "candidateCount", "resumedCount"],
  },
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
    name: "workflow_resume",
    profile: "workers",
    service: "workflow-resume-worker",
  },
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

export function assertWorkflowResumeWorkerOutput(output, workflow) {
  if (output.candidateCount < 1 || output.resumedCount < 1) {
    throw new Error(
      "workflow_resume worker did not process the controlled pending workflow run.",
    );
  }
  const run = output.runs?.find((item) => item.id === workflow.workflowRunId);
  if (run === undefined) {
    throw new Error(
      "workflow_resume worker output did not include the controlled run summary.",
    );
  }
  if (run.input !== undefined) {
    throw new Error(
      "workflow_resume worker output included raw workflow input.",
    );
  }
  const agentStep = run.steps?.find((step) => step.stepId === "step_1");
  if (agentStep?.output !== undefined) {
    throw new Error(
      "workflow_resume worker output included raw step output values.",
    );
  }
  if (!agentStep?.outputKeys?.includes("runId")) {
    throw new Error(
      "workflow_resume worker summary did not include step output key metadata.",
    );
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

export async function createWorkflowResumePendingRun(harness, token, input) {
  const workflow = await apiJson(harness, "/api/v1/workflows", {
    method: "POST",
    token,
    body: {
      workspaceId: "workspace_default",
      name: input.name,
      steps: [
        { type: "agent_run", name: "Draft", agentId: input.agentId },
        {
          type: "approval",
          name: "Review",
          approvalPrompt: "Approve the worker smoke draft.",
        },
      ],
    },
    expectedStatus: 201,
  });
  const run = await startWorkflowRunWithReadback(
    harness,
    token,
    workflow.data.id,
    input.prompt,
  );
  const linkedRunId = run.steps?.[0]?.output?.runId;
  if (typeof linkedRunId !== "string" || linkedRunId.length === 0) {
    throw new Error(
      "Controlled workflow run did not start a linked model run.",
    );
  }
  await waitForRunStatus(harness, token, linkedRunId, "completed");
  return {
    workflowId: workflow.data.id,
    workflowRunId: run.id,
    linkedRunId,
  };
}

export async function assertWorkflowRunStatus(
  harness,
  token,
  workflow,
  status,
) {
  const deadline = Date.now() + harness.timeoutMs;
  let lastStatus = "unknown";
  while (Date.now() < deadline) {
    try {
      const run = (
        await workflowRuns(harness, token, workflow.workflowId)
      ).find((item) => item.id === workflow.workflowRunId);
      lastStatus = run?.status ?? "missing";
      if (run?.status === status) return run;
    } catch (error) {
      if (!isFetchFailure(error)) throw error;
      lastStatus = "transient_fetch_failure";
    }
    await sleep(1000);
  }
  throw new Error(
    `Timed out waiting for workflow run ${workflow.workflowRunId} to reach ${status}; last status ${lastStatus}.`,
  );
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

export async function workflowRuns(harness, token, workflowId) {
  let lastFetchFailure;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await apiJson(
        harness,
        `/api/v1/workflows/${workflowId}/runs`,
        { token },
      );
      if (!Array.isArray(response.data)) {
        throw new Error("Workflow runs response was not an array.");
      }
      return response.data;
    } catch (error) {
      if (!isFetchFailure(error)) throw error;
      lastFetchFailure = error;
      await sleep(1000);
    }
  }
  throw lastFetchFailure;
}

async function startWorkflowRunWithReadback(
  harness,
  token,
  workflowId,
  prompt,
) {
  try {
    const response = await apiJson(
      harness,
      `/api/v1/workflows/${workflowId}/runs`,
      {
        method: "POST",
        token,
        body: { input: { prompt } },
        expectedStatus: 201,
      },
    );
    return response.data;
  } catch (error) {
    if (!isFetchFailure(error)) throw error;
    return waitForWorkflowRunByPrompt(harness, token, workflowId, prompt);
  }
}

async function waitForWorkflowRunByPrompt(harness, token, workflowId, prompt) {
  const deadline = Date.now() + harness.timeoutMs;
  while (Date.now() < deadline) {
    try {
      const run = (await workflowRuns(harness, token, workflowId)).find(
        (item) => item.input?.prompt === prompt,
      );
      if (run !== undefined) return run;
    } catch (error) {
      if (!isFetchFailure(error)) throw error;
    }
    await sleep(1000);
  }
  throw new Error(
    `Timed out reading back workflow run for workflow ${workflowId}.`,
  );
}

function isFetchFailure(error) {
  if (error === null || typeof error !== "object") return false;
  return error.message === "fetch failed";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
