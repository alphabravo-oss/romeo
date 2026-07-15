import { useEffect, useRef } from "react";

// Slack in px. A user within this distance of the bottom is "following" the
// stream and wants to keep following; beyond it they are reading history and
// must not be yanked away mid-sentence.
const STICK_THRESHOLD_PX = 64;

export function shouldStickToBottom(metrics: {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}): boolean {
  const distanceFromBottom =
    metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight;
  return distanceFromBottom <= STICK_THRESHOLD_PX;
}

// ponytail: no IntersectionObserver, no scroll library. CSS alone can't do this
// - overflow-anchor holds existing content in place but doesn't follow appended
// content, and column-reverse breaks selection order. This is the minimum that
// follows the stream without fighting a user who scrolled up.
export function useStickToBottom(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // Record intent on every user scroll, before the next append changes metrics.
  //
  // Depends on `dep`, not `[]`: the scroll container doesn't exist yet on the
  // first render (the chat starts empty, and messages hydrate asynchronously),
  // so `ref.current` is null the first time this effect would otherwise run
  // once-and-only-once. Re-running on every `dep` change guarantees at least
  // one run lands after the container has actually mounted.
  useEffect(() => {
    const node = ref.current;
    if (node === null) return;
    const onScroll = () => {
      stick.current = shouldStickToBottom(node);
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => node.removeEventListener("scroll", onScroll);
  }, [dep]);

  useEffect(() => {
    const node = ref.current;
    if (node === null || !stick.current) return;
    node.scrollTop = node.scrollHeight;
  }, [dep]);

  return ref;
}
