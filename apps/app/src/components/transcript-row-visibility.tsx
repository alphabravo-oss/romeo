import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";

type VisibilityListener = (visible: boolean) => void;

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
        rootMargin: "400px 0px",
        threshold: 0.01,
      },
    );
    return observer;
  }

  return {
    dispose() {
      listeners.clear();
      observer?.disconnect();
      observer = undefined;
    },
    subscribe(element, listener) {
      const activeObserver = ensureObserver();
      if (activeObserver === undefined) {
        listener(true);
        return () => {};
      }
      listeners.set(element, listener);
      activeObserver.observe(element);
      return () => {
        listeners.delete(element);
        activeObserver.unobserve(element);
      };
    },
  };
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
    if (element === null) return;
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
