import type {
  ToolOperationDispatchReadbackResponse,
  ToolOperationDispatchRequestClaimResult,
  ToolOperationDispatchRequestPayloadResult,
  ToolOperationDispatchRequestReadbackResult,
} from "@romeo/api-client";

import type { CliIo } from "./io";
import { writeJson } from "./io";
import type { SecretValueResolver } from "./secret-resolver";
import { validateToolDispatchResponse } from "./tool-response-validation";
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
      const result = await runToolDispatchWorkerIteration(
        input,
        payloads ?? {},
        iteration,
      );
      writeJson(input.io, result);
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

    const response = await executeHttpRequest(input, claim, payload);
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

async function executeHttpRequest(
  input: RunToolDispatchWorkerInput,
  claim: ToolOperationDispatchRequestClaimResult,
  payload: ToolDispatchPayload,
): Promise<ToolOperationDispatchReadbackResponse> {
  const url = buildDispatchUrl(
    claim,
    payload,
    input.allowPrivateNetwork === true,
  );
  await assertResolvedHostAllowed(input, url.hostname);
  const method = claim.method?.toUpperCase() ?? "GET";
  const headers: Record<string, string> = {
    accept: "application/json",
    ...(payload.headers ?? {}),
  };
  await applyPayloadAuth(input, claim, url, headers, payload.auth);
  const init: RequestInit = { method, headers, redirect: "error" };
  if (isMcpStreamableHttpTransport(claim)) {
    Object.assign(headers, mcpToolCallHeaders(claim));
    init.body = JSON.stringify(
      mcpToolCallBody(claim, payload.body ?? payload.parameters ?? {}),
    );
  } else if (
    !["GET", "DELETE"].includes(method) &&
    payload.body !== undefined
  ) {
    headers["content-type"] = headers["content-type"] ?? "application/json";
    init.body = JSON.stringify(payload.body);
  }

  const response = await fetchWithTimeout(
    input.fetchImpl,
    url,
    init,
    input.timeoutMs,
  );
  const body = await readBoundedResponseBody(response, input.maxBytes);
  const contentType = response.headers.get("content-type");
  const schemaValidation = validateToolDispatchResponse({
    body: body.bytes,
    ...(contentType === null ? {} : { contentType }),
    responseValidation: claim.responseValidation,
    status: response.status,
    truncated: body.truncated,
  });
  return {
    ok: response.ok,
    status: response.status,
    ...(contentType === null ? {} : { contentType }),
    bodyBytes: body.bodyBytes,
    truncated: body.truncated,
    schemaValidation,
  };
}

function isMcpStreamableHttpTransport(
  claim: ToolOperationDispatchRequestClaimResult,
): boolean {
  return claim.transport?.protocol === "mcp_streamable_http";
}

function mcpToolCallHeaders(
  claim: ToolOperationDispatchRequestClaimResult,
): Record<string, string> {
  const transport = claim.transport;
  if (
    transport?.protocol !== "mcp_streamable_http" ||
    claim.method?.toUpperCase() !== "POST"
  ) {
    throw new Error("worker_transport_invalid");
  }
  return {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "MCP-Protocol-Version": transport.mcpProtocolVersion,
    "Mcp-Method": "tools/call",
    "Mcp-Name": transport.mcpToolName,
  };
}

function mcpToolCallBody(
  claim: ToolOperationDispatchRequestClaimResult,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const transport = claim.transport;
  if (transport?.protocol !== "mcp_streamable_http")
    throw new Error("worker_transport_invalid");
  return {
    jsonrpc: "2.0",
    id: claim.job?.id ?? "job_dispatch_unknown",
    method: "tools/call",
    params: {
      name: transport.mcpToolName,
      arguments: args,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": transport.mcpProtocolVersion,
        "io.modelcontextprotocol/clientInfo": {
          name: "Romeo",
          version: "0.1.0",
        },
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    },
  };
}

async function assertResolvedHostAllowed(
  input: RunToolDispatchWorkerInput,
  host: string,
): Promise<void> {
  if (input.allowPrivateNetwork === true || input.dnsLookup === undefined)
    return;
  if (ipLiteral(host)) return;
  let addresses: ToolDispatchDnsAddress[];
  try {
    addresses = await input.dnsLookup(host);
  } catch {
    throw new Error("worker_dns_lookup_failed");
  }
  if (addresses.length === 0) throw new Error("worker_dns_lookup_failed");
  if (addresses.some((item) => privateAddress(item.address))) {
    throw new Error("worker_host_denied");
  }
}

async function applyPayloadAuth(
  input: RunToolDispatchWorkerInput,
  claim: ToolOperationDispatchRequestClaimResult,
  url: URL,
  headers: Record<string, string>,
  auth: ToolDispatchPayloadAuth | undefined,
): Promise<void> {
  if (auth === undefined) return;
  if (auth.type === "bearer") {
    const secret = await resolveWorkerSecret(input, auth.secretRef);
    headers.authorization = `Bearer ${secret}`;
    return;
  }
  if (auth.type === "api_key") {
    const secret = await resolveWorkerSecret(input, auth.secretRef);
    const name = safeApiKeyName(auth.apiKeyName ?? "x-api-key");
    if ((auth.apiKeyIn ?? "header") === "query") {
      url.searchParams.set(name, secret);
      return;
    }
    headers[name] = secret;
    return;
  }
  if (auth.type === "oauth2_client_credentials") {
    const accessToken = await resolveOAuthClientCredentialsAccessToken(
      input,
      claim,
      auth.secretRef,
    );
    headers.authorization = `Bearer ${accessToken}`;
    return;
  }
  throw new Error("worker_auth_unsupported");
}

async function resolveOAuthClientCredentialsAccessToken(
  input: RunToolDispatchWorkerInput,
  claim: ToolOperationDispatchRequestClaimResult,
  secretRef: string,
): Promise<string> {
  const tokenUrl = oauthTokenUrl(claim);
  await assertResolvedHostAllowed(input, tokenUrl.hostname);
  const credentials = parseOAuthClientCredentials(
    await resolveWorkerSecret(input, secretRef),
  );
  const body = new URLSearchParams({ grant_type: "client_credentials" });
  const scopes = oauthScopes(claim.authPolicy?.oauthScopes);
  if (scopes.length > 0) body.set("scope", scopes.join(" "));
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/x-www-form-urlencoded",
  };
  const authMethod =
    claim.authPolicy?.oauthClientAuthMethod === "client_secret_post"
      ? "client_secret_post"
      : "client_secret_basic";
  if (authMethod === "client_secret_post") {
    body.set("client_id", credentials.clientId);
    body.set("client_secret", credentials.clientSecret);
  } else {
    headers.authorization = basicAuthHeader(
      credentials.clientId,
      credentials.clientSecret,
    );
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(
      input.fetchImpl,
      tokenUrl,
      { method: "POST", headers, body, redirect: "error" },
      input.timeoutMs,
    );
  } catch (error) {
    if (error instanceof Error && error.message === "worker_fetch_timeout")
      throw new Error("worker_oauth_timeout");
    throw new Error("worker_oauth_token_request_failed");
  }
  if (!response.ok) throw new Error("worker_oauth_token_request_failed");
  const text = await readBoundedResponseText(
    response,
    Math.min(input.maxBytes, 16 * 1024),
  );
  return readOAuthAccessToken(text);
}

function oauthTokenUrl(claim: ToolOperationDispatchRequestClaimResult): URL {
  if (
    claim.authPolicy?.type !== "oauth2_client_credentials" ||
    claim.authPolicy.oauthTokenUrl === undefined
  ) {
    throw new Error("worker_auth_invalid");
  }
  let parsed: URL;
  try {
    parsed = new URL(claim.authPolicy.oauthTokenUrl);
  } catch {
    throw new Error("worker_auth_invalid");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0 ||
    !safeHost(parsed.hostname, false)
  ) {
    throw new Error("worker_auth_invalid");
  }
  return parsed;
}

function parseOAuthClientCredentials(value: string): {
  clientId: string;
  clientSecret: string;
} {
  let payload: unknown;
  try {
    payload = JSON.parse(value);
  } catch {
    throw new Error("worker_oauth_secret_invalid");
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload))
    throw new Error("worker_oauth_secret_invalid");
  const record = payload as Record<string, unknown>;
  if (
    typeof record.clientId !== "string" ||
    record.clientId.length === 0 ||
    typeof record.clientSecret !== "string" ||
    record.clientSecret.length === 0
  ) {
    throw new Error("worker_oauth_secret_invalid");
  }
  return { clientId: record.clientId, clientSecret: record.clientSecret };
}

function oauthScopes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const scopes: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !/^[A-Za-z0-9_:./-]{1,120}$/u.test(item))
      continue;
    if (!scopes.includes(item)) scopes.push(item);
    if (scopes.length >= 20) break;
  }
  return scopes;
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`;
}

async function readBoundedResponseText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bodyBytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bodyBytes += next.value.byteLength;
      if (bodyBytes > maxBytes) {
        await reader.cancel();
        throw new Error("worker_oauth_response_too_large");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(concatBytes(chunks));
}

function readOAuthAccessToken(text: string): string {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("worker_oauth_token_invalid");
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload))
    throw new Error("worker_oauth_token_invalid");
  const record = payload as Record<string, unknown>;
  const tokenType = record.token_type;
  if (typeof tokenType === "string" && tokenType.toLowerCase() !== "bearer") {
    throw new Error("worker_oauth_token_unsupported");
  }
  if (
    typeof record.access_token !== "string" ||
    record.access_token.length === 0
  ) {
    throw new Error("worker_oauth_token_invalid");
  }
  return record.access_token;
}

async function resolveWorkerSecret(
  input: RunToolDispatchWorkerInput,
  secretRef: string,
): Promise<string> {
  const resolution = await input.secretResolver?.resolveValue(secretRef);
  if (resolution?.available === true && resolution.value !== undefined) {
    return resolution.value;
  }
  throw new Error("worker_secret_unavailable");
}

function safeApiKeyName(value: string): string {
  if (/^[A-Za-z0-9_.-]{1,80}$/u.test(value)) return value;
  throw new Error("worker_auth_invalid");
}

function buildDispatchUrl(
  claim: ToolOperationDispatchRequestClaimResult,
  payload: ToolDispatchPayload,
  allowPrivateNetwork: boolean,
): URL {
  const host = claim.request?.host;
  if (host === undefined || !safeHost(host, allowPrivateNetwork)) {
    throw new Error("worker_host_denied");
  }
  const pathTemplate = claim.pathTemplate ?? "/";
  const parameters = payload.parameters ?? {};
  let renderedPath = pathTemplate;
  const usedPathParameters = new Set<string>();

  for (const parameterName of pathParameterNames(pathTemplate)) {
    const value = parameters[parameterName];
    if (value === undefined || value === null || String(value).length === 0) {
      throw new Error("worker_payload_invalid");
    }
    usedPathParameters.add(parameterName);
    renderedPath = renderedPath.replace(
      new RegExp(`\\{${escapeRegExp(parameterName)}\\}`, "gu"),
      encodeURIComponent(String(value)),
    );
  }

  const url = new URL(
    `https://${host}${renderedPath.startsWith("/") ? renderedPath : `/${renderedPath}`}`,
  );
  if (url.hostname !== host) throw new Error("worker_host_denied");
  for (const key of Object.keys(parameters).sort()) {
    if (usedPathParameters.has(key)) continue;
    const value = parameters[key];
    if (value !== undefined && value !== null)
      url.searchParams.set(key, String(value));
  }
  return url;
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("worker_fetch_timeout");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedResponseBody(
  response: Response,
  maxBytes: number,
): Promise<{ bodyBytes: number; bytes: Uint8Array; truncated: boolean }> {
  if (response.body === null)
    return { bodyBytes: 0, bytes: new Uint8Array(), truncated: false };
  const reader = response.body.getReader();
  let bodyBytes = 0;
  let truncated = false;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bodyBytes += next.value.byteLength;
      if (bodyBytes > maxBytes) {
        const storedBytes = chunks.reduce(
          (total, chunk) => total + chunk.byteLength,
          0,
        );
        const remaining = Math.max(0, maxBytes - storedBytes);
        if (remaining > 0) chunks.push(next.value.slice(0, remaining));
        bodyBytes = maxBytes;
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return { bodyBytes, bytes: concatBytes(chunks), truncated };
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    chunks.reduce((total, chunk) => total + chunk.byteLength, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
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

function safeHost(host: string, allowPrivateNetwork: boolean): boolean {
  const normalized = host.toLowerCase();
  if (
    normalized.length === 0 ||
    normalized.includes("/") ||
    normalized.includes("@")
  )
    return false;
  if (allowPrivateNetwork) return true;
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized === "kubernetes.default" ||
    normalized.endsWith(".svc") ||
    normalized.endsWith(".cluster.local") ||
    normalized === "metadata.google.internal"
  ) {
    return false;
  }
  return !privateIpv4(normalized) && !privateIpv6(normalized);
}

function privateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  return privateIpv4(normalized) || privateIpv6(normalized);
}

function ipLiteral(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[/u, "").replace(/\]$/u, "");
  return ipv4Octets(normalized) !== undefined || normalized.includes(":");
}

function privateIpv4(host: string): boolean {
  const octets = ipv4Octets(host);
  if (octets === undefined) return false;
  const [first = 0, second = 0] = octets;
  return (
    first === 0 ||
    first === 10 ||
    (first === 100 && second >= 64 && second <= 127) ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
}

function ipv4Octets(host: string): number[] | undefined {
  const parts = host.split(".");
  if (parts.length !== 4) return undefined;
  const octets = parts.map((part) => Number(part));
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
    return undefined;
  return octets;
}

function privateIpv6(host: string): boolean {
  const normalized = host.replace(/^\[/u, "").replace(/\]$/u, "");
  if (normalized.startsWith("::ffff:"))
    return privateIpv4(normalized.slice("::ffff:".length));
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("ff")
  );
}

function pathParameterNames(pathTemplate: string): string[] {
  const names: string[] = [];
  const matcher = /\{([^}]+)\}/gu;
  let match = matcher.exec(pathTemplate);
  while (match !== null) {
    if (match[1] !== undefined) names.push(match[1]);
    match = matcher.exec(pathTemplate);
  }
  return names;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
