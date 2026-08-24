// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DataTableAuthority } from "./table-authority";
import type { TableSavedView } from "./table-preferences";
import { useDataTableAuthority } from "./use-data-table-authority";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const view: TableSavedView = {
  canEdit: true,
  columnVisibility: {},
  density: "comfortable",
  filters: [],
  globalFilter: "",
  id: "view-1",
  isDefault: true,
  name: "Incidents",
  pageSize: 25,
  schemaVersion: 2,
  sorting: [],
  source: "server",
  visibility: "workspace",
};

describe("useDataTableAuthority delete recovery", () => {
  it("deletes immediately and restores through the server undo receipt", async () => {
    vi.useFakeTimers();
    const restore = vi.fn(async () => undefined);
    const deleteView = vi.fn(async () => ({ restore }));
    const authority: DataTableAuthority = {
      deleteView,
      exportView: vi.fn(async () => undefined),
      mode: "server",
      savedViews: [view],
      saveView: vi.fn(async () => undefined),
      setDefaultView: vi.fn(async () => undefined),
      setViewVisibility: vi.fn(async () => undefined),
      status: "ready",
    };
    const hook = renderHook(() =>
      useDataTableAuthority({
        authority,
        initialPageSize: 25,
        operationFailureMessage: "Operation failed",
        preferenceKey: "test",
        serverAuthorityUnavailableMessage: "Server unavailable",
        validColumnIds: new Set(["name"]),
      }),
    );

    await act(async () => {
      hook.result.current.deleteView(view);
      await Promise.resolve();
    });
    expect(deleteView).toHaveBeenCalledOnce();
    expect(hook.result.current.savedViews).toEqual([]);
    act(() => hook.result.current.undoDeleteView());
    expect(hook.result.current.savedViews).toEqual([view]);
    await act(async () => Promise.resolve());
    expect(restore).toHaveBeenCalledOnce();

    await act(async () => {
      hook.result.current.deleteView(view);
      await Promise.resolve();
    });
    expect(deleteView).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(restore).toHaveBeenCalledOnce();
  });
});
