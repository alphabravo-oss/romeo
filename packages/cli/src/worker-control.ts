export function workerSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}
