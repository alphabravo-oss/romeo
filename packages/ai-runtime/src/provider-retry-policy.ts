import { ProviderStreamAborted } from "./provider-stream-runtime";
import type { ProviderRetryPolicy } from "./run-executor-types";

const retryableProviderFailureCodes = new Set([
  "provider_quota_exceeded",
  "provider_rate_limited",
  "provider_stream_error",
  "provider_timeout",
  "provider_unavailable",
  "provider_unexpected_failure",
]);

// Request-payload rejections are not provider-health signals. Authentication,
// quota, transport, and server failures still count against provider health.
const clientPayloadErrorTypes = new Set([
  "cancelled",
  "http_400",
  "http_413",
  "http_422",
  "invalid_request_or_capability",
  "policy",
]);

export function normalizeProviderRetryPolicy(
  input: Partial<ProviderRetryPolicy> | undefined,
): ProviderRetryPolicy {
  return {
    maxRetries: nonNegativeInteger(input?.maxRetries),
    backoffMs: nonNegativeInteger(input?.backoffMs),
  };
}

export function isRetryableProviderFailure(errorCode: string): boolean {
  return retryableProviderFailureCodes.has(errorCode);
}

export function countsAgainstProviderHealth(
  errorType: string | undefined,
): boolean {
  return errorType === undefined || !clientPayloadErrorTypes.has(errorType);
}

export function retryDelay(
  ms: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (signal?.aborted === true)
    return Promise.reject(new ProviderStreamAborted());
  if (ms <= 0) return Promise.resolve();
  let abort: (() => void) | undefined;
  const delay = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    abort = () => {
      clearTimeout(timeout);
      reject(new ProviderStreamAborted());
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
  return delay.finally(() => {
    if (abort !== undefined) signal?.removeEventListener("abort", abort);
  });
}

function nonNegativeInteger(value: unknown): number {
  return Number.isInteger(value) && typeof value === "number" && value > 0
    ? value
    : 0;
}
