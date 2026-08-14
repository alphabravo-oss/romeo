import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

const useCommitEffect =
  typeof document === "undefined" ? useEffect : useLayoutEffect;

/**
 * Exposes only the value from the latest committed render.
 *
 * Mutating a shared ref during render can leak data from work React later
 * suspends or abandons. The layout-phase handoff keeps stable event handlers
 * current without making an uncommitted controller observable.
 */
export function useCommittedLatest<T>(value: T): RefObject<T> {
  const latest = useRef(value);
  useCommitEffect(() => {
    latest.current = value;
  }, [value]);
  return latest;
}
