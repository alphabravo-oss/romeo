import { useEffect, useState } from "react";

export function scheduleDebounced<T>(
  value: T,
  delayMs: number,
  commit: (value: T) => void,
): () => void {
  const timer = globalThis.setTimeout(
    () => commit(value),
    Math.max(0, delayMs),
  );
  return () => globalThis.clearTimeout(timer);
}

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [committed, setCommitted] = useState(value);
  useEffect(
    () => scheduleDebounced(value, delayMs, setCommitted),
    [delayMs, value],
  );
  return committed;
}
