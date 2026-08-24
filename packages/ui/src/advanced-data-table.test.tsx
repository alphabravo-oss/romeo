import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createColumnHelper,
  DataTable,
  type DataTableLabels,
} from "./advanced-data-table";
import type { ServerTableState } from "./server-table-state";

Element.prototype.scrollIntoView = vi.fn();
globalThis.ResizeObserver = class ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
};

const labels: DataTableLabels = {
  approximate: "Approximately",
  bulkActions: "Bulk actions",
  columns: "Columns",
  comfortable: "Comfortable",
  compact: "Compact",
  density: "Density",
  defaultExportFileName: "table.csv",
  error: "Could not load table",
  exportCsv: "Export CSV",
  loading: "Loading",
  nextPage: "Next page",
  noMatches: "No matches",
  noRecords: "No records",
  of: "of",
  options: "Table options",
  operationFailed: "Operation failed",
  page: "page",
  previousPage: "Previous page",
  resetView: "Reset table view",
  retry: "Retry",
  results: "results",
  rowsPerPage: "Rows per page",
  savedViews: "Saved views",
  saveView: "Save",
  search: "Search table",
  searchPlaceholder: "Search",
  selectAllRows: "Select all rows",
  selected: "selected",
  selectRow: "Select row",
  shown: "shown",
  viewName: "View name",
  deleteView: "Delete view",
  deselectRow: "Deselect row",
  total: "total",
  defaultView: "Default view",
  shareView: "Share view",
  unshareView: "Unshare view",
  serverAuthorityUnavailable: "Server unavailable",
  undo: "Undo",
  viewDeleted: "View deleted",
};
const column = createColumnHelper<{ id: string; name: string }>();
const columns = [
  column.accessor("name", { header: "Name" }),
  column.display({ id: "actions", header: "Actions", cell: () => "Open" }),
];
const data = Array.from({ length: 30 }, (_, index) => ({
  id: String(index + 1),
  name: `User ${String(30 - index).padStart(2, "0")}`,
}));

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("advanced data table", () => {
  it("sorts, filters, paginates, announces results, persists, and resets", async () => {
    const user = userEvent.setup();
    const view = renderTable();

    expect(screen.getAllByRole("row")).toHaveLength(26);
    await user.click(screen.getByRole("button", { name: "Name" }));
    expect(screen.getAllByRole("row")[1]?.textContent).toContain("User 01");

    await user.type(
      screen.getByRole("textbox", { name: "Search table" }),
      "30",
    );
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getByRole("status").textContent).toContain(
      "1 results · 30 total",
    );
    await user.clear(screen.getByRole("textbox", { name: "Search table" }));

    await user.click(screen.getByRole("button", { name: "Table options" }));
    await user.selectOptions(screen.getByLabelText("Rows per page"), "10");
    await user.click(screen.getByRole("button", { name: "Compact" }));
    await user.click(screen.getByRole("checkbox", { name: "Actions" }));
    expect(document.querySelector(".rm-table-wrap")?.classList).toContain(
      "compact",
    );
    expect(screen.queryByRole("columnheader", { name: "Actions" })).toBeNull();
    expect(screen.getAllByRole("row")).toHaveLength(11);

    view.unmount();
    renderTable();
    expect(document.querySelector(".rm-table-wrap")?.classList).toContain(
      "compact",
    );
    expect(screen.queryByRole("columnheader", { name: "Actions" })).toBeNull();
    expect(screen.getAllByRole("row")).toHaveLength(11);

    await user.click(screen.getByRole("button", { name: "Table options" }));
    await user.click(screen.getByRole("button", { name: "Reset table view" }));
    expect(document.querySelector(".rm-table-wrap")?.classList).not.toContain(
      "compact",
    );
    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(26);
  });

  it("exports the current result through a browser download", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:table"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:table");
    let downloadedFilename = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function click(this: HTMLAnchorElement) {
        downloadedFilename = this.download;
      },
    );
    renderTable();

    await userEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    const blob = createObjectUrl.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(downloadedFilename).toBe("users.csv");
  });

  it("saves and reapplies a named table view", async () => {
    const user = userEvent.setup();
    renderTable();
    const search = screen.getByRole("textbox", { name: "Search table" });
    await user.type(search, "30");
    await user.click(screen.getByRole("button", { name: "Table options" }));
    await user.type(
      screen.getByRole("textbox", { name: "View name" }),
      "Only 30",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.clear(search);
    await user.click(screen.getByRole("button", { name: "Table options" }));
    await user.click(screen.getByRole("button", { name: "Only 30" }));
    expect((search as HTMLInputElement).value).toBe("30");
    expect(screen.getAllByRole("row")).toHaveLength(2);
  });

  it("drives sorting, search, paging, totals, and page size from one server state", async () => {
    const user = userEvent.setup();
    const onNextPage = vi.fn();
    const onPreviousPage = vi.fn();
    const onPageSizeChange = vi.fn();
    const onSearchChange = vi.fn();
    const onSortingChange = vi.fn();
    const serverState: ServerTableState = {
      filters: [],
      hasNextPage: true,
      isFetching: false,
      onFiltersChange: vi.fn(),
      onNextPage,
      onPageSizeChange,
      onPreviousPage,
      onSearchChange,
      onSortingChange,
      pageIndex: 1,
      pageSize: 25,
      search: "",
      sorting: [],
      total: { mode: "estimated", value: 120 },
    };
    render(
      <DataTable
        columns={columns}
        data={data.slice(0, 2)}
        labels={labels}
        preferenceKey="server-users-test"
        searchVisibility="always"
        serverState={serverState}
      />,
    );

    expect(screen.getByText(/page 2 · 2 shown · ~120 total/u)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Name" }));
    await user.type(screen.getByRole("textbox", { name: "Search table" }), "a");
    await user.click(screen.getByRole("button", { name: "Previous page" }));
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await user.click(screen.getByRole("button", { name: "Table options" }));
    await user.selectOptions(screen.getByLabelText("Rows per page"), "50");

    expect(onSortingChange).toHaveBeenCalledOnce();
    expect(onSearchChange).toHaveBeenCalled();
    expect(onPreviousPage).toHaveBeenCalledOnce();
    expect(onNextPage).toHaveBeenCalledOnce();
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
  });

  it("disables unsupported server sorting and exposes loading semantics", () => {
    render(
      <DataTable
        columns={columns}
        data={[]}
        labels={labels}
        serverState={{
          filters: [],
          hasNextPage: false,
          onNextPage: vi.fn(),
          onPageSizeChange: vi.fn(),
          onSortingChange: vi.fn(),
          pageIndex: 0,
          pageSize: 25,
          scopeKey: "organization",
          search: "",
          sortFieldByColumnId: { createdAt: "createdAt" },
          sorting: [],
          status: "loading",
          total: { mode: "unknown" },
        }}
      />,
    );

    expect(screen.getByText("Loading")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Name" })).toBeNull();
    expect(
      document.querySelector(".rm-table-block")?.getAttribute("aria-busy"),
    ).toBe("true");
  });

  it("renders an accessible error with an explicit retry", async () => {
    const retry = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={[]}
        labels={labels}
        serverState={{
          filters: [],
          hasNextPage: false,
          onNextPage: vi.fn(),
          onPageSizeChange: vi.fn(),
          pageIndex: 0,
          pageSize: 25,
          retry,
          scopeKey: "organization",
          search: "",
          sorting: [],
          status: "error",
          total: { mode: "unknown" },
        }}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "Could not load table",
    );
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("uses server authority for saved-view lifecycle and export actions", async () => {
    const saveView = vi.fn(async () => undefined);
    const restoreView = vi.fn(async () => undefined);
    const deleteView = vi.fn(async () => ({ restore: restoreView }));
    const setDefaultView = vi.fn(async () => undefined);
    const setViewVisibility = vi.fn(async () => undefined);
    const exportView = vi.fn(async () => undefined);
    const savedView = {
      canEdit: true,
      columnVisibility: {},
      density: "comfortable" as const,
      filters: [],
      globalFilter: "",
      id: "saved_view_1",
      isDefault: false,
      name: "Incidents",
      pageSize: 25,
      schemaVersion: 2,
      sorting: [],
      source: "server" as const,
      visibility: "private" as const,
    };
    render(
      <DataTable
        authority={{
          mode: "server",
          status: "ready",
          savedViews: [savedView],
          deleteView,
          exportView,
          saveView,
          setDefaultView,
          setViewVisibility,
        }}
        columns={columns}
        data={data.slice(0, 1)}
        labels={labels}
        serverState={{
          filters: [],
          hasNextPage: false,
          onNextPage: vi.fn(),
          onPageSizeChange: vi.fn(),
          pageIndex: 0,
          pageSize: 25,
          search: "",
          sorting: [],
          status: "success",
          total: { mode: "estimated", value: 500 },
        }}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Export CSV" }));
    await user.click(screen.getByRole("button", { name: "Table options" }));
    await user.click(
      screen.getByRole("button", { name: "Default view: Incidents" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Share view: Incidents" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Delete view: Incidents" }),
    );
    expect(deleteView).toHaveBeenCalledOnce();
    expect(
      screen
        .getAllByRole("status")
        .some((status) => status.textContent?.includes("View deleted")),
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(restoreView).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Table options" }));
    await user.type(screen.getByRole("textbox", { name: "View name" }), "Mine");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(exportView).toHaveBeenCalledWith(expect.any(Object), 500);
    expect(setDefaultView).toHaveBeenCalledWith(savedView, true);
    expect(setViewVisibility).toHaveBeenCalledWith(savedView, "workspace");
    expect(deleteView).toHaveBeenCalledOnce();
    expect(saveView).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Mine" }),
    );
  });

  it("exposes exact row counts and absolute indices without claiming estimates", () => {
    const serverState: ServerTableState = {
      filters: [],
      hasNextPage: true,
      onNextPage: vi.fn(),
      onPageSizeChange: vi.fn(),
      pageIndex: 2,
      pageSize: 2,
      search: "",
      sorting: [],
      status: "success",
      total: { mode: "exact", value: 10 },
    };
    const view = render(
      <DataTable
        columns={columns}
        data={data.slice(0, 2)}
        labels={labels}
        serverState={serverState}
      />,
    );
    const table = screen.getByRole("table");
    expect(table.getAttribute("aria-rowcount")).toBe("11");
    expect(screen.getAllByRole("row")[1]?.getAttribute("aria-rowindex")).toBe(
      "6",
    );

    view.rerender(
      <DataTable
        columns={columns}
        data={data.slice(0, 2)}
        labels={labels}
        serverState={{
          ...serverState,
          total: { mode: "estimated", value: 10 },
        }}
      />,
    );
    expect(screen.getByRole("table").hasAttribute("aria-rowcount")).toBe(false);
    expect(
      screen
        .getAllByRole("status")
        .some((status) => status.textContent?.includes("Approximately")),
    ).toBe(true);
  });

  it("gives every selection checkbox a row-specific accessible name", async () => {
    render(
      <DataTable
        columns={columns}
        data={data.slice(0, 2)}
        enableRowSelection
        getRowId={(row) => row.id}
        labels={labels}
        rowAriaLabel={(row) => row.name}
      />,
    );

    const first = screen.getByRole("checkbox", { name: "Select row: User 30" });
    const second = screen.getByRole("checkbox", {
      name: "Select row: User 29",
    });
    expect(first).not.toBe(second);
    await userEvent.click(first);
    expect(
      screen.getByRole("checkbox", { name: "Deselect row: User 30" }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("checkbox", { name: "Select all rows" })
        .getAttribute("data-state"),
    ).toBe("indeterminate");
  });

  it("renders a real primary-cell link and isolates modified clicks and row actions", () => {
    const onActivate = vi.fn();
    const action = vi.fn();
    const linkedColumns = [
      column.accessor("name", { header: "Name" }),
      column.display({
        id: "actions",
        header: "Actions",
        cell: () => <button onClick={action}>Archive</button>,
      }),
    ];
    render(
      <DataTable
        columns={linkedColumns}
        data={data.slice(0, 1)}
        labels={labels}
        onRowActivate={onActivate}
        rowAriaLabel={(row) => `Open ${row.name}`}
        rowHref={(row) => `/users/${row.id}`}
      />,
    );

    const link = screen.getByRole("link", { name: "Open User 30" });
    expect(link.getAttribute("href")).toBe("/users/1");
    link.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        metaKey: true,
      }),
    );
    expect(onActivate).not.toHaveBeenCalled();
    screen.getByRole("button", { name: "Archive" }).click();
    expect(action).toHaveBeenCalledOnce();
    expect(onActivate).not.toHaveBeenCalled();
    link.click();
    expect(onActivate).toHaveBeenCalledOnce();
  });
});

function renderTable() {
  return render(
    <DataTable
      columns={columns}
      data={data}
      exportFileName="users.csv"
      labels={labels}
      preferenceKey="users-test"
    />,
  );
}
