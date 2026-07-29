const maximumQueryRetries = 3;
const retryableHttpStatuses = new Set([408, 425, 429]);

/**
 * TanStack Query retry policy shared by every browser query.
 *
 * Permanent client failures are returned to the panel immediately. Network,
 * throttling, and server failures get a bounded retry window. The extractor is
 * intentionally structural because generated clients and browser fetch errors
 * do not share one concrete error class.
 */
export function shouldRetryQuery(
  failureCount: number,
  error: unknown,
): boolean {
  if (failureCount >= maximumQueryRetries || isAbortError(error)) return false;
  const status = errorStatus(error);
  if (status === undefined) return true;
  if (retryableHttpStatuses.has(status)) return true;
  if (status >= 500 && status <= 599) return true;
  return status < 400;
}

export function queryRetryDelay(attemptIndex: number): number {
  const safeAttempt = Math.max(0, Math.floor(attemptIndex));
  return Math.min(1_000 * 2 ** safeAttempt, 30_000);
}

export function errorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const record = error as Record<string, unknown>;
  for (const key of ["status", "statusCode"]) {
    const status = record[key];
    if (typeof status === "number" && Number.isInteger(status)) return status;
  }
  const response = record.response;
  if (typeof response === "object" && response !== null) {
    const status = (response as Record<string, unknown>).status;
    if (typeof status === "number" && Number.isInteger(status)) return status;
  }
  return record.cause === error ? undefined : errorStatus(record.cause);
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}
