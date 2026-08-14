// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  readStoredSidebarWidth,
  sidebarDefault,
  sidebarMax,
  sidebarMin,
  sidebarWidthForKey,
  sidebarWidthFromPointer,
  writeStoredSidebarWidth,
} from "./useSidebarResize";
import { SidebarResizer } from "./SidebarResizer";

let container: HTMLDivElement;
let root: Root;
const reactTestEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};

beforeEach(() => {
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  document.documentElement.style.removeProperty("--rm-sidebar-width");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.style.userSelect = "";
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
});

function renderHarness(): HTMLElement {
  act(() => root.render(<SidebarResizer label="Resize sidebar" />));
  const resizer = container.querySelector<HTMLElement>("[role=separator]");
  if (resizer === null) throw new Error("resizer was not rendered");
  return resizer;
}

function pointerEvent(
  type: "pointercancel" | "pointerdown" | "pointermove" | "pointerup",
  clientX: number,
  pointerType = "mouse",
): Event {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    cancelable: true,
    clientX,
  });
  Object.defineProperties(event, {
    isPrimary: { value: true },
    pointerId: { value: 1 },
    pointerType: { value: pointerType },
  });
  return event;
}

describe("sidebar resize", () => {
  it("loads only a validated persisted width", () => {
    localStorage.setItem("rm-sidebar-width", "320");
    const resizer = renderHarness();

    expect(resizer.getAttribute("aria-valuenow")).toBe("320");
    expect(resizer.getAttribute("aria-controls")).toBe("main-content");
    expect(resizer.getAttribute("aria-label")).toBe("Resize sidebar");
    expect(resizer.getAttribute("aria-orientation")).toBe("vertical");
    expect(resizer.getAttribute("aria-valuemin")).toBe(String(sidebarMin));
    expect(resizer.getAttribute("aria-valuemax")).toBe(String(sidebarMax));
    expect(
      document.documentElement.style.getPropertyValue("--rm-sidebar-width"),
    ).toBe("320px");

    act(() => root.unmount());
    root = createRoot(container);
    localStorage.setItem("rm-sidebar-width", "9999px");
    const resetResizer = renderHarness();
    expect(resetResizer.getAttribute("aria-valuenow")).toBe(
      String(sidebarDefault),
    );
    expect(localStorage.getItem("rm-sidebar-width")).toBeNull();
  });

  it("supports arrows, accelerated arrows, Home, and End", () => {
    localStorage.setItem("rm-sidebar-width", "300");
    const resizer = renderHarness();

    act(() => {
      resizer.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }),
      );
    });
    expect(resizer.getAttribute("aria-valuenow")).toBe("310");

    act(() => {
      resizer.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "ArrowLeft",
          shiftKey: true,
        }),
      );
    });
    expect(resizer.getAttribute("aria-valuenow")).toBe("270");

    act(() => {
      resizer.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Home" }),
      );
    });
    expect(resizer.getAttribute("aria-valuenow")).toBe(String(sidebarMin));

    act(() => {
      resizer.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "End" }),
      );
    });
    expect(resizer.getAttribute("aria-valuenow")).toBe(String(sidebarMax));
    expect(localStorage.getItem("rm-sidebar-width")).toBe(String(sidebarMax));
  });

  it("uses pointer events for mouse and touch and persists on release", () => {
    const resizer = renderHarness();

    act(() => resizer.dispatchEvent(pointerEvent("pointerdown", 100, "touch")));
    expect(document.body.style.userSelect).toBe("none");
    act(() => window.dispatchEvent(pointerEvent("pointermove", 180, "touch")));
    expect(
      document.documentElement.style.getPropertyValue("--rm-sidebar-width"),
    ).toBe("340px");
    act(() => window.dispatchEvent(pointerEvent("pointerup", 180, "touch")));

    expect(resizer.getAttribute("aria-valuenow")).toBe("340");
    expect(localStorage.getItem("rm-sidebar-width")).toBe("340");
    expect(document.body.style.userSelect).toBe("");
  });

  it("clamps pointer and keyboard calculations", () => {
    expect(sidebarWidthFromPointer(260, 100, -1_000)).toBe(sidebarMin);
    expect(sidebarWidthFromPointer(260, 100, 1_000)).toBe(sidebarMax);
    expect(sidebarWidthForKey(sidebarMin, "ArrowLeft")).toBe(sidebarMin);
    expect(sidebarWidthForKey(sidebarMax, "ArrowRight")).toBe(sidebarMax);
    expect(sidebarWidthForKey(260, "Enter")).toBeUndefined();
  });

  it("handles blocked and quota-limited storage without throwing", () => {
    const unavailableStorage = {
      get length(): number {
        throw new DOMException("blocked", "SecurityError");
      },
      clear(): void {
        throw new DOMException("blocked", "SecurityError");
      },
      getItem(): string | null {
        throw new DOMException("blocked", "SecurityError");
      },
      key(): string | null {
        throw new DOMException("blocked", "SecurityError");
      },
      removeItem(): void {
        throw new DOMException("blocked", "SecurityError");
      },
      setItem(): void {
        throw new DOMException("full", "QuotaExceededError");
      },
    } satisfies Storage;

    expect(readStoredSidebarWidth(unavailableStorage)).toBeUndefined();
    expect(() =>
      writeStoredSidebarWidth(unavailableStorage, 320),
    ).not.toThrow();
    expect(readStoredSidebarWidth(undefined)).toBeUndefined();
    expect(() => writeStoredSidebarWidth(undefined, 320)).not.toThrow();
  });
});
