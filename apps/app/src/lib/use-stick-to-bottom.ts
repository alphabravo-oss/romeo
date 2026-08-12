import { useCallback, useEffect, useRef, useState } from "react";

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
export function useStickToBottom(
  dep: unknown,
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled !== false;
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  // The same intent, published for rendering. It stays a *second* copy rather
  // than replacing the ref: the ref is read from a rAF callback once per token
  // and must never schedule a render, while the jump-to-latest button has to
  // appear the moment the reader stops following. React bails out on an equal
  // value, so the setState below is free for every scroll event but the two
  // that cross the threshold.
  const [atBottom, setAtBottom] = useState(true);

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
      setAtBottom(stick.current);
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => node.removeEventListener("scroll", onScroll);
  }, [dep]);

  // Deferred to the next frame rather than written inline: reading
  // scrollHeight and assigning scrollTop forces a synchronous layout, and a
  // streaming answer changes `dep` once per token. Cancelling the pending
  // handle collapses a whole frame's worth of deltas into one layout.
  useEffect(() => {
    const node = ref.current;
    if (node === null || !enabled || !stick.current) return;
    const handle = requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight;
    });
    return () => cancelAnimationFrame(handle);
  }, [dep, enabled]);

  // Jumps rather than animates: the button exists to rejoin an answer that is
  // still being written, and a smooth scroll would spend its whole duration
  // racing the next token's own jump to the bottom. Nothing here to gate on
  // prefers-reduced-motion, because nothing here moves over time.
  const scrollToBottom = useCallback(() => {
    const node = ref.current;
    if (node === null) return;
    stick.current = true;
    setAtBottom(true);
    node.scrollTop = node.scrollHeight;
  }, []);

  return { atBottom, ref, scrollToBottom };
}
