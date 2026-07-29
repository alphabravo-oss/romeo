import type { Table } from "@tanstack/react-table";
import Download from "lucide-react/dist/esm/icons/download.mjs";
import Search from "lucide-react/dist/esm/icons/search.mjs";
import SlidersHorizontal from "lucide-react/dist/esm/icons/sliders-horizontal.mjs";
import { useId, type Dispatch, type SetStateAction } from "react";

import type { DataTableLabels } from "./advanced-data-table";
import { Button, IconButton } from "./button";
import { Checkbox, Input, NativeSelect } from "./forms";
import { Popover } from "./overlays";
import { tablePageSizes, type TableDensity } from "./table-preferences";

export function DataTableControls<T>({
  canExport,
  clientPaginate,
  density,
  globalFilter,
  labels,
  onExport,
  onReset,
  pageSize,
  setDensity,
  showExport,
  showSearch,
  table,
}: {
  canExport: boolean;
  clientPaginate: boolean;
  density: TableDensity;
  globalFilter: string;
  labels: DataTableLabels;
  onExport: () => void;
  onReset: () => void;
  pageSize: number;
  setDensity: Dispatch<SetStateAction<TableDensity>>;
  showExport: boolean;
  showSearch: boolean;
  table: Table<T>;
}) {
  const pageSizeId = useId();
  const hideableColumns = table
    .getAllLeafColumns()
    .filter(
      (column) =>
        column.getCanHide() && typeof column.columnDef.header === "string",
    );
  const visibleContentColumnCount = table
    .getVisibleLeafColumns()
    .filter((column) => column.id !== "__select__").length;

  return (
    <div className="rm-table-toolbar">
      {showSearch ? (
        <div className="rm-table-search">
          <Search aria-hidden size={14} />
          <Input
            aria-label={labels.search}
            onChange={(event) =>
              table.setGlobalFilter(event.currentTarget.value)
            }
            placeholder={labels.searchPlaceholder}
            value={globalFilter}
          />
        </div>
      ) : (
        <span />
      )}
      <div className="rm-table-view">
        {showExport ? (
          <IconButton
            aria-label={labels.exportCsv}
            className="rm-icon-button rm-table-view-btn"
            disabled={!canExport}
            onClick={onExport}
            title={labels.exportCsv}
            variant="ghost"
          >
            <Download aria-hidden size={15} />
          </IconButton>
        ) : null}
        <Popover
          align="end"
          className="rm-table-view-menu"
          trigger={
            <IconButton
              aria-label={labels.options}
              className="rm-icon-button rm-table-view-btn"
              variant="ghost"
            >
              <SlidersHorizontal aria-hidden size={15} />
            </IconButton>
          }
        >
          <div className="rm-table-view-label">{labels.density}</div>
          <div className="rm-segmented rm-table-density">
            <Button
              aria-pressed={density === "comfortable"}
              className={`rm-segmented-item ${density === "comfortable" ? "active" : ""}`}
              onClick={() => setDensity("comfortable")}
              size="sm"
              variant="ghost"
            >
              {labels.comfortable}
            </Button>
            <Button
              aria-pressed={density === "compact"}
              className={`rm-segmented-item ${density === "compact" ? "active" : ""}`}
              onClick={() => setDensity("compact")}
              size="sm"
              variant="ghost"
            >
              {labels.compact}
            </Button>
          </div>
          {clientPaginate ? (
            <>
              <label className="rm-table-view-label" htmlFor={pageSizeId}>
                {labels.rowsPerPage}
              </label>
              <NativeSelect
                id={pageSizeId}
                onChange={(event) =>
                  table.setPageSize(Number(event.currentTarget.value))
                }
                value={pageSize}
              >
                {tablePageSizes.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </NativeSelect>
            </>
          ) : null}
          {hideableColumns.length > 0 ? (
            <>
              <div className="rm-table-view-label">{labels.columns}</div>
              {hideableColumns.map((column) => (
                <label className="rm-table-view-col" key={column.id}>
                  <Checkbox
                    checked={column.getIsVisible()}
                    disabled={
                      column.getIsVisible() && visibleContentColumnCount <= 1
                    }
                    onCheckedChange={(checked) =>
                      column.toggleVisibility(checked === true)
                    }
                  />
                  <span>{column.columnDef.header as string}</span>
                </label>
              ))}
            </>
          ) : null}
          <Button
            className="rm-table-reset"
            onClick={onReset}
            size="sm"
            variant="outline"
          >
            {labels.resetView}
          </Button>
        </Popover>
      </div>
    </div>
  );
}
