import { assertScope, type AuthSubject } from "@romeo/auth";
import { createHash } from "node:crypto";

import type {
  BackgroundJob,
  ToolConnector,
  ToolOperation,
  ToolOperationDispatchPayloadStorage,
  ToolOperationDispatchPayloadStoreReference,
  ToolOperationDispatchRequestResult,
  ToolOperationDispatchResult,
  ToolOperationDispatchTransport,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import {
  assertAbuseControlsAllow,
  type AbuseControlEnforcementInput,
} from "./abuse-control-service";
import {
  completeBackgroundJob,
  failBackgroundJob,
  queueBackgroundJob,
  startBackgroundJob,
} from "./job-service";
import { resolveOAuthClientCredentialsAccessToken } from "./tool-oauth-client-credentials";
import type { SecretResolver } from "./secret-resolver";
import {
  buildToolOperationTestPreview,
  type ToolOperationTestInput,
} from "./tool-operation-test";
import { validateToolOperationResponse } from "./tool-response-validation";
import {
  type ToolDispatchPayload,
  type ToolDispatchPayloadAuth,
  type ToolDispatchPayloadStore,
} from "./tool-dispatch-payload-store";
import { writeAuditLog } from "./audit-log";

export interface DispatchToolOperationInput {
  approvalRequestId?: string;
  approved?: boolean;
  body?: Record<string, unknown>;
  connector: ToolConnector;
  externalExecutionEnabled: boolean;
  fetchImpl: typeof fetch;
  maxBytes: number;
  operation: ToolOperation;
  parameters?: Record<string, unknown>;
  repository: RomeoRepository;
  secretResolver: SecretResolver;
  subject: AuthSubject;
  timeoutMs: number;
}

export interface EnqueueToolOperationDispatchInput extends DispatchToolOperationInput {
  dispatchPayloadStore?: ToolDispatchPayloadStore;
  idempotencyKey?: string;
  requiredScope?: "tools:manage" | "tools:use";
  runContext?: {
    agentId: string;
    runId: string;
    toolId: string;
    workspaceId: string;
  };
}

export async function dispatchToolOperation(
  input: DispatchToolOperationInput,
): Promise<ToolOperationDispatchResult> {
  assertScope(input.subject, "tools:manage");
  const previewInput: ToolOperationTestInput = {};
  if (input.parameters !== undefined)
    previewInput.parameters = input.parameters;
  if (input.body !== undefined) previewInput.body = input.body;
  const preview = buildToolOperationTestPreview(
    input.connector,
    input.operation,
    previewInput,
    {
      externalExecutionEnabled: input.externalExecutionEnabled,
    },
  );
  if (!preview.readyForExecution) {
    throw new ApiError(
      "tool_operation_not_ready",
      "Tool operation is not ready for external worker dispatch.",
      409,
      {
        disabledReasons: preview.disabledReasons,
      },
    );
  }
  await assertDispatchApproval(input, "tool.operation.dispatch");
  await assertAbuseControlsAllow(input.repository, input.subject, {
    action: "tool.dispatch",
    connectorId: input.connector.id,
    workerClass: "tool.operation.dispatch",
  });

  const job = await startBackgroundJob(input.repository, {
    orgId: input.subject.orgId,
    type: "tool.operation.dispatch",
    payload: {
      connectorId: input.connector.id,
      operationId: input.operation.operationId,
      method: input.operation.method,
      path: input.operation.path,
      parameterKeys: sortedKeys(input.parameters),
      bodyKeys: sortedKeys(input.body),
      ...(input.approvalRequestId === undefined
        ? {}
        : { approvalRequestId: input.approvalRequestId }),
    },
  });

  try {
    const request = await buildRequest(input);
    const response = await fetchBounded(
      input.fetchImpl,
      request.url,
      request.init,
      input.operation,
      input.timeoutMs,
      input.maxBytes,
    );
    const completed = await completeBackgroundJob(input.repository, job);
    await auditDispatch(input, completed, request, response, "success");
    return {
      job: summarizeJob(completed),
      connectorId: input.connector.id,
      operationId: input.operation.operationId,
      method: input.operation.method,
      pathTemplate: input.operation.path,
      request: {
        parameterKeys: sortedKeys(input.parameters),
        bodyKeys: sortedKeys(input.body),
        host: request.url.hostname,
        authInjected: request.authInjected,
      },
      response,
    };
  } catch (error) {
    const code = dispatchErrorCode(error);
    const failed = await failBackgroundJob(input.repository, job, code);
    await auditDispatchFailure(input, failed, code);
    if (error instanceof ApiError) throw error;
    throw new ApiError(code, "Tool operation dispatch failed.", 502);
  }
}

export async function enqueueToolOperationDispatch(
  input: EnqueueToolOperationDispatchInput,
): Promise<ToolOperationDispatchRequestResult> {
  assertScope(input.subject, input.requiredScope ?? "tools:manage");
  const previewInput: ToolOperationTestInput = {};
  if (input.parameters !== undefined)
    previewInput.parameters = input.parameters;
  if (input.body !== undefined) previewInput.body = input.body;
  const preview = buildToolOperationTestPreview(
    input.connector,
    input.operation,
    previewInput,
    {
      externalExecutionEnabled: input.externalExecutionEnabled,
    },
  );
  if (!preview.readyForExecution) {
    throw new ApiError(
      "tool_operation_not_ready",
      "Tool operation is not ready for external worker dispatch.",
      409,
      {
        disabledReasons: preview.disabledReasons,
      },
    );
  }
  const host = dispatchBaseHost(input.connector);
  const idempotency = dispatchRequestIdempotency(input);
  if (idempotency !== undefined) {
    const existing = await findIdempotentDispatchRequest(
      input,
      idempotency.keyHash,
    );
    if (existing !== undefined) {
      await auditDispatchEnqueue(input, existing, host, {
        keyHash: idempotency.keyHash,
        replayed: true,
      });
      return dispatchRequestResult(input, existing, host, true);
    }
  }
  if (input.operation.approvalPolicy !== "never" && input.approved !== true) {
    await assertDispatchApproval(input, "tool.operation.dispatch.enqueue");
  }
  const enforcementInput: AbuseControlEnforcementInput =
    input.runContext === undefined
      ? {
          action: "tool.dispatch",
          connectorId: input.connector.id,
          workerClass: "external_tool_operations",
        }
      : {
          action: "tool.dispatch",
          connectorId: input.connector.id,
          toolId: input.runContext.toolId,
          workerClass: "external_tool_operations",
          workspaceId: input.runContext.workspaceId,
        };
  await assertAbuseControlsAllow(
    input.repository,
    input.subject,
    enforcementInput,
  );

  const storedPayload = await storeDispatchPayload(input);
  try {
    const result = await input.repository.transaction(async (repository) => {
      const scopedInput = { ...input, repository };
      if (idempotency !== undefined) {
        const existing = await findIdempotentDispatchRequest(
          scopedInput,
          idempotency.keyHash,
        );
        if (existing !== undefined) {
          await auditDispatchEnqueue(scopedInput, existing, host, {
            keyHash: idempotency.keyHash,
            replayed: true,
          });
          return dispatchRequestResult(scopedInput, existing, host, true);
        }
      }

      await assertDispatchApproval(
        scopedInput,
        "tool.operation.dispatch.enqueue",
      );
      const payloadStorage = dispatchPayloadStorage(storedPayload);
      const transport = toolOperationDispatchTransport(
        scopedInput.connector,
        scopedInput.operation,
      );
      const job = await queueBackgroundJob(repository, {
        ...(idempotency === undefined ? {} : { id: idempotency.jobId }),
        orgId: scopedInput.subject.orgId,
        ...(scopedInput.runContext === undefined
          ? {}
          : { workspaceId: scopedInput.runContext.workspaceId }),
        type: "tool.operation.dispatch_request",
        payload: {
          actorId: scopedInput.subject.id,
          connectorId: scopedInput.connector.id,
          operationId: scopedInput.operation.operationId,
          method: scopedInput.operation.method,
          path: scopedInput.operation.path,
          workerQueue: "external_tool_operations",
          host,
          approvalPolicy: scopedInput.operation.approvalPolicy,
          riskLevel: scopedInput.operation.riskLevel,
          parameterKeys: sortedKeys(scopedInput.parameters),
          bodyKeys: sortedKeys(scopedInput.body),
          payloadStorage,
          ...(transport === undefined ? {} : { transport }),
          ...(storedPayload === undefined
            ? {}
            : { payloadStore: storedPayload }),
          ...(scopedInput.runContext === undefined
            ? {}
            : {
                agentId: scopedInput.runContext.agentId,
                runSubjectGroupIds: scopedInput.subject.groupIds,
                runSubjectIsAdmin: scopedInput.subject.isAdmin === true,
                runSubjectScopes: scopedInput.subject.scopes,
                runSubjectType: scopedInput.subject.type,
                runSubjectWorkspaceIds: scopedInput.subject.workspaceIds,
                runContinuation: "model_tool_dispatch",
                runId: scopedInput.runContext.runId,
                toolId: scopedInput.runContext.toolId,
                workspaceId: scopedInput.runContext.workspaceId,
              }),
          ...(idempotency === undefined
            ? {}
            : {
                idempotencyKeyHash: idempotency.keyHash,
                idempotencyScope: idempotency.scope,
              }),
          ...(scopedInput.approvalRequestId === undefined
            ? {}
            : { approvalRequestId: scopedInput.approvalRequestId }),
        },
      });
      await auditDispatchEnqueue(
        scopedInput,
        job,
        host,
        idempotency === undefined
          ? undefined
          : {
              keyHash: idempotency.keyHash,
              replayed: false,
            },
      );
      return dispatchRequestResult(
        scopedInput,
        job,
        host,
        idempotency === undefined ? undefined : false,
      );
    });
    if (storedPayload !== undefined && result.idempotency?.replayed === true)
      await deleteStoredPayload(input, storedPayload);
    return result;
  } catch (error) {
    await deleteStoredPayload(input, storedPayload);
    throw error;
  }
}

async function assertDispatchApproval(
  input: DispatchToolOperationInput,
  auditAction: string,
): Promise<void> {
  if (input.operation.approvalPolicy === "never") return;
  if (input.approved !== true) {
    const approvalRequest = await createDispatchApprovalRequest(input);
    const errorCode = "tool_operation_approval_required";
    await auditApprovalFailure(
      input,
      errorCode,
      auditAction,
      approvalRequest.id,
    );
    throw new ApiError(
      errorCode,
      "Tool operation dispatch requires approval before execution.",
      409,
      {
        approvalPolicy: input.operation.approvalPolicy,
        riskLevel: input.operation.riskLevel,
        approvalRequestId: approvalRequest.id,
      },
    );
  }
  if (input.approvalRequestId === undefined) {
    const errorCode = "tool_operation_approval_request_required";
    await auditApprovalFailure(input, errorCode, auditAction);
    throw new ApiError(
      errorCode,
      "Approved tool operation dispatch requires an approval request ID.",
      409,
      {
        approvalPolicy: input.operation.approvalPolicy,
        riskLevel: input.operation.riskLevel,
      },
    );
  }
  const approvalRequest = (
    await input.repository.listBackgroundJobs(input.subject.orgId)
  ).find((job) => job.id === input.approvalRequestId);
  const validationError = validateDispatchApprovalRequest(
    input,
    approvalRequest,
  );
  if (validationError !== undefined) {
    await auditApprovalFailure(
      input,
      validationError,
      auditAction,
      input.approvalRequestId,
    );
    throw new ApiError(
      validationError,
      "Tool operation approval request is invalid for this dispatch.",
      409,
      {
        approvalPolicy: input.operation.approvalPolicy,
        riskLevel: input.operation.riskLevel,
      },
    );
  }
  if (approvalRequest !== undefined)
    await consumeDispatchApprovalRequest(input, approvalRequest);
}

async function createDispatchApprovalRequest(
  input: DispatchToolOperationInput,
): Promise<BackgroundJob> {
  const job = await startBackgroundJob(input.repository, {
    orgId: input.subject.orgId,
    type: "tool.operation.approval_request",
    payload: {
      actorId: input.subject.id,
      connectorId: input.connector.id,
      operationId: input.operation.operationId,
      method: input.operation.method,
      path: input.operation.path,
      approvalPolicy: input.operation.approvalPolicy,
      riskLevel: input.operation.riskLevel,
      parameterKeys: sortedKeys(input.parameters),
      bodyKeys: sortedKeys(input.body),
    },
  });
  return completeBackgroundJob(input.repository, job);
}

function consumeDispatchApprovalRequest(
  input: DispatchToolOperationInput,
  approvalRequest: BackgroundJob,
): Promise<BackgroundJob> {
  const now = new Date().toISOString();
  return input.repository.updateBackgroundJob({
    ...approvalRequest,
    payload: {
      ...approvalRequest.payload,
      consumedAt: now,
      consumedBy: input.subject.id,
    },
    updatedAt: now,
  });
}

async function auditApprovalFailure(
  input: DispatchToolOperationInput,
  errorCode: string,
  action: string,
  approvalRequestId?: string,
): Promise<void> {
  await writeAuditLog(input.repository, {
    subject: input.subject,
    action,
    resourceType: "tool_operation",
    resourceId: input.operation.id,
    outcome: "failure",
    metadata: {
      connectorId: input.connector.id,
      operationId: input.operation.operationId,
      method: input.operation.method,
      path: input.operation.path,
      approvalPolicy: input.operation.approvalPolicy,
      riskLevel: input.operation.riskLevel,
      parameterKeys: sortedKeys(input.parameters),
      bodyKeys: sortedKeys(input.body),
      ...(approvalRequestId === undefined ? {} : { approvalRequestId }),
      errorCode,
    },
  });
}

async function auditDispatchEnqueue(
  input: DispatchToolOperationInput,
  job: BackgroundJob,
  host: string,
  idempotency?: { keyHash: string; replayed: boolean },
): Promise<void> {
  await writeAuditLog(input.repository, {
    subject: input.subject,
    action: "tool.operation.dispatch.enqueue",
    resourceType: "tool_operation",
    resourceId: input.operation.id,
    metadata: {
      jobId: job.id,
      connectorId: input.connector.id,
      operationId: input.operation.operationId,
      method: input.operation.method,
      path: input.operation.path,
      workerQueue: "external_tool_operations",
      host,
      approvalPolicy: input.operation.approvalPolicy,
      riskLevel: input.operation.riskLevel,
      parameterKeys: sortedKeys(input.parameters),
      bodyKeys: sortedKeys(input.body),
      payloadStorage: jobPayloadStorage(job),
      ...(idempotency === undefined
        ? {}
        : {
            idempotencyKeyHash: idempotency.keyHash,
            idempotencyReplay: idempotency.replayed,
          }),
      ...(input.approvalRequestId === undefined
        ? {}
        : { approvalRequestId: input.approvalRequestId }),
    },
  });
}

async function findIdempotentDispatchRequest(
  input: EnqueueToolOperationDispatchInput,
  keyHash: string,
): Promise<BackgroundJob | undefined> {
  const match = (
    await input.repository.listBackgroundJobs(input.subject.orgId)
  ).find(
    (job) =>
      job.type === "tool.operation.dispatch_request" &&
      job.payload.idempotencyKeyHash === keyHash,
  );
  if (match === undefined) return undefined;
  if (!sameDispatchRequestShape(input, match)) {
    throw new ApiError(
      "tool_operation_dispatch_idempotency_conflict",
      "Tool operation dispatch idempotency key was already used for a different request shape.",
      409,
      {
        jobId: match.id,
      },
    );
  }
  return match;
}

function dispatchRequestResult(
  input: DispatchToolOperationInput,
  job: BackgroundJob,
  host: string,
  replayed: boolean | undefined,
): ToolOperationDispatchRequestResult {
  return {
    job: summarizeJob(job),
    connectorId: input.connector.id,
    operationId: input.operation.operationId,
    method: input.operation.method,
    pathTemplate: input.operation.path,
    workerQueue: "external_tool_operations",
    request: {
      parameterKeys: sortedKeys(input.parameters),
      bodyKeys: sortedKeys(input.body),
      host,
      payloadStorage: jobPayloadStorage(job),
    },
    approval: {
      required: input.operation.approvalPolicy !== "never",
      approvalPolicy: input.operation.approvalPolicy,
      riskLevel: input.operation.riskLevel,
      ...(typeof job.payload.approvalRequestId === "string"
        ? { approvalRequestId: job.payload.approvalRequestId }
        : {}),
    },
    ...(replayed === undefined ? {} : { idempotency: { replayed } }),
  };
}

async function storeDispatchPayload(
  input: EnqueueToolOperationDispatchInput,
): Promise<ToolOperationDispatchPayloadStoreReference | undefined> {
  if (input.dispatchPayloadStore === undefined) return undefined;
  try {
    return await input.dispatchPayloadStore.store({
      actorId: input.subject.id,
      connectorId: input.connector.id,
      operationId: input.operation.operationId,
      orgId: input.subject.orgId,
      payload: buildToolDispatchPayload(input),
    });
  } catch {
    throw new ApiError(
      "tool_dispatch_payload_store_unavailable",
      "Tool dispatch payload storage is unavailable.",
      503,
    );
  }
}

async function deleteStoredPayload(
  input: EnqueueToolOperationDispatchInput,
  reference: ToolOperationDispatchPayloadStoreReference | undefined,
): Promise<void> {
  if (input.dispatchPayloadStore === undefined || reference === undefined)
    return;
  try {
    await input.dispatchPayloadStore.delete(reference);
  } catch {
    // Terminal job state is authoritative; S3 lifecycle policy is the fallback.
  }
}

function buildToolDispatchPayload(
  input: EnqueueToolOperationDispatchInput,
): ToolDispatchPayload {
  const payload: ToolDispatchPayload = {};
  if (input.parameters !== undefined) payload.parameters = input.parameters;
  if (input.body !== undefined) payload.body = input.body;
  const auth = dispatchPayloadAuth(input.connector);
  if (auth !== undefined) payload.auth = auth;
  return payload;
}

function dispatchPayloadAuth(
  connector: ToolConnector,
): ToolDispatchPayloadAuth | undefined {
  const type =
    typeof connector.authConfig.type === "string"
      ? connector.authConfig.type
      : "none";
  if (type === "none") return undefined;
  const secretRef =
    typeof connector.authConfig.secretRef === "string"
      ? connector.authConfig.secretRef
      : undefined;
  if (secretRef === undefined) return undefined;
  if (type === "bearer") return { type, secretRef };
  if (type === "oauth2_client_credentials") return { type, secretRef };
  if (type === "api_key") {
    const placement = apiKeyAuthPlacement(connector);
    return {
      type,
      secretRef,
      apiKeyIn: placement.apiKeyIn,
      apiKeyName: placement.apiKeyName,
    };
  }
  return undefined;
}

function dispatchPayloadStorage(
  reference: ToolOperationDispatchPayloadStoreReference | undefined,
): ToolOperationDispatchPayloadStorage {
  return reference === undefined
    ? "external_worker_secret_store_required"
    : "managed_encrypted_object_store";
}

function jobPayloadStorage(
  job: BackgroundJob,
): ToolOperationDispatchPayloadStorage {
  return job.payload.payloadStorage === "managed_encrypted_object_store"
    ? "managed_encrypted_object_store"
    : "external_worker_secret_store_required";
}

function sameDispatchRequestShape(
  input: EnqueueToolOperationDispatchInput,
  job: BackgroundJob,
): boolean {
  const payload = job.payload;
  return (
    payload.actorId === input.subject.id &&
    payload.connectorId === input.connector.id &&
    payload.operationId === input.operation.operationId &&
    payload.method === input.operation.method &&
    payload.path === input.operation.path &&
    payload.workerQueue === "external_tool_operations" &&
    payload.host === dispatchBaseHost(input.connector) &&
    payload.approvalPolicy === input.operation.approvalPolicy &&
    payload.riskLevel === input.operation.riskLevel &&
    payload.runId === (input.runContext?.runId ?? payload.runId) &&
    payload.toolId === (input.runContext?.toolId ?? payload.toolId) &&
    sameStringArray(payload.parameterKeys, sortedKeys(input.parameters)) &&
    sameStringArray(payload.bodyKeys, sortedKeys(input.body))
  );
}

function dispatchRequestIdempotency(
  input: EnqueueToolOperationDispatchInput,
): { jobId: string; keyHash: string; scope: string } | undefined {
  if (input.idempotencyKey === undefined) return undefined;
  const scope = "tool.operation.dispatch_request.v1";
  const keyHash = createHash("sha256")
    .update(scope)
    .update("\0")
    .update(input.subject.orgId)
    .update("\0")
    .update(input.subject.id)
    .update("\0")
    .update(input.connector.id)
    .update("\0")
    .update(input.operation.operationId)
    .update("\0")
    .update(input.runContext?.runId ?? "")
    .update("\0")
    .update(input.runContext?.toolId ?? "")
    .update("\0")
    .update(input.idempotencyKey)
    .digest("hex");
  return {
    jobId: `job_dispatch_request_${keyHash.slice(0, 32)}`,
    keyHash,
    scope,
  };
}

function validateDispatchApprovalRequest(
  input: DispatchToolOperationInput,
  approvalRequest: BackgroundJob | undefined,
): string | undefined {
  if (
    approvalRequest === undefined ||
    approvalRequest.type !== "tool.operation.approval_request" ||
    approvalRequest.status !== "completed"
  ) {
    return "invalid_tool_operation_approval_request";
  }
  if (
    Date.now() - new Date(approvalRequest.createdAt).getTime() >
    15 * 60 * 1000
  )
    return "tool_operation_approval_request_expired";
  const payload = approvalRequest.payload;
  if (typeof payload.consumedAt === "string")
    return "invalid_tool_operation_approval_request";
  if (typeof payload.cancelledAt === "string")
    return "tool_operation_approval_request_cancelled";
  if (typeof payload.rejectedAt === "string")
    return "tool_operation_approval_request_rejected";
  if (
    payload.actorId !== input.subject.id ||
    payload.connectorId !== input.connector.id ||
    payload.operationId !== input.operation.operationId ||
    payload.method !== input.operation.method ||
    payload.path !== input.operation.path ||
    payload.approvalPolicy !== input.operation.approvalPolicy ||
    payload.riskLevel !== input.operation.riskLevel ||
    !sameStringArray(payload.parameterKeys, sortedKeys(input.parameters)) ||
    !sameStringArray(payload.bodyKeys, sortedKeys(input.body))
  ) {
    return "invalid_tool_operation_approval_request";
  }
  return undefined;
}

async function buildRequest(
  input: DispatchToolOperationInput,
): Promise<{ authInjected: boolean; init: RequestInit; url: URL }> {
  const baseUrl =
    typeof input.connector.schema.baseUrl === "string"
      ? input.connector.schema.baseUrl
      : "";
  const url = buildOperationUrl(
    baseUrl,
    input.operation,
    input.parameters ?? {},
  );
  assertHostAllowed(input.connector, url);
  const auth = await authForConnector(input);
  for (const [name, value] of Object.entries(auth.query))
    url.searchParams.set(name, value);
  const headers: Record<string, string> = {
    accept: "application/json",
    ...auth.headers,
  };
  const method = input.operation.method.toUpperCase();
  const init: RequestInit = { method, headers };
  const transport = toolOperationDispatchTransport(
    input.connector,
    input.operation,
  );
  if (!["GET", "DELETE"].includes(method) && transport !== undefined) {
    Object.assign(headers, mcpToolCallHeaders(transport));
    init.body = JSON.stringify(
      mcpToolCallBody(
        transport,
        input.body ?? input.parameters ?? {},
        "direct",
      ),
    );
  } else if (!["GET", "DELETE"].includes(method) && input.body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(input.body);
  }
  return { authInjected: auth.injected, init, url };
}

export function toolOperationDispatchTransport(
  connector: ToolConnector,
  operation: ToolOperation,
):
  | Extract<ToolOperationDispatchTransport, { protocol: "mcp_streamable_http" }>
  | undefined {
  if (connector.type !== "mcp") return undefined;
  const mcpToolName =
    typeof operation.inputSchema.mcpToolName === "string"
      ? operation.inputSchema.mcpToolName
      : operation.operationId;
  const mcpProtocolVersion =
    typeof operation.inputSchema.mcpProtocolVersion === "string"
      ? operation.inputSchema.mcpProtocolVersion
      : typeof connector.schema.mcpProtocolVersion === "string"
        ? connector.schema.mcpProtocolVersion
        : "2025-06-18";
  return {
    protocol: "mcp_streamable_http",
    requestBody: "mcp_tools_call",
    mcpToolName,
    mcpProtocolVersion,
  };
}

function mcpToolCallHeaders(
  transport: Extract<
    ToolOperationDispatchTransport,
    { protocol: "mcp_streamable_http" }
  >,
): Record<string, string> {
  return {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "MCP-Protocol-Version": transport.mcpProtocolVersion,
    "Mcp-Method": "tools/call",
    "Mcp-Name": transport.mcpToolName,
  };
}

function mcpToolCallBody(
  transport: Extract<
    ToolOperationDispatchTransport,
    { protocol: "mcp_streamable_http" }
  >,
  args: Record<string, unknown>,
  id: string,
): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id,
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

function buildOperationUrl(
  baseUrl: string,
  operation: ToolOperation,
  parameters: Record<string, unknown>,
): URL {
  const base = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const renderedPath = renderPath(operation, parameters).replace(/^\/+/u, "");
  const url = new URL(renderedPath, base);
  if (url.origin !== base.origin)
    throw new ApiError(
      "tool_operation_url_invalid",
      "Tool operation URL must stay on the connector origin.",
      409,
    );
  for (const name of declaredParameters(operation, "query")) {
    const value = parameters[name];
    if (value !== undefined && value !== null)
      url.searchParams.set(name, String(value));
  }
  return url;
}

function renderPath(
  operation: ToolOperation,
  parameters: Record<string, unknown>,
): string {
  let path = operation.path;
  for (const name of declaredParameters(operation, "path")) {
    const value = parameters[name];
    if (value === undefined || value === null || String(value).length === 0) {
      throw new ApiError(
        "tool_operation_parameter_missing",
        "Tool operation path parameter is missing.",
        400,
        { parameter: name },
      );
    }
    path = path.replace(
      new RegExp(`\\{${escapeRegExp(name)}\\}`, "gu"),
      encodeURIComponent(String(value)),
    );
  }
  return path;
}

function assertHostAllowed(connector: ToolConnector, url: URL): void {
  if (
    connector.networkPolicy.mode !== "allow_hosts" ||
    !connector.networkPolicy.allowedHosts.includes(url.hostname.toLowerCase())
  ) {
    throw new ApiError(
      "tool_operation_host_not_allowed",
      "Tool operation host is not allowed by connector network policy.",
      409,
      { host: url.hostname },
    );
  }
}

function dispatchBaseHost(connector: ToolConnector): string {
  const baseUrl =
    typeof connector.schema.baseUrl === "string"
      ? connector.schema.baseUrl
      : "";
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new ApiError(
      "tool_operation_url_invalid",
      "Tool operation base URL is invalid.",
      409,
    );
  }
  assertHostAllowed(connector, url);
  return url.hostname;
}

async function authForConnector(input: DispatchToolOperationInput): Promise<{
  headers: Record<string, string>;
  injected: boolean;
  query: Record<string, string>;
}> {
  const type =
    typeof input.connector.authConfig.type === "string"
      ? input.connector.authConfig.type
      : "none";
  if (type === "none") return { headers: {}, injected: false, query: {} };
  if (type === "oauth2_client_credentials") {
    const accessToken = await resolveOAuthClientCredentialsAccessToken({
      connector: input.connector,
      fetchImpl: input.fetchImpl,
      maxBytes: input.maxBytes,
      secretResolver: input.secretResolver,
      timeoutMs: input.timeoutMs,
    });
    return {
      headers: { authorization: `Bearer ${accessToken}` },
      injected: true,
      query: {},
    };
  }
  const secretRef =
    typeof input.connector.authConfig.secretRef === "string"
      ? input.connector.authConfig.secretRef
      : undefined;
  if (secretRef === undefined)
    throw new ApiError(
      "tool_operation_auth_not_configured",
      "Tool operation auth is not configured.",
      409,
    );
  if (input.secretResolver.resolveValue === undefined) {
    throw new ApiError(
      "secret_value_resolution_unavailable",
      "Secret value resolution is unavailable for tool operation dispatch.",
      409,
    );
  }
  const resolution = await input.secretResolver.resolveValue(secretRef);
  if (!resolution.available || resolution.value === undefined) {
    throw new ApiError(
      "tool_operation_secret_unavailable",
      "Tool operation secret is unavailable.",
      409,
      {
        failureCode: resolution.failureCode,
        scheme: resolution.scheme,
      },
    );
  }
  if (type === "bearer")
    return {
      headers: { authorization: `Bearer ${resolution.value}` },
      injected: true,
      query: {},
    };
  if (type === "api_key") {
    const placement = apiKeyAuthPlacement(input.connector);
    if (placement.apiKeyIn === "query")
      return {
        headers: {},
        injected: true,
        query: { [placement.apiKeyName]: resolution.value },
      };
    return {
      headers: { [placement.apiKeyName]: resolution.value },
      injected: true,
      query: {},
    };
  }
  throw new ApiError(
    "tool_operation_auth_scheme_unsupported",
    "Tool operation auth scheme is not supported for dispatch.",
    409,
    { type },
  );
}

function apiKeyAuthPlacement(connector: ToolConnector): {
  apiKeyIn: "header" | "query";
  apiKeyName: string;
} {
  const apiKeyIn = connector.authConfig.apiKeyIn;
  const apiKeyName = connector.authConfig.apiKeyName;
  if (
    (apiKeyIn === "header" || apiKeyIn === "query") &&
    typeof apiKeyName === "string" &&
    /^[A-Za-z0-9_.-]{1,80}$/u.test(apiKeyName)
  ) {
    return { apiKeyIn, apiKeyName };
  }
  return { apiKeyIn: "header", apiKeyName: "x-api-key" };
}

async function fetchBounded(
  fetchImpl: typeof fetch,
  url: URL,
  init: RequestInit,
  operation: ToolOperation,
  timeoutMs: number,
  maxBytes: number,
): Promise<ToolOperationDispatchResult["response"]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });
    const body = await readBodySize(response, maxBytes);
    const contentType = response.headers.get("content-type") ?? undefined;
    const schemaValidation = validateToolOperationResponse({
      body: body.bytes,
      ...(contentType === undefined ? {} : { contentType }),
      operation,
      status: response.status,
      truncated: body.truncated,
    });
    return {
      ok: response.ok,
      status: response.status,
      ...(contentType === undefined ? {} : { contentType }),
      bodyBytes: body.bodyBytes,
      truncated: body.truncated,
      schemaValidation,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError")
      throw new ApiError(
        "tool_operation_timeout",
        "Tool operation dispatch timed out.",
        504,
      );
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readBodySize(
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
      const chunk = await reader.read();
      if (chunk.done) break;
      bodyBytes += chunk.value.byteLength;
      if (bodyBytes > maxBytes) {
        truncated = true;
        const remaining = Math.max(
          0,
          maxBytes - chunks.reduce((total, item) => total + item.byteLength, 0),
        );
        if (remaining > 0) chunks.push(chunk.value.slice(0, remaining));
        bodyBytes = maxBytes;
        await reader.cancel();
        break;
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  return { bodyBytes, bytes: concatBytes(chunks), truncated };
}

async function auditDispatch(
  input: DispatchToolOperationInput,
  job: BackgroundJob,
  request: { authInjected: boolean; url: URL },
  response: ToolOperationDispatchResult["response"],
  outcome: "failure" | "success",
): Promise<void> {
  await writeAuditLog(input.repository, {
    subject: input.subject,
    action: "tool.operation.dispatch",
    resourceType: "tool_operation",
    resourceId: input.operation.id,
    outcome,
    metadata: {
      jobId: job.id,
      connectorId: input.connector.id,
      operationId: input.operation.operationId,
      method: input.operation.method,
      path: input.operation.path,
      parameterKeys: sortedKeys(input.parameters),
      bodyKeys: sortedKeys(input.body),
      ...(input.approvalRequestId === undefined
        ? {}
        : { approvalRequestId: input.approvalRequestId }),
      host: request.url.hostname,
      authInjected: request.authInjected,
      responseStatus: response.status,
      responseOk: response.ok,
      responseBodyBytes: response.bodyBytes,
      responseTruncated: response.truncated,
      responseSchemaValidation: response.schemaValidation,
    },
  });
}

async function auditDispatchFailure(
  input: DispatchToolOperationInput,
  job: BackgroundJob,
  errorCode: string,
): Promise<void> {
  await writeAuditLog(input.repository, {
    subject: input.subject,
    action: "tool.operation.dispatch",
    resourceType: "tool_operation",
    resourceId: input.operation.id,
    outcome: "failure",
    metadata: {
      jobId: job.id,
      connectorId: input.connector.id,
      operationId: input.operation.operationId,
      method: input.operation.method,
      path: input.operation.path,
      parameterKeys: sortedKeys(input.parameters),
      bodyKeys: sortedKeys(input.body),
      ...(input.approvalRequestId === undefined
        ? {}
        : { approvalRequestId: input.approvalRequestId }),
      errorCode,
    },
  });
}

function dispatchErrorCode(error: unknown): string {
  if (error instanceof ApiError) return error.code;
  return "tool_operation_dispatch_failed";
}

function summarizeJob(job: BackgroundJob): ToolOperationDispatchResult["job"] {
  return { id: job.id, type: job.type, status: job.status };
}

function declaredParameters(
  operation: ToolOperation,
  location: string,
): string[] {
  const parameters = Array.isArray(operation.inputSchema.parameters)
    ? operation.inputSchema.parameters
    : [];
  return parameters
    .filter(
      (parameter) =>
        isRecord(parameter) &&
        parameter.in === location &&
        typeof parameter.name === "string",
    )
    .map((parameter) => (parameter as { name: string }).name)
    .sort();
}

function sortedKeys(value: Record<string, unknown> | undefined): string[] {
  return value === undefined ? [] : Object.keys(value).sort();
}

function sameStringArray(value: unknown, expected: string[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((item, index) => item === expected[index])
  );
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
