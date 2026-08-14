import {
  defaultRangeExtractor,
  useVirtualizer,
  type Range,
} from "@tanstack/react-virtual";
import { Button } from "@romeo/ui";
import type { KeyboardEvent, ReactNode } from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  createTranscriptVisibilityRegistry,
  TranscriptRowVisibilityBoundary,
} from "./transcript-row-visibility";

const DEFAULT_ESTIMATED_ROW_HEIGHT = 180;
const INITIAL_VIEWPORT_RECT = { height: 800, width: 768 };
const TRANSCRIPT_VIRTUALIZATION_THRESHOLD = 60;
const TRANSCRIPT_OVERSCAN = 6;
const MESSAGE_HASH_PREFIX = "#message-";
export const TRANSCRIPT_FEED_ID = "chat-transcript";
const subscribeToHydration = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

interface TranscriptItem {
  id: string;
}

export function transcriptMessageDomId(messageId: string): string {
  return `message-${encodeURIComponent(messageId)}`;
}

export function transcriptMessageHeadingDomId(messageId: string): string {
  return `${transcriptMessageDomId(messageId)}-heading`;
}

export function transcriptMessageIdFromHash(hash: string): string | undefined {
  if (!hash.startsWith(MESSAGE_HASH_PREFIX)) return undefined;
  try {
    return decodeURIComponent(hash.slice(MESSAGE_HASH_PREFIX.length));
  } catch {
    return undefined;
  }
}

export function transcriptRangeExtractor(
  range: Range,
  pinnedIndexes: readonly number[],
): number[] {
  const indexes = new Set(defaultRangeExtractor(range));
  for (const index of pinnedIndexes) {
    if (index >= 0 && index < range.count) indexes.add(index);
  }
  return [...indexes].sort((left, right) => left - right);
}

export function shouldVirtualizeTranscript(input: {
  clientReady: boolean;
  canMeasure: boolean;
  forceAccessible: boolean;
  messageCount: number;
}): boolean {
  return (
    input.clientReady &&
    input.canMeasure &&
    !input.forceAccessible &&
    input.messageCount >= TRANSCRIPT_VIRTUALIZATION_THRESHOLD
  );
}

export function TranscriptWindow<TItem extends TranscriptItem>({
  accessibleDescription,
  estimateSize,
  feedLabel,
  getScrollElement,
  items,
  renderItem,
  showAllLabel,
  useWindowedLabel,
  windowedDescription,
  onVirtualizationChange,
}: {
  accessibleDescription: string;
  estimateSize?: (index: number) => number;
  feedLabel: string;
  getScrollElement: () => HTMLDivElement | null;
  items: readonly TItem[];
  renderItem: (item: TItem, index: number) => ReactNode;
  showAllLabel: string;
  useWindowedLabel: string;
  windowedDescription: string;
  onVirtualizationChange?: (enabled: boolean) => void;
}) {
  // getServerSnapshot keeps SSR/non-JS complete; a pure client mount starts
  // windowed immediately and never pays for an avoidable 1,000-row first DOM.
  const clientReady = useSyncExternalStore(
    subscribeToHydration,
    clientSnapshot,
    serverSnapshot,
  );
  const [forceAccessible, setForceAccessible] = useState(false);
  const [focusedMessageId, setFocusedMessageId] = useState<string>();
  const [deepLinkMessageId, setDeepLinkMessageId] = useState<string>();
  const handledHash = useRef<string | undefined>(undefined);
  const indexById = useMemo(
    () => new Map(items.map((item, index) => [item.id, index])),
    [items],
  );
  const canMeasure =
    typeof window !== "undefined" && "ResizeObserver" in window;
  const virtualized = shouldVirtualizeTranscript({
    clientReady,
    canMeasure,
    forceAccessible,
    messageCount: items.length,
  });
  const pinnedIndexes = useMemo(() => {
    const indexes = new Set<number>();
    for (const id of [focusedMessageId, deepLinkMessageId]) {
      if (id === undefined) continue;
      const index = indexById.get(id);
      if (index !== undefined) indexes.add(index);
    }
    return [...indexes];
  }, [deepLinkMessageId, focusedMessageId, indexById]);
  const extractRange = useCallback(
    (range: Range) => transcriptRangeExtractor(range, pinnedIndexes),
    [pinnedIndexes],
  );
  const getItemKey = useCallback(
    (index: number) => items[index]?.id ?? index,
    [items],
  );
  const estimateRow = useCallback(
    (index: number) => estimateSize?.(index) ?? DEFAULT_ESTIMATED_ROW_HEIGHT,
    [estimateSize],
  );
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: items.length,
    directDomUpdates: true,
    enabled: virtualized,
    estimateSize: estimateRow,
    gap: 14,
    getItemKey,
    getScrollElement,
    initialRect: INITIAL_VIEWPORT_RECT,
    overscan: TRANSCRIPT_OVERSCAN,
    rangeExtractor: extractRange,
    useAnimationFrameWithResizeObserver: true,
    useFlushSync: false,
  });
  const visibilityRegistry = useMemo(
    () => createTranscriptVisibilityRegistry(getScrollElement),
    [getScrollElement],
  );
  useEffect(() => () => visibilityRegistry.dispose(), [visibilityRegistry]);

  useEffect(
    () => onVirtualizationChange?.(virtualized),
    [onVirtualizationChange, virtualized],
  );

  useEffect(() => {
    if (!clientReady) return;
    const activateHash = () => {
      const hash = window.location.hash;
      const messageId = transcriptMessageIdFromHash(hash);
      const index =
        messageId === undefined ? undefined : indexById.get(messageId);
      if (messageId === undefined || index === undefined) {
        setDeepLinkMessageId(undefined);
        return;
      }
      setDeepLinkMessageId(messageId);
      if (handledHash.current === hash) return;
      handledHash.current = hash;
      if (virtualized) virtualizer.scrollToIndex(index, { align: "center" });
      requestAnimationFrame(() => {
        document
          .getElementById(transcriptMessageDomId(messageId))
          ?.focus({ preventScroll: virtualized });
      });
    };
    activateHash();
    window.addEventListener("hashchange", activateHash);
    return () => window.removeEventListener("hashchange", activateHash);
  }, [clientReady, indexById, virtualized, virtualizer]);

  useEffect(() => {
    if (!virtualized) return;
    const handleSelectionChange = () => {
      const selection = document.getSelection();
      if (selection === null || selection.isCollapsed) return;
      const anchor = messageElement(selection.anchorNode);
      const focus = messageElement(selection.focusNode);
      // Once selection spans rows, retain the browser's normal contiguous
      // selection model by switching to the complete loaded DOM.
      if (
        anchor !== null &&
        focus !== null &&
        anchor.dataset.messageId !== focus.dataset.messageId
      ) {
        setForceAccessible(true);
      }
    };
    document.addEventListener("selectionchange", handleSelectionChange);
    return () =>
      document.removeEventListener("selectionchange", handleSelectionChange);
  }, [virtualized]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      // Browser find cannot discover an unmounted row. Switch to the complete
      // loaded transcript before the browser consumes Cmd/Ctrl+F.
      if (
        virtualized &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "f"
      ) {
        setForceAccessible(true);
      }
    },
    [virtualized],
  );
  const handleFocus = useCallback((target: EventTarget | null) => {
    const element = target instanceof Node ? messageElement(target) : null;
    setFocusedMessageId(element?.dataset.messageId);
  }, []);
  const handleBlur = useCallback(() => {
    queueMicrotask(() => {
      const element = messageElement(document.activeElement);
      setFocusedMessageId(element?.dataset.messageId);
    });
  }, []);
  const rows = virtualized
    ? virtualizer.getVirtualItems().map((virtualRow) => {
        const item = items[virtualRow.index];
        if (item === undefined) return null;
        return (
          <div
            className="rm-message-window-row"
            data-index={virtualRow.index}
            key={item.id}
            ref={virtualizer.measureElement}
          >
            <TranscriptRowVisibilityBoundary
              elementId={transcriptMessageDomId(item.id)}
              registry={visibilityRegistry}
            >
              {renderItem(item, virtualRow.index)}
            </TranscriptRowVisibilityBoundary>
          </div>
        );
      })
    : items.map((item, index) => (
        <TranscriptRowVisibilityBoundary
          elementId={transcriptMessageDomId(item.id)}
          key={item.id}
          registry={visibilityRegistry}
        >
          {renderItem(item, index)}
        </TranscriptRowVisibilityBoundary>
      ));

  return (
    <>
      {clientReady &&
      canMeasure &&
      items.length >= TRANSCRIPT_VIRTUALIZATION_THRESHOLD ? (
        <div className="rm-transcript-display-controls">
          <Button
            aria-describedby="transcript-display-mode-description"
            onClick={() => setForceAccessible((current) => !current)}
            size="sm"
            type="button"
            variant="ghost"
          >
            {virtualized ? showAllLabel : useWindowedLabel}
          </Button>
          <span
            className="sr-only"
            id="transcript-display-mode-description"
            role="status"
          >
            {virtualized ? windowedDescription : accessibleDescription}
          </span>
        </div>
      ) : null}
      <div
        aria-label={feedLabel}
        className={`rm-message-list${virtualized ? " virtualized" : ""}`}
        data-message-count={items.length}
        id={TRANSCRIPT_FEED_ID}
        onBlurCapture={handleBlur}
        onFocusCapture={(event) => handleFocus(event.target)}
        onKeyDownCapture={handleKeyDown}
        role="feed"
        {...(virtualized ? { ref: virtualizer.containerRef } : {})}
      >
        {rows}
      </div>
    </>
  );
}

function messageElement(node: Node | null): HTMLElement | null {
  if (node === null) return null;
  const element = node instanceof HTMLElement ? node : node.parentElement;
  return element?.closest<HTMLElement>("[data-message-id]") ?? null;
}
