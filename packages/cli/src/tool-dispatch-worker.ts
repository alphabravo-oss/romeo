import type {
  ToolOperationDispatchReadbackResponse,
  ToolOperationDispatchRequestClaimResult,
  ToolOperationDispatchRequestPayloadResult,
  ToolOperationDispatchRequestReadbackResult,
} from "./api-types";
import type { CliIo } from "./io";
import { writeJson } from "./io";
import type { SecretValueResolver } from "./secret-resolver";
import type { ToolDispatchPinnedFetch } from "./dns-pinned-fetch";
import { executeToolDispatchHttpRequest } from "./tool-dispatch-http";
import { workerSignalAborted } from "./worker-control";

export interface ToolDispatchWorkerClient {
  tool: {
    claimDispatchRequest(input?: {
      leaseSeconds?: number;
      payloadStorage?:
        | "external_worker_secret_store_required"
        | "managed_encrypted_object_store";
    }): Promise<ToolOperationDispatchRequestClaimResult>;
    completeDispatchRequest(input: {
      jobId: string;
      response: ToolOperationDispatchReadbackResponse;
    }): Promise<ToolOperationDispatchRequestReadbackResult>;
    failDispatchRequest(input: {
      jobId: string;
      errorCode: string;
    }): Promise<ToolOperationDispatchRequestReadbackResult>;
    readDispatchRequestPayload?(input: {
      jobId: string;
    }): Promise<ToolOperationDispatchRequestPayloadResult>;
  };
}

export interface ToolDispatchPayload {
  auth?: ToolDispatchPayloadAuth;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  parameters?: Record<string, unknown>;
}

export type ToolDispatchPayloadAuth =
  | {
      secretRef: string;
      type: "bearer";
    }
  | {
      apiKeyIn?: "header" | "query";
      apiKeyName?: string;
      secretRef: string;
      type: "api_key";
    }
  | {
      secretRef: string;
      type: "oauth2_client_credentials";
    };

export interface ToolDispatchDnsAddress {
  address: string;
  family?: number;
}

export type ToolDispatchDnsLookup = (
  host: string,
) => Promise<ToolDispatchDnsAddress[]>;

export interface RunToolDispatchWorkerInput {
  allowPrivateNetwork?: boolean;
  client: ToolDispatchWorkerClient;
  dnsLookup?: ToolDispatchDnsLookup;
  fetchImpl: typeof fetch;
  intervalMs: number;
  io: CliIo;
  leaseSeconds: number;
  maxBytes: number;
  maxIterations?: number;
  maxJobsPerIteration?: number;
  payloads?: Record<string, ToolDispatchPayload>;
  pinnedFetchImpl?: ToolDispatchPinnedFetch;
  secretResolver?: SecretValueResolver;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs: number;
}

interface ToolDispatchWorkerJobSummary {
  bodyBytes?: number;
  connectorId?: string;
  errorCode?: string;
  jobId: string;
  method?: string;
  operationId?: string;
  outcome: "completed" | "failed";
  pathTemplate?: string;
  responseStatus?: number;
  truncated?: boolean;
}

export async function runToolDispatchWorker(
  input: RunToolDispatchWorkerInput,
): Promise<number> {
  const sleep = input.sleep ?? sleepMs;
  let iteration = 0;

  while (!workerSignalAborted(input.signal)) {
    iteration += 1;
    const payloads = input.payloads;
    if (
      payloads === undefined &&
      input.client.tool.readDispatchRequestPayload === undefined
    ) {
      writeJson(input.io, {
        iteration,
        claimedCount: 0,
        completedCount: 0,
        failedCount: 0,
        disabledReason: "payload_store_not_configured",
      });
    } else {
      writeJson(
        input.io,
        await runToolDispatchWorkerIteration(input, payloads ?? {}, iteration),
      );
    }

    if (input.maxIterations !== undefined && iteration >= input.maxIterations)
      return 0;
    if (workerSignalAborted(input.signal)) return 0;
    await sleep(input.intervalMs);
  }
  return 0;
}

async function runToolDispatchWorkerIteration(
  input: RunToolDispatchWorkerInput,
  payloads: Record<string, ToolDispatchPayload>,
  iteration: number,
): Promise<{
  claimedCount: number;
  completedCount: number;
  failedCount: number;
  iteration: number;
  jobs: ToolDispatchWorkerJobSummary[];
}> {
  const maxJobs = input.maxJobsPerIteration ?? 1;
  const jobs: ToolDispatchWorkerJobSummary[] = [];
  let claimedCount = 0;
  let completedCount = 0;
  let failedCount = 0;

  for (let index = 0; index < maxJobs; index += 1) {
    if (workerSignalAborted(input.signal)) break;
    const claim = await input.client.tool.claimDispatchRequest({
      leaseSeconds: input.leaseSeconds,
      ...(input.payloads === undefined &&
      input.client.tool.readDispatchRequestPayload !== undefined
        ? { payloadStorage: "managed_encrypted_object_store" as const }
        : {}),
    });
    if (!claim.claimed || claim.job === undefined) break;

    claimedCount += 1;
    const execution = await executeClaimedDispatchRequest(
      input,
      claim,
      payloads,
    );
    jobs.push(execution);
    if (execution.outcome === "completed") completedCount += 1;
    if (execution.outcome === "failed") failedCount += 1;
  }

  return {
    iteration,
    claimedCount,
    completedCount,
    failedCount,
    jobs,
  };
}

async function executeClaimedDispatchRequest(
  input: RunToolDispatchWorkerInput,
  claim: ToolOperationDispatchRequestClaimResult,
  payloads: Record<string, ToolDispatchPayload>,
): Promise<ToolDispatchWorkerJobSummary> {
  const jobId = claim.job?.id;
  if (jobId === undefined) {
    return {
      jobId: "unknown",
      outcome: "failed",
      errorCode: "worker_claim_invalid",
    };
  }

  try {
    const payload = await resolveClaimPayload(input, claim, payloads);
    if (payload === undefined) {
      await input.client.tool.failDispatchRequest({
        jobId,
        errorCode: "worker_payload_unavailable",
      });
      return claimedJobSummary(claim, "failed", {
        errorCode: "worker_payload_unavailable",
      });
    }

    const response = await executeToolDispatchHttpRequest(
      input,
      claim,
      payload,
    );
    await input.client.tool.completeDispatchRequest({ jobId, response });
    return claimedJobSummary(claim, "completed", {
      bodyBytes: response.bodyBytes,
      responseStatus: response.status,
      truncated: response.truncated,
    });
  } catch (error) {
    const errorCode = workerErrorCode(error);
    await input.client.tool.failDispatchRequest({ jobId, errorCode });
    return claimedJobSummary(claim, "failed", { errorCode });
  }
}

async function resolveClaimPayload(
  input: RunToolDispatchWorkerInput,
  claim: ToolOperationDispatchRequestClaimResult,
  payloads: Record<string, ToolDispatchPayload>,
): Promise<ToolDispatchPayload | undefined> {
  const jobId = claim.job?.id;
  if (jobId === undefined) return undefined;
  const filePayload = payloads[jobId];
  if (filePayload !== undefined) return filePayload;
  if (
    claim.request?.payloadStorage !== "managed_encrypted_object_store" ||
    input.client.tool.readDispatchRequestPayload === undefined
  ) {
    return undefined;
  }
  try {
    const result = await input.client.tool.readDispatchRequestPayload({
      jobId,
    });
    return result.payload;
  } catch {
    throw new Error("worker_payload_unavailable");
  }
}

function claimedJobSummary(
  claim: ToolOperationDispatchRequestClaimResult,
  outcome: "completed" | "failed",
  result: {
    bodyBytes?: number;
    errorCode?: string;
    responseStatus?: number;
    truncated?: boolean;
  },
): ToolDispatchWorkerJobSummary {
  const summary: ToolDispatchWorkerJobSummary = {
    jobId: claim.job?.id ?? "unknown",
    outcome,
  };
  if (claim.connectorId !== undefined) summary.connectorId = claim.connectorId;
  if (claim.operationId !== undefined) summary.operationId = claim.operationId;
  if (claim.method !== undefined) summary.method = claim.method;
  if (claim.pathTemplate !== undefined)
    summary.pathTemplate = claim.pathTemplate;
  if (result.bodyBytes !== undefined) summary.bodyBytes = result.bodyBytes;
  if (result.errorCode !== undefined) summary.errorCode = result.errorCode;
  if (result.responseStatus !== undefined)
    summary.responseStatus = result.responseStatus;
  if (result.truncated !== undefined) summary.truncated = result.truncated;
  return summary;
}

function workerErrorCode(error: unknown): string {
  if (error instanceof Error) {
    if (
      error.message === "worker_fetch_timeout" ||
      error.message === "worker_dns_lookup_failed" ||
      error.message === "worker_host_denied" ||
      error.message === "worker_auth_invalid" ||
      error.message === "worker_auth_unsupported" ||
      error.message === "worker_oauth_response_too_large" ||
      error.message === "worker_oauth_secret_invalid" ||
      error.message === "worker_oauth_timeout" ||
      error.message === "worker_oauth_token_invalid" ||
      error.message === "worker_oauth_token_request_failed" ||
      error.message === "worker_oauth_token_unsupported" ||
      error.message === "worker_payload_unavailable" ||
      error.message === "worker_payload_invalid" ||
      error.message === "worker_transport_invalid"
    ) {
      return error.message;
    }
    if (error.message === "worker_secret_unavailable")
      return "worker_secret_unavailable";
  }
  return "worker_fetch_failed";
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
