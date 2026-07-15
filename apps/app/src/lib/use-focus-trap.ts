import { useEffect, useRef } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Traps keyboard focus inside a container while `active` is true. On
 * activation it focuses the first focusable child; Tab / Shift-Tab cycle
 * within the container; Escape calls `onEscape`; and on deactivate or
 * unmount focus is restored to whatever was focused beforehand.
 *
 *   const ref = useFocusTrap({ active: open, onEscape: () => setOpen(false) })
 *   return open ? <div ref={ref} role="dialog" aria-modal="true">…</div> : null
 *
 * Pure hook — renders no JSX. Attach the returned ref to the trap container.
 */
export function useFocusTrap({
  active,
  onEscape,
}: {
  active: boolean;
  onEscape?: () => void;
}): React.RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null) as React.RefObject<HTMLDivElement>;
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (container === null) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);

    const first = focusable()[0];
    if (first !== undefined) first.focus();
    else container.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onEscapeRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const firstItem = items[0]!;
      const lastItem = items[items.length - 1]!;
      const activeEl = document.activeElement;
      if (event.shiftKey) {
        if (activeEl === firstItem || !container.contains(activeEl)) {
          event.preventDefault();
          lastItem.focus();
        }
      } else if (activeEl === lastItem || !container.contains(activeEl)) {
        event.preventDefault();
        firstItem.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      if (previouslyFocused !== null && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, [active]);

  return ref;
}
