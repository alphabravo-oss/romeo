import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

export const sidebarDefault = 260;
export const sidebarMin = 220;
export const sidebarMax = 480;
const sidebarStorageKey = "rm-sidebar-width";
const sidebarKeyboardStep = 10;
const sidebarKeyboardLargeStep = 40;

export interface SidebarResizeHandlers {
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  width: number;
}

export function useSidebarResize(): SidebarResizeHandlers {
  const [width, setWidth] = useState(sidebarDefault);
  const widthRef = useRef(sidebarDefault);
  const stopDraggingRef = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    const saved = readStoredSidebarWidth(browserLocalStorage());
    const initialWidth = saved ?? sidebarDefault;
    widthRef.current = initialWidth;
    applySidebarWidth(initialWidth);
    setWidth(initialWidth);

    return () => stopDraggingRef.current?.();
  }, []);

  const commitWidth = useCallback((next: number) => {
    const validated = clampSidebarWidth(next);
    widthRef.current = validated;
    applySidebarWidth(validated);
    setWidth(validated);
    writeStoredSidebarWidth(browserLocalStorage(), validated);
  }, []);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const next = sidebarWidthForKey(
        widthRef.current,
        event.key,
        event.shiftKey,
      );
      if (next === undefined) return;
      event.preventDefault();
      commitWidth(next);
    },
    [commitWidth],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!event.isPrimary || event.button !== 0) return;
      event.preventDefault();
      stopDraggingRef.current?.();

      const handle = event.currentTarget;
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startWidth = widthRef.current;
      const previousUserSelect = document.body.style.userSelect;
      let nextWidth = startWidth;

      try {
        handle.setPointerCapture(pointerId);
      } catch {
        // Global pointer listeners still keep the drag functional.
      }

      const stopDragging = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerCancel);
        document.body.style.userSelect = previousUserSelect;
        try {
          if (handle.hasPointerCapture(pointerId)) {
            handle.releasePointerCapture(pointerId);
          }
        } catch {
          // The element may have detached or lost capture during navigation.
        }
        stopDraggingRef.current = undefined;
      };
      const onPointerMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        moveEvent.preventDefault();
        nextWidth = sidebarWidthFromPointer(
          startWidth,
          startX,
          moveEvent.clientX,
        );
        widthRef.current = nextWidth;
        applySidebarWidth(nextWidth);
      };
      const onPointerUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== pointerId) return;
        stopDragging();
        commitWidth(nextWidth);
      };
      const onPointerCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId !== pointerId) return;
        stopDragging();
        widthRef.current = startWidth;
        applySidebarWidth(startWidth);
        setWidth(startWidth);
      };

      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", onPointerMove, { passive: false });
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerCancel);
      stopDraggingRef.current = stopDragging;
    },
    [commitWidth],
  );

  return { onKeyDown, onPointerDown, width };
}

export function sidebarWidthForKey(
  current: number,
  key: string,
  largeStep = false,
): number | undefined {
  const step = largeStep ? sidebarKeyboardLargeStep : sidebarKeyboardStep;
  if (key === "ArrowLeft") return clampSidebarWidth(current - step);
  if (key === "ArrowRight") return clampSidebarWidth(current + step);
  if (key === "Home") return sidebarMin;
  if (key === "End") return sidebarMax;
  return undefined;
}

export function sidebarWidthFromPointer(
  startWidth: number,
  startX: number,
  currentX: number,
): number {
  return clampSidebarWidth(startWidth + currentX - startX);
}

export function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return sidebarDefault;
  return Math.min(sidebarMax, Math.max(sidebarMin, Math.round(value)));
}

export function readStoredSidebarWidth(
  storage: Storage | undefined,
): number | undefined {
  if (storage === undefined) return undefined;
  let raw: string | null;
  try {
    raw = storage.getItem(sidebarStorageKey);
  } catch {
    return undefined;
  }
  if (raw === null) return undefined;
  const parsed = Number(raw);
  if (
    !/^\d+$/u.test(raw) ||
    !Number.isInteger(parsed) ||
    parsed < sidebarMin ||
    parsed > sidebarMax
  ) {
    safelyRemoveStoredSidebarWidth(storage);
    return undefined;
  }
  return parsed;
}

export function writeStoredSidebarWidth(
  storage: Storage | undefined,
  value: number,
): void {
  if (storage === undefined) return;
  const validated = clampSidebarWidth(value);
  try {
    storage.setItem(sidebarStorageKey, String(validated));
  } catch {
    // Resizing remains functional when storage is disabled, blocked, or full.
  }
}

function browserLocalStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function applySidebarWidth(value: number): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty(
    "--rm-sidebar-width",
    `${clampSidebarWidth(value)}px`,
  );
}

function safelyRemoveStoredSidebarWidth(storage: Storage): void {
  try {
    storage.removeItem(sidebarStorageKey);
  } catch {
    // Invalid persisted UI state is best-effort cleanup only.
  }
}
