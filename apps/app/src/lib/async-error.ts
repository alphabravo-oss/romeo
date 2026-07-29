interface AsyncErrorDedupeState {
  seenAt: Map<string, number>;
}

export function createAsyncErrorDedupeState(): AsyncErrorDedupeState {
  return { seenAt: new Map() };
}

export function shouldReportAsyncError(
  state: AsyncErrorDedupeState,
  reason: unknown,
  now = Date.now(),
  windowMs = 5_000,
): boolean {
  if (isAbortError(reason)) return false;
  for (const [key, seenAt] of state.seenAt) {
    if (now - seenAt > windowMs) state.seenAt.delete(key);
  }
  const key = asyncErrorFingerprint(reason);
  const previous = state.seenAt.get(key);
  if (previous !== undefined && now - previous <= windowMs) return false;
  state.seenAt.set(key, now);
  return true;
}

/**
 * Metadata-only fingerprint. Error messages and response bodies may contain
 * credentials or provider output, so neither is retained or displayed.
 */
export function asyncErrorFingerprint(reason: unknown): string {
  if (typeof reason !== "object" || reason === null) {
    return `${typeof reason}:${String(reason).length}`;
  }
  const value = reason as Record<string, unknown>;
  const name = typeof value.name === "string" ? value.name : "Object";
  const status =
    typeof value.status === "number"
      ? value.status
      : typeof value.statusCode === "number"
        ? value.statusCode
        : "unknown";
  const code = typeof value.code === "string" ? value.code : "unknown";
  return `${name}:${status}:${code}`;
}

function isAbortError(reason: unknown): boolean {
  return (
    typeof reason === "object" &&
    reason !== null &&
    "name" in reason &&
    reason.name === "AbortError"
  );
}
