/**
 * AbortSignal.throwIfAborted() throws the signal's raw reason. Some router
 * integrations abort with an explicit `undefined`, which would escape React
 * as an unclassifiable thrown value. Normalize every aborted request to a
 * real AbortError so routers and query clients can discard it safely.
 */
export function throwIfSignalAborted(
  signal: Pick<AbortSignal, "aborted" | "reason"> | undefined,
): void {
  if (signal?.aborted !== true) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException("The operation was aborted.", "AbortError");
}
