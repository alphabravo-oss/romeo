export interface CancellableQuery<TResult> extends PromiseLike<TResult> {
  cancel(): void;
}

/**
 * Bridges an AbortSignal to postgres.js' protocol-level query cancellation.
 * The signal is checked before execution and again after resolution so an
 * aborted request never consumes a late result even if cancellation races the
 * server response.
 */
export async function awaitCancellableQuery<TResult>(
  query: CancellableQuery<TResult>,
  signal?: AbortSignal,
): Promise<TResult> {
  if (signal === undefined) return await query;
  signal.throwIfAborted();

  const cancel = () => query.cancel();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (signal.aborted) cancel();
    const result = await query;
    signal.throwIfAborted();
    return result;
  } catch (error) {
    if (signal.aborted) signal.throwIfAborted();
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}
