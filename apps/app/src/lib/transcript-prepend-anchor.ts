export interface TranscriptPrependAnchor {
  messageId?: string;
  messageOffset?: number;
  scrollHeight: number;
  scrollTop: number;
}

const MAX_LAYOUT_FRAMES = 48;
const REQUIRED_STABLE_FRAMES = 18;
const POST_SETTLE_STABLE_FRAMES = 2;
const SETTLE_VERIFICATION_DELAY_MS = 100;

export function captureTranscriptPrependAnchor(
  viewport: HTMLElement | null,
): TranscriptPrependAnchor {
  const message = firstVisibleMessage(viewport);
  return {
    ...(message === undefined
      ? {}
      : { messageId: message.id, messageOffset: message.offset }),
    scrollHeight: viewport?.scrollHeight ?? 0,
    scrollTop: viewport?.scrollTop ?? 0,
  };
}

/** Follow TanStack's bounded direct-DOM size transition after a page prepend. */
export function restoreTranscriptPrependAnchor(
  viewport: HTMLElement,
  snapshot: TranscriptPrependAnchor,
  onSettled?: () => void,
): () => void {
  let cancelled = false;
  let frame: number | undefined;
  let verificationTimer: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;
  let lastHeight = snapshot.scrollHeight;
  let stableFrames = 0;
  let sawLayoutChange = false;
  let verificationStarted = false;
  const restore = () => {
    if (cancelled) return;
    attempts++;
    const height = viewport.scrollHeight;
    if (height !== snapshot.scrollHeight) sawLayoutChange = true;
    const messageCorrection = anchorCorrection(viewport, snapshot);
    if (messageCorrection !== undefined && Math.abs(messageCorrection) > 0.5) {
      viewport.scrollTop += messageCorrection;
      sawLayoutChange = true;
    } else if (
      messageCorrection === undefined &&
      sawLayoutChange &&
      height !== lastHeight
    ) {
      viewport.scrollTop = snapshot.scrollTop + height - snapshot.scrollHeight;
    }
    stableFrames =
      height === lastHeight &&
      (snapshot.messageId === undefined ||
        (messageCorrection !== undefined && Math.abs(messageCorrection) <= 0.5))
        ? stableFrames + 1
        : 0;
    lastHeight = height;
    const requiredStableFrames = verificationStarted
      ? POST_SETTLE_STABLE_FRAMES
      : REQUIRED_STABLE_FRAMES;
    if (attempts >= MAX_LAYOUT_FRAMES) {
      onSettled?.();
      return;
    }
    if (sawLayoutChange && stableFrames >= requiredStableFrames) {
      if (verificationStarted) {
        onSettled?.();
        return;
      }
      verificationTimer = setTimeout(() => {
        verificationStarted = true;
        stableFrames = 0;
        restore();
      }, SETTLE_VERIFICATION_DELAY_MS);
      return;
    }
    frame = requestAnimationFrame(restore);
  };
  restore();
  return () => {
    cancelled = true;
    if (frame !== undefined) cancelAnimationFrame(frame);
    if (verificationTimer !== undefined) clearTimeout(verificationTimer);
  };
}

function anchorCorrection(
  viewport: HTMLElement,
  snapshot: TranscriptPrependAnchor,
): number | undefined {
  if (snapshot.messageId === undefined || snapshot.messageOffset === undefined)
    return undefined;
  const message = messageElements(viewport).find(
    (element) => element.dataset.messageId === snapshot.messageId,
  );
  if (
    message === undefined ||
    typeof viewport.getBoundingClientRect !== "function"
  )
    return undefined;
  return (
    message.getBoundingClientRect().top -
    viewport.getBoundingClientRect().top -
    snapshot.messageOffset
  );
}

function firstVisibleMessage(
  viewport: HTMLElement | null,
): { id: string; offset: number } | undefined {
  if (viewport === null || typeof viewport.getBoundingClientRect !== "function")
    return undefined;
  const viewportTop = viewport.getBoundingClientRect().top;
  const message = messageElements(viewport).find(
    (element) => element.getBoundingClientRect().bottom > viewportTop,
  );
  const id = message?.dataset.messageId;
  return message === undefined || id === undefined
    ? undefined
    : { id, offset: message.getBoundingClientRect().top - viewportTop };
}

function messageElements(viewport: HTMLElement): HTMLElement[] {
  return typeof viewport.querySelectorAll === "function"
    ? [...viewport.querySelectorAll<HTMLElement>("[data-message-id]")]
    : [];
}
