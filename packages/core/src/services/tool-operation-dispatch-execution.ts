import type {
  BackgroundJob,
  ToolOperation,
  ToolOperationDispatchResult,
} from "../domain/entities";
import { ApiError } from "../errors";
import { writeAuditLog } from "./audit-log";
import type { DispatchToolOperationInput } from "./tool-operation-dispatch-types";
import { validateToolOperationResponse } from "./tool-response-validation";

export async function fetchBounded(
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

export async function auditDispatch(
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

export async function auditDispatchFailure(
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

export function dispatchErrorCode(error: unknown): string {
  if (error instanceof ApiError) return error.code;
  return "tool_operation_dispatch_failed";
}

export function summarizeJob(
  job: BackgroundJob,
): ToolOperationDispatchResult["job"] {
  return { id: job.id, type: job.type, status: job.status };
}

export function declaredParameters(
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

export function sortedKeys(
  value: Record<string, unknown> | undefined,
): string[] {
  return value === undefined ? [] : Object.keys(value).sort();
}

export function sameStringArray(value: unknown, expected: string[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((item, index) => item === expected[index])
  );
}

export function concatBytes(chunks: Uint8Array[]): Uint8Array {
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
