import { lazy, Suspense, useEffect, useState } from "react";

const loadCommandPalette = () => import("./CommandPalette");
const loadShortcutsModal = () => import("./ShortcutsModal");
const LazyCommandPalette = lazy(async () => ({
  default: (await loadCommandPalette()).CommandPalette,
}));
const LazyShortcutsModal = lazy(async () => ({
  default: (await loadShortcutsModal()).ShortcutsModal,
}));

/**
 * Keeps global overlay implementations out of the initial route shell while a
 * tiny launcher retains first-keystroke behavior. Once loaded, each overlay
 * resumes ownership of its existing keyboard/event listeners.
 */
export function LazyGlobalOverlays() {
  const [commandRequested, setCommandRequested] = useState(false);
  const [shortcutsRequested, setShortcutsRequested] = useState(false);

  useEffect(() => {
    const preload = () => {
      void loadCommandPalette();
      void loadShortcutsModal();
    };
    const idleWindow = window as Window & {
      cancelIdleCallback?: (id: number) => void;
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout: number },
      ) => number;
    };
    if (idleWindow.requestIdleCallback !== undefined) {
      const idleId = idleWindow.requestIdleCallback(preload, {
        timeout: 4_000,
      });
      return () => idleWindow.cancelIdleCallback?.(idleId);
    }
    const timer = globalThis.setTimeout(preload, 2_000);
    return () => globalThis.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !commandRequested &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        setCommandRequested(true);
        return;
      }
      if (shortcutsRequested || event.key !== "?") return;
      const element = document.activeElement as HTMLElement | null;
      const typing =
        element?.tagName === "INPUT" ||
        element?.tagName === "TEXTAREA" ||
        element?.isContentEditable === true;
      if (!typing) {
        event.preventDefault();
        setShortcutsRequested(true);
      }
    };
    const onShortcuts = () => {
      if (!shortcutsRequested) setShortcutsRequested(true);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("rm-shortcuts", onShortcuts);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("rm-shortcuts", onShortcuts);
    };
  }, [commandRequested, shortcutsRequested]);

  return (
    <Suspense fallback={null}>
      {commandRequested ? <LazyCommandPalette initialOpen /> : null}
      {shortcutsRequested ? <LazyShortcutsModal initialOpen /> : null}
    </Suspense>
  );
}
