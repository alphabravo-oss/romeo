import type {
  BrowserAutomationCompletionResult,
  BrowserAutomationTaskClaimResult,
  BrowserAutomationTaskReadbackResult,
} from "@romeo/api-client";

import type { CliIo } from "./io";
import { writeJson } from "./io";
import { workerSignalAborted } from "./worker-control";

export interface BrowserAutomationWorkerClient {
  workflows: {
    claimBrowserTask(input?: {
      leaseSeconds?: number;
    }): Promise<BrowserAutomationTaskClaimResult>;
    completeBrowserTask(input: {
      jobId: string;
      result: BrowserAutomationCompletionResult;
    }): Promise<BrowserAutomationTaskReadbackResult>;
    failBrowserTask(input: {
      errorCode: string;
      jobId: string;
    }): Promise<BrowserAutomationTaskReadbackResult>;
  };
}

export interface RunBrowserAutomationWorkerInput {
  client: BrowserAutomationWorkerClient;
  fetchImpl: typeof fetch;
  intervalMs: number;
  io: CliIo;
  leaseSeconds: number;
  maxBytes: number;
  maxIterations?: number;
  maxJobsPerIteration?: number;
  runnerUrl: string;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs: number;
}

interface BrowserAutomationWorkerJobSummary {
  errorCode?: string;
  jobId: string;
  outcome: "completed" | "failed";
  targetHost?: string;
  workflowRunId?: string;
}

export async function runBrowserAutomationWorker(
  input: RunBrowserAutomationWorkerInput,
): Promise<number> {
  const runnerUrl = normalizeRunnerUrl(input.runnerUrl);
  const sleep = input.sleep ?? sleepMs;
  let iteration = 0;

  while (!workerSignalAborted(input.signal)) {
    iteration += 1;
    const result = await runBrowserAutomationWorkerIteration(
      input,
      runnerUrl,
      iteration,
    );
    writeJson(input.io, result);

    if (input.maxIterations !== undefined && iteration >= input.maxIterations)
      return 0;
    if (workerSignalAborted(input.signal)) return 0;
    await sleep(input.intervalMs);
  }

  return 0;
}

async function runBrowserAutomationWorkerIteration(
  input: RunBrowserAutomationWorkerInput,
  runnerUrl: string,
  iteration: number,
): Promise<{
  claimedCount: number;
  completedCount: number;
  failedCount: number;
  iteration: number;
  jobs: BrowserAutomationWorkerJobSummary[];
}> {
  const maxJobs = input.maxJobsPerIteration ?? 1;
  const jobs: BrowserAutomationWorkerJobSummary[] = [];
  let claimedCount = 0;
  let completedCount = 0;
  let failedCount = 0;

  for (let index = 0; index < maxJobs; index += 1) {
    if (workerSignalAborted(input.signal)) break;
    const claim = await input.client.workflows.claimBrowserTask({
      leaseSeconds: input.leaseSeconds,
    });
    if (!claim.claimed || claim.job === undefined) break;

    claimedCount += 1;
    const execution = await executeClaimedBrowserTask(input, runnerUrl, claim);
    jobs.push(execution);
    if (execution.outcome === "completed") completedCount += 1;
    if (execution.outcome === "failed") failedCount += 1;
  }

  return { iteration, claimedCount, completedCount, failedCount, jobs };
}

async function executeClaimedBrowserTask(
  input: RunBrowserAutomationWorkerInput,
  runnerUrl: string,
  claim: BrowserAutomationTaskClaimResult,
): Promise<BrowserAutomationWorkerJobSummary> {
  const jobId = claim.job?.id;
  if (jobId === undefined) {
    return {
      jobId: "unknown",
      outcome: "failed",
      errorCode: "browser_automation_claim_invalid",
    };
  }

  try {
    if (claim.request === undefined || claim.workflow === undefined) {
      await input.client.workflows.failBrowserTask({
        jobId,
        errorCode: "browser_automation_claim_invalid",
      });
      return claimedJobSummary(claim, "failed", {
        errorCode: "browser_automation_claim_invalid",
      });
    }
    const result = await callBrowserRunner(input, runnerUrl, claim);
    await input.client.workflows.completeBrowserTask({ jobId, result });
    return claimedJobSummary(claim, "completed");
  } catch (error) {
    const errorCode = browserWorkerErrorCode(error);
    await input.client.workflows.failBrowserTask({ jobId, errorCode });
    return claimedJobSummary(claim, "failed", { errorCode });
  }
}

async function callBrowserRunner(
  input: RunBrowserAutomationWorkerInput,
  runnerUrl: string,
  claim: BrowserAutomationTaskClaimResult,
): Promise<BrowserAutomationCompletionResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await input.fetchImpl(runnerUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jobId: claim.job?.id,
        request: claim.request,
        sandboxPolicy: claim.sandboxPolicy,
        workflow: claim.workflow,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("browser_runner_http_error");
    const body = new Uint8Array(await response.arrayBuffer());
    if (body.byteLength > input.maxBytes)
      throw new Error("browser_runner_response_too_large");
    return sanitizeRunnerResult(JSON.parse(new TextDecoder().decode(body)));
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("browser_runner_timeout");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function sanitizeRunnerResult(value: unknown): BrowserAutomationCompletionResult {
  const record = asRecord(value);
  if (record === undefined) throw new Error("browser_runner_response_invalid");
  const outputKeys = stringArray(record.outputKeys);
  return {
    ...(integerValue(record.artifactCount) === undefined
      ? {}
      : { artifactCount: integerValue(record.artifactCount) }),
    ...(integerValue(record.capturedBytes) === undefined
      ? {}
      : { capturedBytes: integerValue(record.capturedBytes) }),
    ...(integerValue(record.durationMs) === undefined
      ? {}
      : { durationMs: integerValue(record.durationMs) }),
    ...(typeof record.finalOrigin === "string"
      ? { finalOrigin: record.finalOrigin }
      : {}),
    ...(integerValue(record.navigationCount) === undefined
      ? {}
      : { navigationCount: integerValue(record.navigationCount) }),
    ...(integerValue(record.networkDeniedCount) === undefined
      ? {}
      : { networkDeniedCount: integerValue(record.networkDeniedCount) }),
    ...(outputKeys.length === 0 ? {} : { outputKeys }),
    ...(typeof record.redactionApplied === "boolean"
      ? { redactionApplied: record.redactionApplied }
      : {}),
  };
}

function claimedJobSummary(
  claim: BrowserAutomationTaskClaimResult,
  outcome: "completed" | "failed",
  input: { errorCode?: string } = {},
): BrowserAutomationWorkerJobSummary {
  return {
    jobId: claim.job?.id ?? "unknown",
    outcome,
    ...(claim.request?.targetHost === undefined
      ? {}
      : { targetHost: claim.request.targetHost }),
    ...(claim.workflow?.workflowRunId === undefined
      ? {}
      : { workflowRunId: claim.workflow.workflowRunId }),
    ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
  };
}

function normalizeRunnerUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("browser_runner_url_invalid");
  }
  if (url.protocol !== "https:")
    throw new Error("browser_runner_url_must_use_https");
  if (url.username.length > 0 || url.password.length > 0)
    throw new Error("browser_runner_url_must_not_include_credentials");
  return url.toString();
}

function browserWorkerErrorCode(error: unknown): string {
  if (error instanceof Error && /^[a-z0-9_.-]+$/u.test(error.message))
    return error.message.slice(0, 120);
  return "browser_automation_worker_failed";
}

function integerValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
