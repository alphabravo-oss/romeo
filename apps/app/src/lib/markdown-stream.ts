/**
 * How many characters of a streaming answer may be shown on the next frame.
 *
 * Providers emit in bursts -- a whole sentence, then nothing for 300ms -- and
 * painting each burst whole reads as stuttering rather than typing. Draining a
 * share of the backlog per frame turns the same bytes into steady prose without
 * buffering: the withheld remainder is only ever what has not been painted yet,
 * never text the caller has to hold back.
 *
 * Proportional (an eighth of the backlog) rather than a fixed rate, so a large
 * arrears -- a reconnect replaying from sequence 0, a slow tab catching up --
 * converges in a handful of frames instead of minutes. The floor of three keeps
 * the tail from crawling one character at a time.
 */
export function nextDrainLength(rendered: number, target: number): number {
  // Shorter content is replaced content, not arrears: switching to a sibling
  // variant or retrying a turn must show the new text immediately.
  if (target <= rendered) return target;
  return Math.min(
    target,
    rendered + Math.max(3, Math.ceil((target - rendered) / 8)),
  );
}

/**
 * Advances `render` once per animation frame until the returned stop is called.
 *
 * The loop reschedules itself and reads the arriving text back through
 * `length`, so a delta can land without touching it. That is the whole design:
 * scheduling the frame from the code that observed a delta instead meant the
 * next delta cancelled it, so the text advanced only across a window no chunk
 * interrupted -- and the faster the provider, the fewer of those there are. An
 * answer heavy enough to re-render more slowly than the gap between its own
 * chunks was left with no such window at all and stopped advancing entirely,
 * which made the smoothing worst for exactly the streams it exists to smooth.
 *
 * A frame that would not move the text still calls `render`, with a step that
 * returns its own input -- React bails out of a state update to the value it
 * already holds, which is what lets the loop run for the whole stream instead
 * of having to be stopped and restarted around every quiet gap.
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
