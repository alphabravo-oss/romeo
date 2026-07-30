import { scopeValues, type AuthSubject, type Scope } from "@romeo/auth";
import type { ObjectStore } from "@romeo/storage";

import type {
  BackgroundJob,
  RunRecord,
  ToolOperationDispatchPayloadStoreReference,
  ToolOperationDispatchReadbackResponse,
} from "../domain/entities";
import { isToolDispatchPayloadStoreReference } from "./tool-dispatch-payload-store";
import type { ToolDispatchPayloadStore } from "./tool-dispatch-payload-store";
import { reportCleanupFailure } from "./telemetry-context";

export type DispatchPayloadStorage =
  | "external_worker_secret_store_required"
  | "managed_encrypted_object_store";

export interface RunToolDispatchWait {
  bodyKeys?: string[];
  connectorId: string;
  jobId: string;
  operationId: string;
  parameterKeys?: string[];
  payloadStorage?: DispatchPayloadStorage;
  workerQueue: "external_tool_operations";
}

export interface DispatchRunContext {
  agentId: string;
  runId: string;
  toolId: string;
  workspaceId: string;
}

export function dispatchRunContext(
  job: BackgroundJob,
): DispatchRunContext | undefined {
  if (job.payload.runContinuation !== "model_tool_dispatch") return undefined;
  const runId = optionalPayloadString(job, "runId");
  const workspaceId = optionalPayloadString(job, "workspaceId");
  const agentId = optionalPayloadString(job, "agentId");
  const toolId = optionalPayloadString(job, "toolId");
  return runId === undefined ||
    workspaceId === undefined ||
    agentId === undefined ||
    toolId === undefined
    ? undefined
    : { agentId, runId, toolId, workspaceId };
}

export function dispatchWaitEventData(
  job: BackgroundJob,
  dispatch: RunToolDispatchWait,
  toolId: string,
): Record<string, unknown> {
  return {
    connectorId: dispatch.connectorId,
    errorCode: "tool_operation_dispatch_queued",
    jobId: dispatch.jobId,
    operationId: dispatch.operationId,
    toolName: toolId,
    workerQueue: dispatch.workerQueue,
    parameterKeys: payloadStringArray(job, "parameterKeys"),
    bodyKeys: payloadStringArray(job, "bodyKeys"),
    payloadStorage: dispatchPayloadStorage(job),
  };
}

export function subjectFromDispatchJob(
  job: BackgroundJob,
  run: RunRecord,
): AuthSubject {
  const type =
    job.payload.runSubjectType === "service_account"
      ? "service_account"
      : "user";
  return {
    id: payloadString(job, "actorId"),
    type,
    orgId: run.orgId,
    workspaceIds: payloadStringArray(job, "runSubjectWorkspaceIds", [
      run.workspaceId,
    ]),
    groupIds: payloadStringArray(job, "runSubjectGroupIds", []),
    scopes: payloadScopes(job, "runSubjectScopes"),
    isAdmin: job.payload.runSubjectIsAdmin === true,
  };
}

export function dispatchContinuationArguments(
  job: BackgroundJob,
): Record<string, unknown> {
  return {
    parameterKeys: payloadStringArray(job, "parameterKeys"),
    bodyKeys: payloadStringArray(job, "bodyKeys"),
  };
}

export function dispatchReadbackToolResult(
  job: BackgroundJob,
  result: {
    errorCode?: string;
    response?: ToolOperationDispatchReadbackResponse;
  },
): Record<string, unknown> {
  return {
    dispatch:
      result.response === undefined && result.errorCode !== undefined
        ? "failed"
        : "completed",
    jobId: job.id,
    connectorId: payloadString(job, "connectorId"),
    operationId: payloadString(job, "operationId"),
    method: payloadString(job, "method"),
    pathTemplate: payloadString(job, "path"),
    workerQueue: "external_tool_operations",
    request: {
      parameterKeys: payloadStringArray(job, "parameterKeys"),
      bodyKeys: payloadStringArray(job, "bodyKeys"),
      host: payloadString(job, "host"),
      payloadStorage: dispatchPayloadStorage(job),
    },
    ...(result.response === undefined ? {} : { response: result.response }),
    ...(result.errorCode === undefined ? {} : { errorCode: result.errorCode }),
  };
}

export function modelToolExecutionResult(output: unknown): {
  content: string;
  suspend?: { type: "tool_dispatch" } & RunToolDispatchWait;
} {
  const dispatchWait = dispatchWaitFromToolOutput(output);
  return {
    content: boundedModelToolResultContent(output),
    ...(dispatchWait === undefined
      ? {}
      : { suspend: { type: "tool_dispatch", ...dispatchWait } }),
  };
}

export function dispatchWaitFromToolOutput(
  output: unknown,
): RunToolDispatchWait | undefined {
  if (typeof output !== "object" || output === null || Array.isArray(output))
    return undefined;
  const record = output as Record<string, unknown>;
  return record.dispatch === "queued" &&
    typeof record.jobId === "string" &&
    typeof record.connectorId === "string" &&
    typeof record.operationId === "string" &&
    record.workerQueue === "external_tool_operations"
    ? {
        connectorId: record.connectorId,
        jobId: record.jobId,
        operationId: record.operationId,
        ...dispatchRequestKeys(record),
        workerQueue: "external_tool_operations",
      }
    : undefined;
}

export function dispatchPayloadStoreReference(
  job: BackgroundJob,
): ToolOperationDispatchPayloadStoreReference | undefined {
  if (job.payload.payloadStorage !== "managed_encrypted_object_store")
    return undefined;
  return isToolDispatchPayloadStoreReference(job.payload.payloadStore)
    ? job.payload.payloadStore
    : undefined;
}

export async function deleteDispatchPayloadObjects(
  payloadStore: ToolDispatchPayloadStore | undefined,
  references: ToolOperationDispatchPayloadStoreReference[],
): Promise<void> {
  if (payloadStore === undefined || references.length === 0) return;
  await Promise.all(
    references.map(async (reference) => {
      try {
        await payloadStore.delete(reference);
      } catch {
        reportCleanupFailure("run_tool.delete_dispatch_payload");
        // Object-store lifecycle expiry is the fallback for cleanup failures.
      }
    }),
  );
}

export async function deleteObjectKeys(
  objectStore: ObjectStore,
  keys: string[],
): Promise<void> {
  if (keys.length === 0) return;
  await Promise.all(
    [...new Set(keys)].map(async (key) => {
      try {
        await objectStore.deleteObject(key);
      } catch {
        reportCleanupFailure("run_tool.delete_object");
        // Object-store lifecycle expiry is the fallback for cleanup failures.
      }
    }),
  );
}

export function boundedModelToolResultContent(output: unknown): string {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(output);
  } catch {
    serialized = JSON.stringify({ error: "tool_result_unserializable" });
  }
  const content = serialized ?? "null";
  return content.length <= 8_000 ? content : `${content.slice(0, 8_000)}...`;
}

export function payloadString(job: BackgroundJob, key: string): string {
  const value = job.payload[key];
  return typeof value === "string" && value.length > 0 ? value : "";
}

function optionalPayloadString(
  job: BackgroundJob,
  key: string,
): string | undefined {
  const value = payloadString(job, key);
  return value.length === 0 ? undefined : value;
}

function payloadStringArray(
  job: BackgroundJob,
  key: string,
  fallback: string[] = [],
): string[] {
  const value = job.payload[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? [...value]
    : fallback;
}

function payloadScopes(job: BackgroundJob, key: string): Scope[] {
  const allowed = new Set<string>(scopeValues);
  return payloadStringArray(job, key).filter((item): item is Scope =>
    allowed.has(item),
  );
}

function dispatchRequestKeys(record: Record<string, unknown>): {
  bodyKeys?: string[];
  parameterKeys?: string[];
  payloadStorage?: DispatchPayloadStorage;
} {
  const request =
    typeof record.request === "object" &&
    record.request !== null &&
    !Array.isArray(record.request)
      ? (record.request as Record<string, unknown>)
      : {};
  const parameterKeys = stringArrayValue(request.parameterKeys);
  const bodyKeys = stringArrayValue(request.bodyKeys);
  return {
    ...(parameterKeys === undefined ? {} : { parameterKeys }),
    ...(bodyKeys === undefined ? {} : { bodyKeys }),
    ...(request.payloadStorage === "external_worker_secret_store_required" ||
    request.payloadStorage === "managed_encrypted_object_store"
      ? { payloadStorage: request.payloadStorage }
      : {}),
  };
}

function stringArrayValue(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

function dispatchPayloadStorage(job: BackgroundJob): DispatchPayloadStorage {
  return job.payload.payloadStorage === "managed_encrypted_object_store"
    ? "managed_encrypted_object_store"
    : "external_worker_secret_store_required";
}

export function objectFromToolInput(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}
