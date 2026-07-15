import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readEnv } from "../packages/config/src/index";
import { createRomeoApi } from "../packages/core/src/api";
import { InMemoryRomeoRepository } from "../packages/core/src/repositories/in-memory";
import { EnvironmentSecretResolver } from "../packages/core/src/services/secret-resolver";
import { MemoryObjectStore } from "../packages/storage/src/memory-object-store";

type Api = ReturnType<typeof createRomeoApi>;
type JsonRecord = Record<string, unknown>;

const output = argValue("--output");
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pid = process.pid;
const sentinels = {
  approvalProviderCallId: `call_provider_approval_secret_${pid}`,
  approvalRawArg: `RAW_APPROVAL_ARG_${pid}`,
  dispatchProviderCallId: `call_provider_dispatch_secret_${pid}`,
  dispatchRawIssue: `RAW_DISPATCH_ISSUE_${pid}`,
  inlineExpression: `6 + ${pid % 10}`,
  inlineProviderCallId: `call_provider_inline_secret_${pid}`,
  inlineRawResult: JSON.stringify({ result: 6 + (pid % 10) }),
  managedBody: `RAW_MANAGED_BODY_${pid}`,
  managedIssue: `RAW_MANAGED_ISSUE_${pid}`,
  managedProviderCallId: `call_provider_managed_secret_${pid}`,
};

const inline = await proveInlineToolContinuation();
const dispatch = await proveImportedDispatchWaitAndResume();
const managed = await proveManagedDispatchPayloadRedaction();
const approval = await proveApprovalRejectRedaction();

const evidence = {
  schemaVersion: "romeo.model-tool-orchestration-contract-smoke.v1",
  generatedAt: new Date().toISOString(),
  status: "passed",
  checks: [
    "openai_chat_tool_call_normalizes_and_continues",
    "tool_schema_injection_authorized_for_builtin",
    "run_events_omit_provider_call_ids_and_arguments",
    "imported_operation_dispatch_waits_and_resumes",
    "worker_readback_continuation_uses_dispatch_job_id",
    "managed_dispatch_payload_is_encrypted_and_redacted",
    "approval_wait_reject_terminalizes_without_replay",
    "pending_approval_readback_is_metadata_only",
    "model_tool_evidence_omits_raw_values",
  ],
  inline,
  dispatch,
  managedPayload: managed,
  approval,
  redaction: {
    rawProviderCallIdsReturned: false,
    rawToolArgumentsReturned: false,
    rawToolResultsReturned: false,
    rawOperationPayloadsReturned: false,
    rawManagedObjectKeysReturned: false,
  },
};

assertNoRaw("model tool evidence", JSON.stringify(evidence));
writeEvidence(output, evidence);
process.stdout.write(`Wrote model-tool orchestration contract to ${output}.\n`);

async function proveInlineToolContinuation(): Promise<{
  completedRun: true;
  providerRequestCount: number;
  runContinuingEventCount: number;
  toolCompletedEventCount: number;
  toolSchemaInjected: true;
}> {
  const repository = new InMemoryRomeoRepository();
  const provider = await repository.getProvider("provider_openai_compatible");
  if (provider === undefined) throw new Error("Expected seeded provider.");
  provider.baseUrl = "https://api.example/v1";
  provider.credentialRef = "env://ROMEO_PROVIDER_API_KEY";

  const providerBodies: JsonRecord[] = [];
  const api = createRomeoApi(repository, {
    providerFetch: async (_input, init) => {
      providerBodies.push(JSON.parse(String(init?.body)) as JsonRecord);
      if (providerBodies.length === 1) {
        return new Response(
          providerSse([
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: sentinels.inlineProviderCallId,
                        function: {
                          name: "tool_calculator",
                          arguments: JSON.stringify({
                            expression: sentinels.inlineExpression,
                          }),
                        },
                      },
                    ],
                  },
                  finish_reason: "tool_calls",
                },
              ],
            },
          ]),
          { status: 200 },
        );
      }
      return new Response(
        providerSse([
          { choices: [{ delta: { content: "Inline tool completed." } }] },
        ]),
        { status: 200 },
      );
    },
    secretResolver: providerSecretResolver(),
  });

  const chat = await createChat(api, "Model Tool Inline Contract");
  const run = await startRun(api, chat.data.id, "Calculate the value.");
  const messages = await waitForAssistantMessage(api, chat.data.id);
  const eventStream = await text(api, `/api/v1/runs/${run.data.id}/events`);
  const jobs = await json(api, "/api/v1/jobs");
  const serializedJobs = JSON.stringify(jobs);
  const serializedFirstBody = JSON.stringify(providerBodies[0]);
  const serializedSecondBody = JSON.stringify(providerBodies[1]);

  assertStatus(run.responseStatus, 202, "inline run start");
  assert(
    providerBodies.length === 2,
    "Inline model tool run did not resume provider generation.",
  );
  assert(
    serializedFirstBody.includes("tool_calculator"),
    "Built-in tool schema was not injected.",
  );
  assert(
    serializedSecondBody.includes("tool_calls"),
    "Continuation did not include tool call context.",
  );
  assert(
    messages.some(
      (message) =>
        message.role === "assistant" &&
        message.content.includes("Inline tool completed."),
    ),
    "Inline tool continuation did not write assistant message.",
  );
  assert(
    eventStream.includes("event: tool.requested"),
    "Missing tool.requested.",
  );
  assert(
    eventStream.includes("event: tool.completed"),
    "Missing tool.completed.",
  );
  assert(
    eventStream.includes("event: run.completed"),
    "Missing run.completed.",
  );
  assertNoRaw("inline run events", eventStream);
  assertNoRaw("inline jobs", serializedJobs);

  return {
    completedRun: true,
    providerRequestCount: providerBodies.length,
    runContinuingEventCount: count(eventStream, "event: run.continuing"),
    toolCompletedEventCount: count(eventStream, "event: tool.completed"),
    toolSchemaInjected: true,
  };
}

async function proveImportedDispatchWaitAndResume(): Promise<{
  completedRun: true;
  dispatchJobIdInContinuation: true;
  providerRequestCount: number;
  waitingDispatchEventCount: number;
  workerReadbackOutcome: "completed";
}> {
  const repository = new InMemoryRomeoRepository();
  const provider = await repository.getProvider("provider_openai_compatible");
  if (provider === undefined) throw new Error("Expected seeded provider.");
  provider.baseUrl = "https://api.example/v1";
  provider.credentialRef = "env://ROMEO_PROVIDER_API_KEY";

  const providerBodies: JsonRecord[] = [];
  const api = createRomeoApi(repository, {
    env: readEnv({ TOOL_OPERATION_EXECUTION_DRIVER: "http-fetch" }),
    providerFetch: async (_input, init) => {
      providerBodies.push(JSON.parse(String(init?.body)) as JsonRecord);
      if (providerBodies.length === 1) {
        const operationToolName = operationToolNameFromBody(providerBodies[0]);
        return new Response(
          providerSse([
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: sentinels.dispatchProviderCallId,
                        function: {
                          name: operationToolName,
                          arguments: JSON.stringify({
                            parameters: {
                              issueId: sentinels.dispatchRawIssue,
                              expand: "comments",
                            },
                          }),
                        },
                      },
                    ],
                  },
                  finish_reason: "tool_calls",
                },
              ],
            },
          ]),
          { status: 200 },
        );
      }
      return new Response(
        providerSse([
          {
            choices: [
              { delta: { content: "Dispatch continuation completed." } },
            ],
          },
        ]),
        { status: 200 },
      );
    },
    secretResolver: providerSecretResolver(),
  });

  const imported = await importReadOnlyIssueConnector(api);
  const operation = await enableAndBindOperation(api, imported, false);
  const chat = await createChat(api, "Model Tool Dispatch Contract");
  const run = await startRun(api, chat.data.id, "Look up the issue.");
  const waitingRun = await json(api, `/api/v1/runs/${run.data.id}`);
  const initialEvents = await text(api, `/api/v1/runs/${run.data.id}/events`);
  const jobId = jobIdFromEvents(initialEvents);
  const claim = await postJson(
    api,
    "/api/v1/tool-operation-dispatch-requests/claim",
    { leaseSeconds: 300 },
  );
  const complete = await postJson(
    api,
    `/api/v1/tool-operation-dispatch-requests/${jobId}/complete`,
    {
      response: {
        ok: true,
        status: 200,
        contentType: "application/json",
        bodyBytes: 128,
        truncated: false,
        schemaValidation: { status: "not_applicable" },
      },
    },
  );
  await waitForAssistantMessage(api, chat.data.id);
  const completedRun = await json(api, `/api/v1/runs/${run.data.id}`);
  const completedEvents = await text(api, `/api/v1/runs/${run.data.id}/events`);
  const jobs = await json(api, "/api/v1/jobs");
  const audit = await json(api, "/api/v1/audit-logs");
  const toolCalls = await json(api, "/api/v1/tool-calls");
  const serializedReadbacks = JSON.stringify({ jobs, audit, toolCalls });

  assertStatus(run.responseStatus, 202, "dispatch run start");
  assert(
    ["queued", "running"].includes(String(waitingRun.data.status)),
    `Run status was not dispatch-wait compatible: ${String(waitingRun.data.status)}.`,
  );
  assert(
    initialEvents.includes("event: run.waiting_tool_dispatch"),
    `Run did not emit dispatch wait: ${JSON.stringify({
      events: eventNames(initialEvents),
    })}`,
  );
  assert(
    claim.data.job.id === jobId,
    "Worker claim did not return dispatch job.",
  );
  assert(complete.data.outcome === "completed", "Dispatch did not complete.");
  assert(
    completedRun.data.status === "completed",
    "Dispatch readback did not resume run.",
  );
  assert(
    JSON.stringify(providerBodies[0]).includes(operation.id),
    "Provider request did not include imported operation tool.",
  );
  assert(
    JSON.stringify(providerBodies[1]).includes(jobId),
    "Provider continuation did not use dispatch job ID.",
  );
  assert(
    initialEvents.includes("event: run.waiting_tool_dispatch"),
    "Missing dispatch wait event.",
  );
  assert(
    completedEvents.includes("event: run.continuing"),
    "Missing continuation event.",
  );
  assert(
    completedEvents.includes('"reason":"tool_dispatch"'),
    "Continuation reason was not tool_dispatch.",
  );
  assertNoRaw("dispatch initial events", initialEvents);
  assertNoRaw("dispatch completed events", completedEvents);
  assertNoRaw("dispatch readbacks", serializedReadbacks);

  return {
    completedRun: true,
    dispatchJobIdInContinuation: true,
    providerRequestCount: providerBodies.length,
    waitingDispatchEventCount: count(
      initialEvents,
      "run.waiting_tool_dispatch",
    ),
    workerReadbackOutcome: "completed",
  };
}

async function proveManagedDispatchPayloadRedaction(): Promise<{
  encryptedObjectWritten: true;
  encryptedPayloadRedacted: true;
  eventObjectKeyRedacted: true;
  payloadStorage: "managed_encrypted_object_store";
}> {
  const repository = new InMemoryRomeoRepository();
  const objectStore = new MemoryObjectStore();
  const provider = await repository.getProvider("provider_openai_compatible");
  if (provider === undefined) throw new Error("Expected seeded provider.");
  provider.baseUrl = "https://api.example/v1";
  provider.credentialRef = "env://ROMEO_PROVIDER_API_KEY";

  const providerBodies: JsonRecord[] = [];
  const api = createRomeoApi(repository, {
    env: readEnv({
      TOOL_OPERATION_EXECUTION_DRIVER: "http-fetch",
      TOOL_DISPATCH_PAYLOAD_ENCRYPTION_KEY:
        "managed-tool-payload-key-32-bytes-min",
      TOOL_DISPATCH_PAYLOAD_STORE_DRIVER: "object-store",
    }),
    objectStore,
    providerFetch: async (_input, init) => {
      providerBodies.push(JSON.parse(String(init?.body)) as JsonRecord);
      const operationToolName = operationToolNameFromBody(providerBodies[0]);
      return new Response(
        providerSse([
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: sentinels.managedProviderCallId,
                      function: {
                        name: operationToolName,
                        arguments: JSON.stringify({
                          body: { note: sentinels.managedBody },
                          parameters: {
                            issueId: sentinels.managedIssue,
                          },
                        }),
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          },
        ]),
        { status: 200 },
      );
    },
    secretResolver: providerSecretResolver(),
  });

  const imported = await importReadOnlyIssueConnector(api);
  await enableAndBindOperation(api, imported, false);
  const chat = await createChat(api, "Managed Dispatch Payload Contract");
  const run = await startRun(api, chat.data.id, "Look up the managed issue.");
  const events = await text(api, `/api/v1/runs/${run.data.id}/events`);
  const claim = await postJson(
    api,
    "/api/v1/tool-operation-dispatch-requests/claim",
    { leaseSeconds: 300 },
  );
  const objectKey = claim.data.payloadStore?.objectKey;
  assert(typeof objectKey === "string", "Managed dispatch object key missing.");
  const storedBytes = await objectStore.getObject(objectKey);
  assert(storedBytes !== undefined, "Managed dispatch payload was not stored.");
  const encryptedPayload = Buffer.from(storedBytes).toString("utf8");
  const jobs = await json(api, "/api/v1/jobs");
  const serializedJobs = JSON.stringify(jobs);

  assertStatus(run.responseStatus, 202, "managed dispatch run start");
  assert(
    claim.data.request.payloadStorage === "managed_encrypted_object_store",
    "Managed dispatch claim did not use encrypted object-store payloads.",
  );
  assert(
    encryptedPayload.includes('"algorithm":"aes-256-gcm"'),
    "Managed dispatch payload was not encrypted.",
  );
  assert(
    !encryptedPayload.includes(sentinels.managedIssue),
    "Encrypted payload leaked issue.",
  );
  assert(
    !encryptedPayload.includes(sentinels.managedBody),
    "Encrypted payload leaked body.",
  );
  assert(
    !events.includes(objectKey),
    "Run events leaked managed payload object key.",
  );
  assertNoRaw("managed dispatch events", events);
  assertNoRaw("managed dispatch jobs", serializedJobs);

  return {
    encryptedObjectWritten: true,
    encryptedPayloadRedacted: true,
    eventObjectKeyRedacted: true,
    payloadStorage: "managed_encrypted_object_store",
  };
}

async function proveApprovalRejectRedaction(): Promise<{
  pendingApprovalRedacted: true;
  providerContinuationCount: 0;
  rejectedApprovalRemoved: true;
  runCancelled: true;
}> {
  const repository = new InMemoryRomeoRepository();
  const provider = await repository.getProvider("provider_openai_compatible");
  if (provider === undefined) throw new Error("Expected seeded provider.");
  provider.baseUrl = "https://api.example/v1";
  provider.credentialRef = "env://ROMEO_PROVIDER_API_KEY";

  const providerBodies: JsonRecord[] = [];
  const api = createRomeoApi(repository, {
    providerFetch: async (_input, init) => {
      providerBodies.push(JSON.parse(String(init?.body)) as JsonRecord);
      return new Response(
        providerSse([
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: sentinels.approvalProviderCallId,
                      function: {
                        name: "tool_datetime",
                        arguments: JSON.stringify({
                          timeZone: sentinels.approvalRawArg,
                        }),
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          },
        ]),
        { status: 200 },
      );
    },
    secretResolver: providerSecretResolver(),
  });

  const chat = await createChat(api, "Model Tool Approval Contract");
  const run = await startRun(api, chat.data.id, "What time is it?");
  const eventStream = await text(api, `/api/v1/runs/${run.data.id}/events`);
  const approvalRequestId = approvalIdFromEvents(eventStream);
  const pendingApprovals = await json(
    api,
    `/api/v1/tool-approvals?runId=${run.data.id}`,
  );
  const rejected = await postJson(
    api,
    `/api/v1/tool-approvals/${approvalRequestId}/reject`,
    {},
  );
  const cancelledRun = await json(api, `/api/v1/runs/${run.data.id}`);
  const rejectedEvents = await text(api, `/api/v1/runs/${run.data.id}/events`);
  const pendingAfterReject = await json(
    api,
    `/api/v1/tool-approvals?runId=${run.data.id}`,
  );
  const replay = await postJson(
    api,
    `/api/v1/runs/${run.data.id}/tools/tool_datetime/execute`,
    { approvalRequestId, approved: true, input: { timeZone: "UTC" } },
    409,
  );

  assertStatus(run.responseStatus, 202, "approval run start");
  assert(
    eventStream.includes("event: run.waiting_tool_approval"),
    "Missing approval wait event.",
  );
  assert(
    pendingApprovals.data.some(
      (approval: { id?: string }) => approval.id === approvalRequestId,
    ),
    "Pending approval was not listed.",
  );
  assert(
    rejected.data.status === "rejected",
    "Approval reject did not persist.",
  );
  assert(
    cancelledRun.data.status === "cancelled",
    "Reject did not cancel run.",
  );
  assert(
    rejectedEvents.includes("event: run.cancelled"),
    "Reject did not emit cancellation.",
  );
  assert(
    !pendingAfterReject.data.some(
      (approval: { id?: string }) => approval.id === approvalRequestId,
    ),
    "Rejected approval remained pending.",
  );
  assert(
    replay.error.code === "run_tool_execution_not_active",
    "Rejected approval replay did not fail closed.",
  );
  assert(
    providerBodies.length === 1,
    "Rejected approval resumed provider unexpectedly.",
  );
  assertNoRaw("approval events", eventStream);
  assertNoRaw("approval pending list", JSON.stringify(pendingApprovals));
  assertNoRaw("approval rejected events", rejectedEvents);

  return {
    pendingApprovalRedacted: true,
    providerContinuationCount: providerBodies.length - 1,
    rejectedApprovalRemoved: true,
    runCancelled: true,
  };
}

function providerSecretResolver(): EnvironmentSecretResolver {
  return new EnvironmentSecretResolver({
    ROMEO_PROVIDER_API_KEY: "provider-api-key",
  });
}

async function createChat(
  api: Api,
  title: string,
): Promise<{ data: { id: string } }> {
  return postJson(
    api,
    "/api/v1/chats",
    {
      workspaceId: "workspace_default",
      title,
    },
    201,
  );
}

async function startRun(
  api: Api,
  chatId: string,
  content: string,
): Promise<{ data: { id: string }; responseStatus: number }> {
  const response = await api.request("/api/v1/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentId: "agent_default", chatId, content }),
  });
  const body = (await response.json()) as { data: { id: string } };
  return { ...body, responseStatus: response.status };
}

async function importReadOnlyIssueConnector(
  api: Api,
): Promise<{ connectorId: string; operationId: string }> {
  const imported = await postJson(
    api,
    "/api/v1/tools/openapi",
    {
      name: "Model Tool Dispatch Tracker",
      spec: {
        openapi: "3.1.0",
        info: { title: "Model Tool Dispatch Tracker", version: "1.0.0" },
        servers: [{ url: "https://api.example.com" }],
        paths: {
          "/issues/{issueId}": {
            get: {
              operationId: "getIssue",
              parameters: [
                { in: "path", name: "issueId", schema: { type: "string" } },
                { in: "query", name: "expand", schema: { type: "string" } },
              ],
              responses: { 200: { description: "OK" } },
              summary: "Get issue",
            },
          },
        },
      },
    },
    201,
  );
  return {
    connectorId: imported.data.connector.id,
    operationId: "getIssue",
  };
}

async function enableAndBindOperation(
  api: Api,
  imported: { connectorId: string; operationId: string },
  approvalRequired: boolean,
): Promise<{ id: string; operationId: string }> {
  await patchJson(api, `/api/v1/tool-connectors/${imported.connectorId}`, {
    enabled: true,
  });
  await patchJson(
    api,
    `/api/v1/tool-connectors/${imported.connectorId}/operations/${imported.operationId}`,
    { enabled: true },
  );
  await patchJson(
    api,
    `/api/v1/tool-connectors/${imported.connectorId}/network-policy`,
    { allowedHosts: ["api.example.com"], mode: "allow_hosts" },
  );
  const operations = await json(
    api,
    `/api/v1/tool-connectors/${imported.connectorId}/operations`,
  );
  const operation = operations.data.find(
    (item: { operationId: string }) =>
      item.operationId === imported.operationId,
  );
  if (operation === undefined) throw new Error("Imported operation missing.");
  await patchJson(api, `/api/v1/agents/agent_default/tools/${operation.id}`, {
    approvalRequired,
    enabled: true,
  });
  return operation as { id: string; operationId: string };
}

async function waitForAssistantMessage(
  api: Api,
  chatId: string,
): Promise<Array<{ content: string; role: string }>> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const messages = await json(api, `/api/v1/chats/${chatId}/messages`);
    if (
      messages.data.some(
        (message: { role: string }) => message.role === "assistant",
      )
    ) {
      return messages.data;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return [];
}

function providerSse(events: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

function operationToolNameFromBody(body: JsonRecord): string {
  const tools = body.tools as
    | Array<{ function?: { name?: string } }>
    | undefined;
  const name = tools?.find((tool) =>
    tool.function?.name?.startsWith("tool_operation_"),
  )?.function?.name;
  if (name === undefined) throw new Error("Expected imported operation tool.");
  return name;
}

function jobIdFromEvents(events: string): string {
  const jobId = events.match(/"jobId":"([^"]+)"/)?.[1];
  if (jobId === undefined) throw new Error("Expected dispatch job ID.");
  return jobId;
}

function approvalIdFromEvents(events: string): string {
  const approvalRequestId = events.match(/"approvalRequestId":"([^"]+)"/)?.[1];
  if (approvalRequestId === undefined) {
    throw new Error("Expected approval request ID.");
  }
  return approvalRequestId;
}

async function json(api: Api, path: string): Promise<any> {
  return (await api.request(path)).json();
}

async function text(api: Api, path: string): Promise<string> {
  return (await api.request(path)).text();
}

async function postJson(
  api: Api,
  path: string,
  body: unknown,
  expectedStatus = 200,
): Promise<any> {
  const response = await api.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  assertStatus(response.status, expectedStatus, path);
  return payload;
}

async function patchJson(api: Api, path: string, body: unknown): Promise<any> {
  const response = await api.request(path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  assertStatus(response.status, 200, path);
  return payload;
}

function assertStatus(actual: number, expected: number, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} returned ${actual}, expected ${expected}.`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertNoRaw(label: string, value: string): void {
  const leaked = Object.values(sentinels).filter((sentinel) =>
    value.includes(sentinel),
  );
  if (leaked.length > 0) {
    throw new Error(`${label} leaked raw model-tool sentinel values.`);
  }
}

function count(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function eventNames(eventStream: string): string[] {
  return [...eventStream.matchAll(/^event: (.+)$/gmu)].map((match) => match[1]);
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
