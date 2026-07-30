import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createColumnHelper,
  DataTable,
  type DataTableLabels,
} from "./advanced-data-table";

Element.prototype.scrollIntoView = vi.fn();
globalThis.ResizeObserver = class ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
};

const labels: DataTableLabels = {
  columns: "Columns",
  comfortable: "Comfortable",
  compact: "Compact",
  density: "Density",
  exportCsv: "Export CSV",
  loading: "Loading",
  nextPage: "Next page",
  noMatches: "No matches",
  noRecords: "No records",
  of: "of",
  options: "Table options",
  page: "page",
  previousPage: "Previous page",
  resetView: "Reset table view",
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
  total: "total",
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
