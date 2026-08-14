// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUDIT_PAGE_SIZE, AUDIT_SEARCH_DEBOUNCE_MS } from "./audit-table-query";
import { useAuditTableController } from "./useAuditTableController";
import type { AuditRouteState } from "../lib/audit-route-state";

let container: HTMLDivElement;
let root: Root;
let controller: ReturnType<typeof useAuditTableController>;
let setRouteState: (state: AuditRouteState) => void;
const reactTestEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};

beforeEach(() => {
  vi.useFakeTimers();
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  vi.useRealTimers();
});

function Harness() {
  controller = useAuditTableController();
  return null;
}

function ControlledHarness() {
  const [routeState, updateRouteState] = useState<AuditRouteState>({
    category: "",
    includeNoise: false,
    outcome: "",
    pageSize: 50,
    range: "7d",
    sortDirection: "desc",
  });
  setRouteState = updateRouteState;
  controller = useAuditTableController({
    pageSize: routeState.pageSize,
    resetKey: JSON.stringify(routeState),
    sortDirection: routeState.sortDirection,
    onPageSizeChange: (pageSize) =>
      updateRouteState((current) => ({
        ...current,
        pageSize: pageSize === 100 ? 100 : 50,
      })),
    onSortDirectionChange: (sortDirection) =>
      updateRouteState((current) => ({ ...current, sortDirection })),
  });
  return null;
}

describe("useAuditTableController", () => {
  it("owns cursor history, page size, createdAt sort, debounce, and recovery", () => {
    act(() => root.render(<Harness />));
    expect(controller.cursor).toBeUndefined();
    expect(controller.pageSize).toBe(AUDIT_PAGE_SIZE);

    act(() =>
      controller
        .tableState({
          filters: [],
          isFetching: false,
          nextCursor: "cursor-2",
          total: { mode: "estimated", value: 120 },
        })
        .onNextPage(),
    );
    expect(controller.cursor).toBe("cursor-2");
    expect(
      controller.tableState({
        filters: [],
        isFetching: false,
        total: { mode: "unknown" },
      }).pageIndex,
    ).toBe(1);

    act(() =>
      controller
        .tableState({
          filters: [],
          isFetching: false,
          total: { mode: "unknown" },
        })
        .onSortingChange?.([{ id: "createdAt", desc: false }]),
    );
    expect(controller.sortDirection).toBe("asc");
    expect(controller.cursor).toBeUndefined();

    act(() =>
      controller
        .tableState({
          filters: [],
          isFetching: false,
          total: { mode: "unknown" },
        })
        .onSearchChange?.("actor"),
    );
    expect(controller.search).toBe("actor");
    expect(controller.debouncedSearch).toBe("");
    expect(controller.searchReady).toBe(false);
    act(() => vi.advanceTimersByTime(AUDIT_SEARCH_DEBOUNCE_MS));
    expect(controller.debouncedSearch).toBe("actor");
    expect(controller.searchReady).toBe(true);

    act(() =>
      controller
        .tableState({
          filters: [],
          isFetching: false,
          total: { mode: "unknown" },
        })
        .onSearchChange?.("ab"),
    );
    expect(controller.searchTooShort).toBe(true);
    expect(controller.searchReady).toBe(false);
    act(() => vi.advanceTimersByTime(AUDIT_SEARCH_DEBOUNCE_MS));
    expect(controller.debouncedSearch).toBe("");

    act(() => controller.recoverStaleCursor());
    expect(controller.recoveredStaleCursor).toBe(true);
    expect(controller.cursor).toBeUndefined();

    act(() =>
      controller
        .tableState({
          filters: [],
          isFetching: false,
          total: { mode: "unknown" },
        })
        .onPageSizeChange(100),
    );
    expect(controller.pageSize).toBe(100);
    expect(controller.recoveredStaleCursor).toBe(false);
  });

  it("resets opaque cursor history when validated route state changes", () => {
    act(() => root.render(<ControlledHarness />));
    act(() =>
      controller
        .tableState({
          filters: [],
          isFetching: false,
          nextCursor: "tenant-bound-cursor",
          total: { mode: "unknown" },
        })
        .onNextPage(),
    );
    expect(controller.cursor).toBe("tenant-bound-cursor");

    act(() =>
      setRouteState({
        category: "security",
        includeNoise: false,
        outcome: "",
        pageSize: 50,
        range: "30d",
        sortDirection: "asc",
      }),
    );

    expect(controller.cursor).toBeUndefined();
    expect(controller.pageSize).toBe(50);
    expect(controller.search).toBe("");
    expect(controller.sortDirection).toBe("asc");
    expect(
      controller.tableState({
        filters: [],
        isFetching: false,
        total: { mode: "unknown" },
      }).pageIndex,
    ).toBe(0);
  });
});
