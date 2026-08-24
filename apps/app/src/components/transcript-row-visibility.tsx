import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";

type VisibilityListener = (visible: boolean) => void;

const PREWARM_MARGIN_PX = 400;

export interface TranscriptVisibilityRegistry {
  dispose: () => void;
  subscribe: (element: Element, listener: VisibilityListener) => () => void;
}

const TranscriptRowVisibilityContext = createContext(true);

/** One observer per transcript; rows only hold a boolean subscription. */
export function createTranscriptVisibilityRegistry(
  getRoot: () => Element | null,
): TranscriptVisibilityRegistry {
  const listeners = new Map<Element, VisibilityListener>();
  let observer: IntersectionObserver | undefined;
  let resizeObserver: ResizeObserver | undefined;

  function ensureObserver(): IntersectionObserver | undefined {
    if (typeof IntersectionObserver === "undefined") return undefined;
    observer ??= new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          listeners.get(entry.target)?.(
            entry.isIntersecting && entry.intersectionRatio > 0,
          );
        }
      },
      {
        root: getRoot(),
        // Prewarm heavy content shortly before it enters the viewport.
        rootMargin: `${PREWARM_MARGIN_PX}px 0px`,
        threshold: 0.01,
      },
    );
    return observer;
  }

  function ensureResizeObserver(): ResizeObserver | undefined {
    if (typeof ResizeObserver === "undefined") return undefined;
    resizeObserver ??= new ResizeObserver((entries) => {
      for (const entry of entries) {
        const listener = listeners.get(entry.target);
        listener?.(isTranscriptRowNearViewport(entry.target, getRoot()));
      }
    });
    return resizeObserver;
  }

  return {
    dispose() {
      listeners.clear();
      observer?.disconnect();
      observer = undefined;
      resizeObserver?.disconnect();
      resizeObserver = undefined;
    },
    subscribe(element, listener) {
      const activeObserver = ensureObserver();
      if (activeObserver === undefined) {
        listener(true);
        return () => {};
      }
      listeners.set(element, listener);
      // IntersectionObserver delivery is asynchronous and browsers may omit
      // the initial entry when a streaming target is inserted and resized in
      // the same frame. Seed the subscription from geometry so a row that is
      // already on screen cannot remain permanently gated.
      listener(isTranscriptRowNearViewport(element, getRoot()));
      activeObserver.observe(element);
      ensureResizeObserver()?.observe(element);
      return () => {
        listeners.delete(element);
        activeObserver.unobserve(element);
        resizeObserver?.unobserve(element);
      };
    },
  };
}

export function isTranscriptRowNearViewport(
  element: Element,
  root: Element | null,
): boolean {
  const elementRect = element.getBoundingClientRect();
  if (elementRect.width <= 0 || elementRect.height <= 0) return false;
  const rootRect =
    root?.getBoundingClientRect() ??
    new DOMRect(0, 0, window.innerWidth, window.innerHeight);
  return (
    elementRect.bottom >= rootRect.top - PREWARM_MARGIN_PX &&
    elementRect.top <= rootRect.bottom + PREWARM_MARGIN_PX &&
    elementRect.right >= rootRect.left &&
    elementRect.left <= rootRect.right
  );
}

export function TranscriptRowVisibilityBoundary({
  children,
  elementId,
  registry,
}: {
  children: ReactNode;
  elementId: string;
  registry: TranscriptVisibilityRegistry;
}) {
  const [visible, setVisible] = useState(
    () => typeof IntersectionObserver === "undefined",
  );
  useEffect(() => {
    const element = document.getElementById(elementId);
    if (element === null) {
      // Streaming rows can mount this boundary before their final article is
      // committed. There is no reliable intersection target in that brief
      // state, so prefer correct rendering over leaving heavy Markdown/audio
      // features permanently disabled for the lifetime of the row.
      setVisible(true);
      return;
    }
    return registry.subscribe(element, setVisible);
  }, [elementId, registry]);
  return (
    <TranscriptRowVisibilityContext.Provider value={visible}>
      {children}
    </TranscriptRowVisibilityContext.Provider>
  );
}

export function useTranscriptRowVisibility(): boolean {
  return useContext(TranscriptRowVisibilityContext);
}
