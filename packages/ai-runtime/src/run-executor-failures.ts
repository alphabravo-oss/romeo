import type { ProviderTokenUsage } from "@romeo/providers";

import type { ProviderCircuitBreakerSnapshot } from "./provider-circuit-breaker";
import { providerToolCallRequestedData } from "./run-executor-chunks";
import type { ProviderFallbackSnapshot } from "./run-executor-types";
import type { ProviderUsageSegment } from "./provider-usage-tracker";

export function providerFailureData(
  error: unknown,
  metadata: {
    circuit?: ProviderCircuitBreakerSnapshot | undefined;
    fallback?: ProviderFallbackSnapshot | undefined;
    retryAttempts?: number | undefined;
    usage?: ProviderTokenUsage | undefined;
    usageSegments?: ProviderUsageSegment[] | undefined;
  } = {},
): {
  errorCode: string;
  errorType?: string;
  providerCircuit?: ProviderCircuitBreakerSnapshot;
  providerFallback?: ProviderFallbackSnapshot;
  retryAttempts?: number;
  usage?: ProviderTokenUsage;
  usageSegments?: ProviderUsageSegment[];
} {
  const result: {
    errorCode: string;
    errorType?: string;
    providerCircuit?: ProviderCircuitBreakerSnapshot;
    providerFallback?: ProviderFallbackSnapshot;
    retryAttempts?: number;
    usage?: ProviderTokenUsage;
    usageSegments?: ProviderUsageSegment[];
  } = isProviderFailureRecord(error)
    ? {
        errorCode: error.errorCode,
        ...(typeof error.errorType === "string"
          ? { errorType: error.errorType }
          : {}),
      }
    : error instanceof Error && error.name === "AbortError"
      ? { errorCode: "provider_stream_aborted", errorType: "AbortError" }
      : { errorCode: "provider_stream_error" };
  if (metadata.retryAttempts !== undefined && metadata.retryAttempts > 0)
    result.retryAttempts = metadata.retryAttempts;
  if (metadata.circuit !== undefined && metadata.circuit.state !== "closed")
    result.providerCircuit = metadata.circuit;
  if (metadata.fallback !== undefined)
    result.providerFallback = metadata.fallback;
  if (metadata.usage !== undefined) result.usage = metadata.usage;
  if (metadata.usageSegments !== undefined)
    result.usageSegments = metadata.usageSegments;
  return result;
}

export function modelToolExecutionFailureData(
  error: unknown,
  toolCall: ReturnType<typeof providerToolCallRequestedData>,
): {
  approvalRequestId?: string;
  errorCode: string;
  providerCallIdHash: string;
  toolName: string;
} {
  const approvalRequestId = approvalRequestIdField(error);
  return {
    ...(approvalRequestId === undefined ? {} : { approvalRequestId }),
    errorCode: modelToolExecutionErrorCode(error),
    providerCallIdHash: toolCall.providerCallIdHash,
    toolName: toolCall.name,
  };
}

export function completionData(
  usage: ProviderTokenUsage | undefined,
  retryAttempts: number,
  fallback: ProviderFallbackSnapshot | undefined,
  usageSegments?: ProviderUsageSegment[],
): Record<string, unknown> {
  return {
    ...(usage === undefined ? {} : { usage }),
    ...(usageSegments === undefined ? {} : { usageSegments }),
    ...(fallback === undefined ? {} : { providerFallback: fallback }),
    ...(retryAttempts > 0 ? { providerRetryAttempts: retryAttempts } : {}),
  };
}

function modelToolExecutionErrorCode(error: unknown): string {
  const code = errorCodeField(error);
  return code === undefined || !knownModelToolErrorCodes.has(code)
    ? "model_tool_execution_failed"
    : code;
}

function errorCodeField(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const record = error as { code?: unknown; errorCode?: unknown };
  if (typeof record.errorCode === "string") return record.errorCode;
  if (typeof record.code === "string") return record.code;
  return undefined;
}

function approvalRequestIdField(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const details = (error as { details?: unknown }).details;
  if (typeof details !== "object" || details === null) return undefined;
  const approvalRequestId = (details as { approvalRequestId?: unknown })
    .approvalRequestId;
  return typeof approvalRequestId === "string" &&
    approvalRequestId.length > 0 &&
    approvalRequestId.length <= 200
    ? approvalRequestId
    : undefined;
}

function isProviderFailureRecord(
  value: unknown,
): value is { errorCode: string; errorType?: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    "errorCode" in value &&
    typeof value.errorCode === "string"
  );
}

const knownModelToolErrorCodes = new Set([
  "invalid_request",
  "invalid_tool_approval_request",
  "not_found",
  "tool_approval_request_expired",
  "tool_approval_request_required",
  "tool_approval_required",
  "tool_execution_error",
  "tool_execution_replayed",
  "tool_not_bound",
]);
