import type {
  BackgroundJob,
  ToolOperationDispatchPayloadStorage,
  ToolOperationDispatchPayloadStoreReference,
  ToolOperationDispatchRequestClaimResult,
  ToolOperationDispatchTransport,
} from "../domain/entities";
import { ApiError } from "../errors";
import {
  isToolDispatchPayloadStoreReference,
  type ToolDispatchPayloadStore,
} from "./tool-dispatch-payload-store";
import { reportCleanupFailure } from "./telemetry-context";

export function validateDispatchRequestPayload(job: BackgroundJob): void {
  payloadString(job, "connectorId");
  payloadString(job, "operationId");
  payloadString(job, "method");
  payloadString(job, "path");
  payloadString(job, "host");
  payloadStringArray(job, "parameterKeys");
  payloadStringArray(job, "bodyKeys");
  jobPayloadStorage(job);
  jobPayloadStoreReference(job);
  jobTransport(job);
}

export function jobTransport(
  job: BackgroundJob,
): ToolOperationDispatchTransport | undefined {
  const value = job.payload.transport;
  if (value === undefined) return undefined;
  const transport = asRecord(value);
  if (transport === undefined) {
    throw new ApiError(
      "tool_operation_dispatch_request_invalid",
      "Tool operation dispatch request metadata is invalid.",
      409,
      { key: "transport" },
    );
  }
  if (
    transport.protocol === "mcp_streamable_http" &&
    transport.requestBody === "mcp_tools_call" &&
    typeof transport.mcpToolName === "string" &&
    /^[A-Za-z0-9_.:/-]{1,120}$/u.test(transport.mcpToolName) &&
    typeof transport.mcpProtocolVersion === "string" &&
    /^\d{4}-\d{2}-\d{2}$/u.test(transport.mcpProtocolVersion)
  ) {
    return {
      protocol: "mcp_streamable_http",
      requestBody: "mcp_tools_call",
      mcpToolName: transport.mcpToolName,
      mcpProtocolVersion: transport.mcpProtocolVersion,
    };
  }
  if (transport.protocol === "http" && transport.requestBody === "raw_json") {
    return { protocol: "http", requestBody: "raw_json" };
  }
  throw new ApiError(
    "tool_operation_dispatch_request_invalid",
    "Tool operation dispatch request metadata is invalid.",
    409,
    { key: "transport" },
  );
}

export function jobPayloadStorage(
  job: BackgroundJob,
): ToolOperationDispatchPayloadStorage {
  const value = job.payload.payloadStorage;
  if (value === undefined) return "external_worker_secret_store_required";
  if (
    value === "external_worker_secret_store_required" ||
    value === "managed_encrypted_object_store"
  ) {
    return value;
  }
  throw new ApiError(
    "tool_operation_dispatch_request_invalid",
    "Tool operation dispatch request metadata is invalid.",
    409,
    { key: "payloadStorage" },
  );
}

export function jobPayloadStoreReference(
  job: BackgroundJob,
): ToolOperationDispatchPayloadStoreReference | undefined {
  if (jobPayloadStorage(job) !== "managed_encrypted_object_store")
    return undefined;
  const value = job.payload.payloadStore;
  if (isToolDispatchPayloadStoreReference(value)) return value;
  throw new ApiError(
    "tool_operation_dispatch_request_invalid",
    "Tool operation dispatch request metadata is invalid.",
    409,
    { key: "payloadStore" },
  );
}

export async function deleteDispatchPayloadObject(
  payloadStore: ToolDispatchPayloadStore | undefined,
  reference: ToolOperationDispatchPayloadStoreReference | undefined,
): Promise<void> {
  if (payloadStore === undefined || reference === undefined) return;
  try {
    await payloadStore.delete(reference);
  } catch {
    reportCleanupFailure("tool_dispatch.delete_request_payload");
    // Encrypted payload buckets should also have lifecycle expiry configured.
  }
}

export async function readDispatchPayloadObject(
  payloadStore: ToolDispatchPayloadStore,
  reference: ToolOperationDispatchPayloadStoreReference,
) {
  try {
    const stored = await payloadStore.read(reference);
    if (stored !== undefined) return stored;
  } catch {
    throw new ApiError(
      "tool_operation_dispatch_payload_unavailable",
      "Tool operation dispatch payload is unavailable.",
      409,
    );
  }
  throw new ApiError(
    "tool_operation_dispatch_payload_unavailable",
    "Tool operation dispatch payload is unavailable.",
    409,
  );
}

export function assertPayloadMatchesClaim(
  job: BackgroundJob,
  stored: {
    connectorId: string;
    operationId: string;
    orgId: string;
  },
): void {
  if (
    stored.orgId === job.orgId &&
    stored.connectorId === payloadString(job, "connectorId") &&
    stored.operationId === payloadString(job, "operationId")
  ) {
    return;
  }
  throw new ApiError(
    "tool_operation_dispatch_payload_invalid",
    "Tool operation dispatch payload metadata does not match the claimed job.",
    409,
  );
}

export function payloadString(job: BackgroundJob, key: string): string {
  const value = job.payload[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new ApiError(
      "tool_operation_dispatch_request_invalid",
      "Tool operation dispatch request metadata is invalid.",
      409,
      { key },
    );
  }
  return value;
}

export function payloadStringArray(job: BackgroundJob, key: string): string[] {
  const value = job.payload[key];
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    throw new ApiError(
      "tool_operation_dispatch_request_invalid",
      "Tool operation dispatch request metadata is invalid.",
      409,
      { key },
    );
  }
  return value;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function readWorkerLease(
  job: BackgroundJob,
): ToolOperationDispatchRequestClaimResult["lease"] | undefined {
  const value = job.payload.workerLease;
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const lease = value as ToolOperationDispatchRequestClaimResult["lease"];
  if (
    lease === undefined ||
    typeof lease.workerId !== "string" ||
    typeof lease.claimedAt !== "string" ||
    typeof lease.renewedAt !== "string" ||
    typeof lease.expiresAt !== "string" ||
    typeof lease.leaseSeconds !== "number" ||
    typeof lease.attempt !== "number"
  ) {
    return undefined;
  }
  return lease;
}
