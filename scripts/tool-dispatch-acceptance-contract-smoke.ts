import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  ToolOperationDispatchPayload,
  ToolOperationDispatchReadbackResponse,
  ToolOperationDispatchRequestClaimResult,
  ToolOperationDispatchRequestPayloadResult,
  ToolOperationDispatchRequestReadbackResult,
} from "@romeo/api-client";

import {
  runToolDispatchWorker,
  type ToolDispatchWorkerClient,
} from "../packages/cli/src/tool-dispatch-worker";
import type {
  SecretValueResolution,
  SecretValueResolver,
} from "../packages/cli/src/secret-resolver";
import type { CliIo } from "../packages/cli/src/io";

const output = argValue("--output");
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pid = process.pid;
const sentinels = {
  bearerSecret: `RAW_TOOL_DISPATCH_BEARER_SECRET_${pid}`,
  mcpArgument: `RAW_TOOL_DISPATCH_MCP_ARGUMENT_${pid}`,
  missingSecretRef: `env://RAW_TOOL_DISPATCH_MISSING_SECRET_${pid}`,
  objectKey: `tool-dispatch-payload/RAW_OBJECT_KEY_${pid}.json`,
  payloadBody: `RAW_TOOL_DISPATCH_BODY_${pid}`,
  payloadPath: `RAW_TOOL_DISPATCH_PATH_${pid}`,
  responseBody: `RAW_TOOL_DISPATCH_RESPONSE_${pid}`,
  secretRef: `env://RAW_TOOL_DISPATCH_SECRET_REF_${pid}`,
};

const workerOutputs: string[] = [];
const completionReadbacks: unknown[] = [];
const failureReadbacks: unknown[] = [];
const dispatchType = "tool.operation.dispatch_request";
const workerQueue = "external_tool_operations" as const;

await assertDisabledWithoutPayloadSource();
const managedResult = await assertManagedPayloadClaimReadAndComplete();
const mcpResult = await assertMcpStreamableHttpEnvelope();
const invalidSchemaResult = await assertInvalidSchemaIsMetadataOnly();
const privateDnsResult = await assertPrivateDnsDeniedBeforeFetch();
const missingSecretResult = await assertMissingSecretDeniedBeforeFetch();

const workerOutputText = workerOutputs.join("\n");
const readbackText = JSON.stringify({
  completionReadbacks,
  failureReadbacks,
});

const redaction = {
  rawObjectStoreKeysReturned: containsRaw(sentinels.objectKey, [
    workerOutputText,
    readbackText,
  ]),
  rawPayloadValuesReturned: containsRaw(
    [sentinels.mcpArgument, sentinels.payloadBody, sentinels.payloadPath],
    [workerOutputText, readbackText],
  ),
  rawResponseBodiesReturned: containsRaw(sentinels.responseBody, [
    workerOutputText,
    readbackText,
  ]),
  rawSecretRefsReturned: containsRaw(
    [sentinels.secretRef, sentinels.missingSecretRef],
    [workerOutputText, readbackText],
  ),
  secretValuesReturned: containsRaw(sentinels.bearerSecret, [
    workerOutputText,
    readbackText,
  ]),
};

if (Object.values(redaction).some(Boolean)) {
  throw new Error("Tool-dispatch acceptance smoke leaked raw sentinel values.");
}

const evidence = {
  schemaVersion: "romeo.tool-dispatch-acceptance-contract-smoke.v1",
  generatedAt: new Date().toISOString(),
  status: "passed",
  checks: [
    "disabled_without_payload_source_fails_closed",
    "managed_payload_claim_read_and_complete",
    "mcp_streamable_http_tools_call_envelope",
    "worker_secret_resolution_boundary",
    "private_dns_denied_before_fetch",
    "missing_secret_denied_before_fetch",
    "response_schema_validation_recorded",
    "invalid_response_schema_metadata_only",
    "worker_output_redaction",
    "dispatch_readback_redaction",
  ],
  worker: {
    disabledWithoutPayloadSource: true,
    managedClaimCount: managedResult.claimCount,
    managedPayloadReadCount: managedResult.payloadReadCount,
    completedCount:
      managedResult.completedCount +
      mcpResult.completedCount +
      invalidSchemaResult.completedCount,
    failedCount: privateDnsResult.failedCount + missingSecretResult.failedCount,
    privateDnsFetchAttemptCount: privateDnsResult.fetchAttemptCount,
    missingSecretFetchAttemptCount: missingSecretResult.fetchAttemptCount,
  },
  mcp: {
    streamableHttpEnvelopeVerified: mcpResult.jsonRpcToolsCallVerified,
    protocolHeadersVerified: mcpResult.protocolHeadersVerified,
    callCount: mcpResult.callCount,
    outputRedacted: !containsRaw(sentinels.mcpArgument, [
      mcpResult.stdout,
      JSON.stringify(mcpResult.completions),
    ]),
  },
  secrets: {
    secretResolutionVerified: managedResult.secretResolutionCount > 0,
    secretResolverBoundaryVerified: managedResult.fetchSawBearerSecret,
    missingSecretDeniedBeforeFetch:
      missingSecretResult.errorCode === "worker_secret_unavailable" &&
      missingSecretResult.fetchAttemptCount === 0,
    secretResolutionCount: managedResult.secretResolutionCount,
  },
  responseValidation: {
    passedSchemaValidationCount: managedResult.schemaValidationPassed ? 1 : 0,
    failedSchemaValidationCount: invalidSchemaResult.schemaValidationFailed
      ? 1
      : 0,
    invalidResponseMetadataOnly:
      invalidSchemaResult.schemaValidationFailed &&
      !containsRaw(sentinels.responseBody, [invalidSchemaResult.stdout]),
  },
  redaction,
};

writeEvidence(output, evidence);
process.stdout.write(`Wrote tool-dispatch acceptance contract to ${output}.\n`);

async function assertDisabledWithoutPayloadSource(): Promise<void> {
  const result = await runWorker({
    client: {
      tool: {
        claimDispatchRequest: async () => {
          throw new Error("Disabled worker should not claim without payloads.");
        },
        completeDispatchRequest: async () => {
          throw new Error("Disabled worker should not complete.");
        },
        failDispatchRequest: async () => {
          throw new Error("Disabled worker should not fail jobs.");
        },
      },
    },
    fetchImpl: fetch,
  });
  const outputJson = parseWorkerJson(result.stdout);
  if (outputJson.disabledReason !== "payload_store_not_configured") {
    throw new Error("Tool-dispatch worker did not fail closed when disabled.");
  }
}

async function assertManagedPayloadClaimReadAndComplete(): Promise<{
  claimCount: number;
  completedCount: number;
  fetchSawBearerSecret: boolean;
  payloadReadCount: number;
  schemaValidationPassed: boolean;
  secretResolutionCount: number;
}> {
  const completions: ToolOperationDispatchRequestReadbackResult[] = [];
  let claimCount = 0;
  let fetchSawBearerSecret = false;
  let payloadReadCount = 0;
  let secretResolutionCount = 0;
  const jobId = "tool_dispatch_managed_acceptance";

  const result = await runWorker({
    client: singleClaimClient({
      claim: dispatchClaim(jobId, {
        method: "post",
        payloadStorage: "managed_encrypted_object_store",
        responseValidation: successResponseValidation(),
      }),
      onClaim: () => {
        claimCount += 1;
      },
      onComplete: (readback) => completions.push(readback),
      payload: {
        auth: { secretRef: sentinels.secretRef, type: "bearer" },
        body: { value: sentinels.payloadBody },
        parameters: { issueId: sentinels.payloadPath },
      },
      payloadStoreObjectKey: sentinels.objectKey,
      onPayloadRead: () => {
        payloadReadCount += 1;
      },
    }),
    dnsLookup: async () => [{ address: "203.0.113.10", family: 4 }],
    fetchImpl: async (_input, init) => {
      const headers = headersRecord(init?.headers);
      fetchSawBearerSecret =
        headers.authorization === `Bearer ${sentinels.bearerSecret}`;
      if (!fetchSawBearerSecret) {
        throw new Error("Tool-dispatch worker did not apply bearer auth.");
      }
      if (!String(init?.body ?? "").includes(sentinels.payloadBody)) {
        throw new Error("Tool-dispatch worker did not forward payload body.");
      }
      return new Response(
        JSON.stringify({ id: "issue-1", raw: sentinels.responseBody }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
    secretResolver: {
      async resolveValue(secretRef: string): Promise<SecretValueResolution> {
        secretResolutionCount += 1;
        if (secretRef !== sentinels.secretRef) {
          return unavailableSecret(secretRef);
        }
        return {
          available: true,
          scheme: "env",
          value: sentinels.bearerSecret,
        };
      },
    },
  });

  const workerJson = parseWorkerJson(result.stdout);
  const response = completions[0]?.response;
  const schemaValidationPassed = response?.schemaValidation.status === "passed";
  if (
    workerJson.completedCount !== 1 ||
    workerJson.failedCount !== 0 ||
    claimCount !== 1 ||
    payloadReadCount !== 1 ||
    completions.length !== 1 ||
    !fetchSawBearerSecret ||
    !schemaValidationPassed
  ) {
    throw new Error("Managed tool-dispatch worker execution was incomplete.");
  }

  return {
    claimCount,
    completedCount: workerJson.completedCount,
    fetchSawBearerSecret,
    payloadReadCount,
    schemaValidationPassed,
    secretResolutionCount,
  };
}

async function assertMcpStreamableHttpEnvelope(): Promise<{
  callCount: number;
  completedCount: number;
  completions: ToolOperationDispatchRequestReadbackResult[];
  jsonRpcToolsCallVerified: boolean;
  protocolHeadersVerified: boolean;
  stdout: string;
}> {
  const completions: ToolOperationDispatchRequestReadbackResult[] = [];
  let callCount = 0;
  let jsonRpcToolsCallVerified = false;
  let protocolHeadersVerified = false;
  const jobId = "tool_dispatch_mcp_acceptance";
  const result = await runWorker({
    client: singleClaimClient({
      claim: dispatchClaim(jobId, {
        bodyKeys: ["query"],
        host: "mcp.example.com",
        method: "post",
        operationId: "search.docs",
        pathTemplate: "/mcp",
        transport: {
          protocol: "mcp_streamable_http",
          requestBody: "mcp_tools_call",
          mcpToolName: "search.docs",
          mcpProtocolVersion: "2025-06-18",
        },
      }),
      onComplete: (readback) => completions.push(readback),
      payload: { body: { query: sentinels.mcpArgument } },
    }),
    dnsLookup: async () => [{ address: "203.0.113.11", family: 4 }],
    fetchImpl: async (input, init) => {
      callCount += 1;
      if (String(input) !== "https://mcp.example.com/mcp") {
        throw new Error("MCP worker request URL drifted.");
      }
      const headers = headersRecord(init?.headers);
      protocolHeadersVerified =
        headers.accept === "application/json, text/event-stream" &&
        headers["content-type"] === "application/json" &&
        headers["mcp-protocol-version"] === "2025-06-18" &&
        headers["mcp-method"] === "tools/call" &&
        headers["mcp-name"] === "search.docs";
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<
        string,
        unknown
      >;
      const params =
        typeof body.params === "object" &&
        body.params !== null &&
        !Array.isArray(body.params)
          ? (body.params as Record<string, unknown>)
          : {};
      const args =
        typeof params.arguments === "object" &&
        params.arguments !== null &&
        !Array.isArray(params.arguments)
          ? (params.arguments as Record<string, unknown>)
          : {};
      jsonRpcToolsCallVerified =
        body.jsonrpc === "2.0" &&
        body.id === jobId &&
        body.method === "tools/call" &&
        params.name === "search.docs" &&
        args.query === sentinels.mcpArgument;
      if (!protocolHeadersVerified || !jsonRpcToolsCallVerified) {
        throw new Error("MCP worker did not send a tools/call envelope.");
      }
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: jobId,
          result: { content: [{ type: "text", text: sentinels.responseBody }] },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  const workerJson = parseWorkerJson(result.stdout);
  if (
    workerJson.completedCount !== 1 ||
    completions.length !== 1 ||
    callCount !== 1 ||
    !jsonRpcToolsCallVerified ||
    !protocolHeadersVerified ||
    containsRaw(sentinels.mcpArgument, [
      result.stdout,
      JSON.stringify(completions),
    ])
  ) {
    throw new Error("MCP Streamable HTTP dispatch evidence was incomplete.");
  }
  return {
    callCount,
    completedCount: workerJson.completedCount,
    completions,
    jsonRpcToolsCallVerified,
    protocolHeadersVerified,
    stdout: result.stdout,
  };
}

async function assertInvalidSchemaIsMetadataOnly(): Promise<{
  completedCount: number;
  schemaValidationFailed: boolean;
  stdout: string;
}> {
  const completions: ToolOperationDispatchRequestReadbackResult[] = [];
  const result = await runWorker({
    client: singleClaimClient({
      claim: dispatchClaim("tool_dispatch_invalid_schema", {
        responseValidation: successResponseValidation(),
      }),
      onComplete: (readback) => completions.push(readback),
      payload: { parameters: { issueId: "schema-check" } },
    }),
    fetchImpl: async () =>
      new Response(JSON.stringify({ raw: sentinels.responseBody }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });

  const workerJson = parseWorkerJson(result.stdout);
  const schemaValidation = completions[0]?.response?.schemaValidation;
  const schemaValidationFailed =
    schemaValidation?.status === "failed" &&
    schemaValidation.errorCode === "response_required_property_missing";
  if (workerJson.completedCount !== 1 || !schemaValidationFailed) {
    throw new Error(
      `Tool-dispatch schema validation failure was not recorded: ${JSON.stringify(
        {
          completedCount: workerJson.completedCount,
          schemaValidation,
        },
      )}`,
    );
  }
  if (
    containsRaw(sentinels.responseBody, [
      result.stdout,
      JSON.stringify(completions),
    ])
  ) {
    throw new Error("Invalid schema response body leaked into readback.");
  }
  return {
    completedCount: workerJson.completedCount,
    schemaValidationFailed,
    stdout: result.stdout,
  };
}

async function assertPrivateDnsDeniedBeforeFetch(): Promise<{
  errorCode: string | undefined;
  failedCount: number;
  fetchAttemptCount: number;
}> {
  const failures: ToolOperationDispatchRequestReadbackResult[] = [];
  let fetchAttemptCount = 0;
  const result = await runWorker({
    client: singleClaimClient({
      claim: dispatchClaim("tool_dispatch_private_dns", {
        host: "private-dispatch.example.com",
      }),
      onFail: (readback) => failures.push(readback),
      payload: { parameters: { issueId: "dns-check" } },
    }),
    dnsLookup: async () => [{ address: "10.42.0.15", family: 4 }],
    fetchImpl: async () => {
      fetchAttemptCount += 1;
      return new Response("{}");
    },
  });

  const workerJson = parseWorkerJson(result.stdout);
  const errorCode = failures[0]?.errorCode;
  if (
    workerJson.failedCount !== 1 ||
    errorCode !== "worker_host_denied" ||
    fetchAttemptCount !== 0
  ) {
    throw new Error("Private DNS dispatch was not denied before fetch.");
  }
  return { errorCode, failedCount: workerJson.failedCount, fetchAttemptCount };
}

async function assertMissingSecretDeniedBeforeFetch(): Promise<{
  errorCode: string | undefined;
  failedCount: number;
  fetchAttemptCount: number;
}> {
  const failures: ToolOperationDispatchRequestReadbackResult[] = [];
  let fetchAttemptCount = 0;
  const result = await runWorker({
    client: singleClaimClient({
      claim: dispatchClaim("tool_dispatch_missing_secret"),
      onFail: (readback) => failures.push(readback),
      payload: {
        auth: { secretRef: sentinels.missingSecretRef, type: "bearer" },
        parameters: { issueId: "missing-secret" },
      },
    }),
    fetchImpl: async () => {
      fetchAttemptCount += 1;
      return new Response("{}");
    },
    secretResolver: {
      async resolveValue(secretRef: string): Promise<SecretValueResolution> {
        return unavailableSecret(secretRef);
      },
    },
  });

  const workerJson = parseWorkerJson(result.stdout);
  const errorCode = failures[0]?.errorCode;
  if (
    workerJson.failedCount !== 1 ||
    errorCode !== "worker_secret_unavailable" ||
    fetchAttemptCount !== 0
  ) {
    throw new Error("Missing worker secret did not fail before fetch.");
  }
  return { errorCode, failedCount: workerJson.failedCount, fetchAttemptCount };
}

function singleClaimClient(input: {
  claim: ToolOperationDispatchRequestClaimResult;
  onClaim?: () => void;
  onComplete?: (readback: ToolOperationDispatchRequestReadbackResult) => void;
  onFail?: (readback: ToolOperationDispatchRequestReadbackResult) => void;
  onPayloadRead?: () => void;
  payload?: ToolOperationDispatchPayload;
  payloadStoreObjectKey?: string;
}): ToolDispatchWorkerClient {
  let claimed = false;
  return {
    tool: {
      claimDispatchRequest: async () => {
        if (claimed) return { claimed: false, workerQueue };
        claimed = true;
        input.onClaim?.();
        return {
          ...input.claim,
          ...(input.payloadStoreObjectKey === undefined
            ? {}
            : {
                payloadStore: {
                  contentType:
                    "application/vnd.romeo.tool-dispatch-payload+json",
                  driver: "object_store",
                  encrypted: true,
                  objectKey: input.payloadStoreObjectKey,
                  schemaVersion: "romeo.tool-dispatch-payload.v1",
                },
              }),
        };
      },
      readDispatchRequestPayload: async ({ jobId }) => {
        if (
          jobId !== input.claim.job?.id ||
          input.payload === undefined ||
          input.claim.request?.payloadStorage !==
            "managed_encrypted_object_store"
        ) {
          throw new Error("payload unavailable");
        }
        input.onPayloadRead?.();
        return payloadResult(input.claim, input.payload);
      },
      completeDispatchRequest: async ({ response }) => {
        const readback = readbackResult(input.claim, "completed", {
          response,
        });
        completionReadbacks.push(readback);
        input.onComplete?.(readback);
        return readback;
      },
      failDispatchRequest: async ({ errorCode }) => {
        const readback = readbackResult(input.claim, "failed", {
          errorCode,
        });
        failureReadbacks.push(readback);
        input.onFail?.(readback);
        return readback;
      },
    },
  };
}

async function runWorker(input: {
  client: ToolDispatchWorkerClient;
  dnsLookup?: (
    host: string,
  ) => Promise<Array<{ address: string; family?: number }>>;
  fetchImpl: typeof fetch;
  payloads?: Record<string, ToolOperationDispatchPayload>;
  secretResolver?: SecretValueResolver;
}): Promise<{ stderr: string; stdout: string }> {
  const output = createOutput();
  const exitCode = await runToolDispatchWorker({
    client: input.client,
    ...(input.dnsLookup === undefined ? {} : { dnsLookup: input.dnsLookup }),
    fetchImpl: input.fetchImpl,
    intervalMs: 60_000,
    io: output.io,
    leaseSeconds: 300,
    maxBytes: 1_000_000,
    maxIterations: 1,
    ...(input.payloads === undefined ? {} : { payloads: input.payloads }),
    ...(input.secretResolver === undefined
      ? {}
      : { secretResolver: input.secretResolver }),
    timeoutMs: 10_000,
  });
  if (exitCode !== 0) {
    throw new Error(`Tool-dispatch worker exited ${exitCode}.`);
  }
  const stdout = output.stdout();
  const stderr = output.stderr();
  workerOutputs.push(stdout, stderr);
  return { stdout, stderr };
}

function dispatchClaim(
  jobId: string,
  options: {
    bodyKeys?: string[];
    host?: string;
    method?: string;
    operationId?: string;
    payloadStorage?:
      | "external_worker_secret_store_required"
      | "managed_encrypted_object_store";
    pathTemplate?: string;
    responseValidation?: ToolOperationDispatchRequestClaimResult["responseValidation"];
    transport?: ToolOperationDispatchRequestClaimResult["transport"];
  } = {},
): ToolOperationDispatchRequestClaimResult {
  return {
    claimed: true,
    job: { id: jobId, type: dispatchType, status: "running" },
    connectorId: "tool_connector_acceptance",
    operationId: options.operationId ?? "getIssue",
    method: options.method ?? "get",
    pathTemplate: options.pathTemplate ?? "/issues/{issueId}",
    workerQueue,
    request: {
      parameterKeys: ["issueId"],
      bodyKeys:
        options.bodyKeys ?? (options.method === "post" ? ["value"] : []),
      host: options.host ?? "api.example.com",
      payloadStorage:
        options.payloadStorage ?? "managed_encrypted_object_store",
    },
    lease: {
      attempt: 1,
      claimedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      leaseSeconds: 300,
      renewedAt: new Date().toISOString(),
      workerId: "tool-dispatch-acceptance-worker",
    },
    ...(options.responseValidation === undefined
      ? {}
      : { responseValidation: options.responseValidation }),
    ...(options.transport === undefined
      ? {}
      : { transport: options.transport }),
  };
}

function payloadResult(
  claim: ToolOperationDispatchRequestClaimResult,
  payload: ToolOperationDispatchPayload,
): ToolOperationDispatchRequestPayloadResult {
  return {
    job: claimedJob(claim, "running"),
    connectorId: claim.connectorId ?? "tool_connector_acceptance",
    operationId: claim.operationId ?? "operation",
    method: claim.method ?? "get",
    pathTemplate: claim.pathTemplate ?? "/",
    workerQueue,
    request: claim.request ?? {
      bodyKeys: [],
      host: "api.example.com",
      parameterKeys: [],
      payloadStorage: "managed_encrypted_object_store",
    },
    payload,
  };
}

function readbackResult(
  claim: ToolOperationDispatchRequestClaimResult,
  outcome: "completed" | "failed",
  result: {
    errorCode?: string;
    response?: ToolOperationDispatchReadbackResponse;
  },
): ToolOperationDispatchRequestReadbackResult {
  return {
    job: claimedJob(claim, outcome === "completed" ? "completed" : "failed"),
    connectorId: claim.connectorId ?? "tool_connector_acceptance",
    operationId: claim.operationId ?? "operation",
    method: claim.method ?? "get",
    pathTemplate: claim.pathTemplate ?? "/",
    workerQueue,
    outcome,
    ...(result.errorCode === undefined ? {} : { errorCode: result.errorCode }),
    ...(result.response === undefined ? {} : { response: result.response }),
  };
}

function claimedJob(
  claim: ToolOperationDispatchRequestClaimResult,
  status: "completed" | "failed" | "queued" | "running",
): {
  id: string;
  status: "completed" | "failed" | "queued" | "running";
  type: string;
} {
  return {
    id: claim.job?.id ?? "tool_dispatch_unknown",
    status,
    type: dispatchType,
  };
}

function successResponseValidation(): NonNullable<
  ToolOperationDispatchRequestClaimResult["responseValidation"]
> {
  return {
    jsonSchemas: {
      "200": {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
      },
    },
  };
}

function createOutput(): {
  io: CliIo;
  stderr: () => string;
  stdout: () => string;
} {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      stderr: {
        write: (chunk: string | Uint8Array) => {
          stderr += String(chunk);
          return true;
        },
      },
      stdout: {
        write: (chunk: string | Uint8Array) => {
          stdout += String(chunk);
          return true;
        },
      },
    },
    stderr: () => stderr,
    stdout: () => stdout,
  };
}

function parseWorkerJson(stdout: string): Record<string, number | string> {
  const parsed = JSON.parse(stdout) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Worker stdout did not contain a JSON object.");
  }
  return parsed as Record<string, number | string>;
}

function headersRecord(
  headers: HeadersInit | undefined,
): Record<string, string> {
  const output: Record<string, string> = {};
  if (headers === undefined) return output;
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      output[key.toLowerCase()] = value;
    });
    return output;
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) output[key.toLowerCase()] = value;
    return output;
  }
  for (const [key, value] of Object.entries(headers)) {
    output[key.toLowerCase()] = value;
  }
  return output;
}

function unavailableSecret(secretRef: string): SecretValueResolution {
  return {
    available: false,
    failureCode: "secret_not_found",
    scheme: secretRef.split("://", 1)[0] ?? "unknown",
  };
}

function containsRaw(values: string | string[], targets: string[]): boolean {
  const rawValues = Array.isArray(values) ? values : [values];
  return rawValues.some((value) =>
    targets.some((target) => target.includes(value)),
  );
}

function writeEvidence(path: string | undefined, value: unknown): void {
  if (path === undefined || path.length === 0) {
    throw new Error("--output is required.");
  }
  const resolved = isAbsolute(path) ? path : resolve(repoRoot, path);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`);
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}
