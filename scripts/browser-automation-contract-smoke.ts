import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { readEnv } from "../packages/config/src/index";
import { createRomeoApi } from "../packages/core/src/api";
import type { BackgroundJob } from "../packages/core/src/domain/entities";
import { InMemoryRomeoRepository } from "../packages/core/src/repositories/in-memory";
import {
  runBrowserAutomationWorker,
  type BrowserAutomationWorkerClient,
} from "../packages/cli/src/browser-automation-worker";
import { MemoryObjectStore } from "../packages/storage/src/memory-object-store";

const output = argValue("--output");
const repository = new InMemoryRomeoRepository();
const objectStore = new MemoryObjectStore();
const api = createRomeoApi(repository, {
  env: { ...readEnv(), DEV_SEEDED_LOGIN: true },
  objectStore,
});

const rawTaskSentinel = `RAW_BROWSER_TASK_SENTINEL_${process.pid}`;
const rawRunnerSentinel = `RAW_BROWSER_RUNNER_SENTINEL_${process.pid}`;
const artifactBytes = new TextEncoder().encode("browser screenshot bytes");

const workflow = await apiJson<{
  data: { id: string; steps: Array<{ id: string; type: string }> };
}>(
  "/api/v1/workflows",
  {
    method: "POST",
    body: JSON.stringify({
      workspaceId: "workspace_default",
      name: "Browser Automation Contract Smoke",
      steps: [
        {
          type: "browser_task",
          name: "Inspect release metadata",
          targetUrl: "https://example.com/releases",
          task: `Open the release page and verify metadata. ${rawTaskSentinel}`,
          approvalPrompt: "Approve browser automation smoke task.",
        },
      ],
    }),
  },
  201,
);

const run = await apiJson<{
  data: {
    id: string;
    status: string;
    steps: Array<{ output?: Record<string, unknown>; status: string }>;
  };
}>(
  `/api/v1/workflows/${encodeURIComponent(workflow.data.id)}/runs`,
  {
    method: "POST",
  },
  201,
);
const runReadback = JSON.stringify(run);
if (run.data.status !== "waiting_approval") {
  throw new Error(`Expected waiting_approval run, got ${run.data.status}.`);
}
assertNotContains(
  runReadback,
  rawTaskSentinel,
  "initial browser approval readback",
);

const approved = await apiJson<{
  data: {
    id: string;
    status: string;
    steps: Array<{ output?: Record<string, unknown>; status: string }>;
  };
}>(`/api/v1/workflow-runs/${encodeURIComponent(run.data.id)}/approve`, {
  method: "POST",
  body: JSON.stringify({ comment: "browser automation smoke approval" }),
});
if (approved.data.status !== "waiting_run") {
  throw new Error(
    `Expected waiting_run after approval, got ${approved.data.status}.`,
  );
}
assertNotContains(
  JSON.stringify(approved),
  rawTaskSentinel,
  "approved browser task readback",
);

const firstClaim = await apiJson<{
  data: {
    claimed: boolean;
    job?: { id: string };
    lease?: { attempt: number };
    request?: { task: string; taskHash: string; targetHost: string };
  };
}>("/api/v1/browser-automation-tasks/claim", {
  method: "POST",
  body: JSON.stringify({ leaseSeconds: 30 }),
});
if (!firstClaim.data.claimed || firstClaim.data.job === undefined) {
  throw new Error("Expected first browser task claim to succeed.");
}
if (firstClaim.data.lease?.attempt !== 1) {
  throw new Error("Expected first browser task claim attempt to be 1.");
}
if (!firstClaim.data.request?.task.includes(rawTaskSentinel)) {
  throw new Error(
    "Expected raw browser task to be visible only to the active worker claim.",
  );
}

const jobId = firstClaim.data.job.id;
const staleJob = await getJob(jobId);
await repository.updateBackgroundJob({
  ...staleJob,
  updatedAt: new Date(Date.now() - 60_000).toISOString(),
});

let artifactId: string | undefined;
let artifactUrl: string | undefined;
let artifactKey: string | undefined;
let runnerRequestSawRawTask = false;
const workerClaims: unknown[] = [];
const workerStdout: string[] = [];
const workerStderr: string[] = [];
const workerClient: BrowserAutomationWorkerClient = {
  workflows: {
    claimBrowserTask: async (input) => {
      const result = await apiData<unknown>(
        "/api/v1/browser-automation-tasks/claim",
        {
          method: "POST",
          body: JSON.stringify(input ?? {}),
        },
      );
      workerClaims.push(result);
      return result as Awaited<
        ReturnType<
          BrowserAutomationWorkerClient["workflows"]["claimBrowserTask"]
        >
      >;
    },
    completeBrowserTask: async (input) =>
      (await apiData("/api/v1/browser-automation-tasks/:jobId/complete", {
        method: "POST",
        body: JSON.stringify({ result: input.result }),
        pathParams: { jobId: input.jobId },
      })) as Awaited<
        ReturnType<
          BrowserAutomationWorkerClient["workflows"]["completeBrowserTask"]
        >
      >,
    failBrowserTask: async (input) =>
      (await apiData("/api/v1/browser-automation-tasks/:jobId/fail", {
        method: "POST",
        body: JSON.stringify({ errorCode: input.errorCode }),
        pathParams: { jobId: input.jobId },
      })) as Awaited<
        ReturnType<
          BrowserAutomationWorkerClient["workflows"]["failBrowserTask"]
        >
      >,
  },
};

const workerExitCode = await runBrowserAutomationWorker({
  client: workerClient,
  fetchImpl: async (_input, init) => {
    const request = JSON.parse(String(init?.body ?? "{}")) as {
      jobId?: string;
      request?: { task?: string; targetUrl?: string };
    };
    if (request.jobId !== jobId) {
      throw new Error("browser_runner_unexpected_job");
    }
    runnerRequestSawRawTask =
      typeof request.request?.task === "string" &&
      request.request.task.includes(rawTaskSentinel);

    const artifactRegistration = await apiData<{
      artifact: {
        artifactId: string;
        artifactUrl?: string;
        contentType?: string;
        sizeBytes?: number;
        type?: string;
      };
      upload: { key: string };
    }>(
      "/api/v1/browser-automation-tasks/:jobId/artifacts/uploads",
      {
        method: "POST",
        body: JSON.stringify({
          type: "screenshot",
          contentType: "image/png",
          sizeBytes: artifactBytes.byteLength,
        }),
        pathParams: { jobId },
      },
      202,
    );
    artifactId = artifactRegistration.artifact.artifactId;
    artifactUrl = artifactRegistration.artifact.artifactUrl;
    artifactKey = artifactRegistration.upload.key;
    await objectStore.putObject({
      key: artifactKey,
      body: artifactBytes,
      contentType: "image/png",
    });

    return new Response(
      JSON.stringify({
        artifactCount: 1,
        capturedBytes: artifactBytes.byteLength,
        durationMs: 1250,
        finalOrigin: "https://example.com/releases/2026",
        navigationCount: 2,
        networkDeniedCount: 1,
        outputKeys: ["releaseStatus"],
        rawPageText: rawRunnerSentinel,
        redactionApplied: true,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  },
  intervalMs: 60_000,
  io: {
    stdout: captureOutput(workerStdout),
    stderr: captureOutput(workerStderr),
  },
  leaseSeconds: 30,
  maxBytes: 20_000,
  maxIterations: 1,
  runnerUrl: "https://browser-runner.example/tasks",
  timeoutMs: 30_000,
});

if (workerExitCode !== 0) {
  throw new Error(`Browser automation worker exited ${workerExitCode}.`);
}
if (!runnerRequestSawRawTask) {
  throw new Error("Runner fixture did not receive the raw approved task.");
}
if (
  artifactId === undefined ||
  artifactUrl === undefined ||
  artifactKey === undefined
) {
  throw new Error("Runner fixture did not register a browser artifact.");
}

const parsedWorkerOutput = JSON.parse(workerStdout.join(""));
const reclaimedClaim = workerClaims[0] as {
  lease?: { attempt?: number };
  request?: { task?: string };
};
if (reclaimedClaim.lease?.attempt !== 2) {
  throw new Error(`Expected stale browser task to be reclaimed at attempt 2.`);
}
assertNotContains(workerStdout.join(""), rawTaskSentinel, "worker stdout");
assertNotContains(workerStdout.join(""), rawRunnerSentinel, "worker stdout");
assertNotContains(workerStdout.join(""), artifactKey, "worker stdout");
assertNotContains(workerStderr.join(""), rawTaskSentinel, "worker stderr");
assertNotContains(workerStderr.join(""), rawRunnerSentinel, "worker stderr");
assertNotContains(workerStderr.join(""), artifactKey, "worker stderr");

const finalRuns = await apiJson<{
  data: Array<{
    id: string;
    status: string;
    steps: Array<{ output?: Record<string, unknown>; status: string }>;
  }>;
}>(`/api/v1/workflows/${encodeURIComponent(workflow.data.id)}/runs`);
const finalRun = finalRuns.data.find(
  (candidate) => candidate.id === run.data.id,
);
if (finalRun?.status !== "completed") {
  throw new Error(`Expected completed workflow run, got ${finalRun?.status}.`);
}
const finalSerialized = JSON.stringify(finalRuns);
assertNotContains(finalSerialized, rawTaskSentinel, "final workflow readback");
assertNotContains(
  finalSerialized,
  rawRunnerSentinel,
  "final workflow readback",
);
assertNotContains(finalSerialized, artifactKey, "final workflow readback");

const artifactResponse = await api.request(artifactUrl);
const artifactReadback = new Uint8Array(await artifactResponse.arrayBuffer());
if (artifactResponse.status !== 200) {
  throw new Error(
    `Browser artifact readback returned ${artifactResponse.status}.`,
  );
}
if (!bytesEqual(artifactReadback, artifactBytes)) {
  throw new Error(
    "Browser artifact readback bytes did not match uploaded bytes.",
  );
}

const completedJob = await getJob(jobId);
const artifacts = Array.isArray(completedJob.payload.browserArtifacts)
  ? completedJob.payload.browserArtifacts
  : [];
if (artifacts.length !== 1) {
  throw new Error(
    `Expected one registered artifact on the completed browser job.`,
  );
}
await repository.updateBackgroundJob({
  ...completedJob,
  payload: {
    ...completedJob.payload,
    browserArtifacts: artifacts.map((artifact) =>
      typeof artifact === "object" && artifact !== null
        ? { ...artifact, registeredAt: "2020-01-01T00:00:00.000Z" }
        : artifact,
    ),
  },
  updatedAt: "2020-01-01T00:00:00.000Z",
});

const retention = await apiJson<{
  data: {
    cleanedBrowserAutomationJobCount: number;
    deletedBrowserAutomationArtifactCount: number;
  };
}>("/api/v1/governance/retention/enforce", { method: "POST" });
if (retention.data.cleanedBrowserAutomationJobCount !== 1) {
  throw new Error(
    "Retention did not clean the browser automation job metadata.",
  );
}
if (retention.data.deletedBrowserAutomationArtifactCount !== 1) {
  throw new Error("Retention did not delete the registered browser artifact.");
}
if ((await objectStore.getObject(artifactKey)) !== undefined) {
  throw new Error(
    "Browser artifact object remained after retention enforcement.",
  );
}
const retainedJob = await getJob(jobId);
if (retainedJob.payload.browserArtifacts !== undefined) {
  throw new Error(
    "Browser artifact metadata remained after retention enforcement.",
  );
}
const retentionAudit = await apiJson<{
  data: Array<{ metadata: Record<string, unknown> }>;
}>("/api/v1/audit-logs?action=governance.retention.enforce");
assertNotContains(JSON.stringify(retention), artifactKey, "retention response");
assertNotContains(
  JSON.stringify(retentionAudit),
  artifactKey,
  "retention audit",
);
assertNotContains(
  JSON.stringify(retentionAudit),
  rawTaskSentinel,
  "retention audit",
);

const evidence = {
  schemaVersion: "romeo.browser-automation-contract-smoke.v1",
  generatedAt: new Date().toISOString(),
  status: "passed",
  checks: [
    "browser_task_approval_metadata_redaction",
    "stale_running_browser_task_reclaimed",
    "external_runner_completion",
    "worker_stdout_redaction",
    "worker_stderr_redaction",
    "registered_artifact_readback",
    "browser_artifact_retention_cleanup",
    "retention_metadata_redaction",
  ],
  workflow: {
    workflowId: workflow.data.id,
    workflowRunId: run.data.id,
    finalStatus: finalRun.status,
  },
  worker: {
    jobId,
    firstAttempt: firstClaim.data.lease?.attempt,
    reclaimedAttempt: reclaimedClaim.lease?.attempt,
    output: parsedWorkerOutput,
  },
  artifacts: {
    registeredCount: 1,
    artifactId,
    readbackBytes: artifactReadback.byteLength,
    retentionDeletedCount: retention.data.deletedBrowserAutomationArtifactCount,
  },
  redaction: {
    approvalReadback: "passed",
    workerStdout: "passed",
    workerStderr: "passed",
    workflowReadback: "passed",
    retentionEvidence: "passed",
  },
};

const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
for (const forbidden of [rawTaskSentinel, rawRunnerSentinel, artifactKey]) {
  assertNotContains(serialized, forbidden, "browser automation smoke evidence");
}

if (output === undefined) {
  process.stdout.write(serialized);
} else {
  const outputPath = resolve(process.env.INIT_CWD ?? process.cwd(), output);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, serialized, "utf8");
  console.log(`Wrote browser automation smoke evidence to ${outputPath}`);
}

async function apiData<T>(
  pathTemplate: string,
  input: RequestInit & { pathParams?: Record<string, string> } = {},
  expectedStatus = 200,
): Promise<T> {
  const { data } = await apiJson<{ data: T }>(
    renderPath(pathTemplate, input.pathParams),
    input,
    expectedStatus,
  );
  return data;
}

async function apiJson<T>(
  path: string,
  input: RequestInit & { pathParams?: Record<string, string> } = {},
  expectedStatus = 200,
): Promise<T> {
  const { pathParams, ...requestInit } = input;
  const headers = new Headers(input.headers);
  if (input.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await api.request(renderPath(path, pathParams), {
    ...requestInit,
    headers,
  });
  const text = await response.text();
  const body = text.length === 0 ? {} : JSON.parse(text);
  if (response.status !== expectedStatus) {
    throw new Error(
      `Request ${path} returned ${response.status}: ${JSON.stringify(body)}`,
    );
  }
  return body as T;
}

function renderPath(
  path: string,
  pathParams: Record<string, string> | undefined,
): string {
  let rendered = path;
  for (const [key, value] of Object.entries(pathParams ?? {})) {
    rendered = rendered.replace(`:${key}`, encodeURIComponent(value));
  }
  return rendered;
}

async function getJob(jobId: string): Promise<BackgroundJob> {
  const jobs = await repository.listBackgroundJobs("org_default");
  const job = jobs.find((candidate) => candidate.id === jobId);
  if (job === undefined) throw new Error(`Background job ${jobId} not found.`);
  return job;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
  );
}

function captureOutput(chunks: string[]): Pick<NodeJS.WriteStream, "write"> {
  return {
    write(chunk: unknown): boolean {
      chunks.push(String(chunk));
      return true;
    },
  };
}

function assertNotContains(
  value: string,
  forbidden: string,
  label: string,
): void {
  if (value.includes(forbidden)) {
    throw new Error(`${label} leaked forbidden value.`);
  }
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}
