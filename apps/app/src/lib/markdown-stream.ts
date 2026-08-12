/**
 * How many characters of a streaming answer may be shown on the next frame.
 *
 * ChatGPT-like default: paint every byte that has already arrived. Provider
 * cadence is the only source of chunkiness — we do not hold a typewriter lag
 * behind the cache. A future "smooth typewriter" mode can restore proportional
 * drain here without touching the run registry.
 */
export function nextDrainLength(rendered: number, target: number): number {
  // Shorter content is replaced content, not arrears: switching to a sibling
  // variant or retrying a turn must show the new text immediately.
  if (target <= rendered) return target;
  return target;
}

/**
 * Advances `render` once per animation frame until the returned stop is called.
 *
 * With instant `nextDrainLength`, a single frame settles any backlog. The loop
 * still coalesces multi-delta frames when callers use it; the Markdown path
 * paints cache content directly and does not need this.
 */
export function drainFrames(
  length: () => number,
  render: (step: (rendered: number) => number) => void,
): () => void {
  let frame = 0;
  const tick = () => {
    render((rendered) => nextDrainLength(rendered, length()));
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}
