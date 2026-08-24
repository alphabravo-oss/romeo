import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * Keeps callback identity stable while dispatching to the implementation from
 * the latest committed render. This is safe for memoized table definitions:
 * browser events cannot observe a speculative or abandoned render.
 */
export function useEventCallback<Arguments extends unknown[], Result>(
  callback: (...arguments_: Arguments) => Result,
): (...arguments_: Arguments) => Result {
  const callbackRef = useRef(callback);
  useLayoutEffect(() => {
    callbackRef.current = callback;
  }, [callback]);
  return useCallback(
    (...arguments_: Arguments) => callbackRef.current(...arguments_),
    [],
  );
}
