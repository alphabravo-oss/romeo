import type { Table } from "@tanstack/react-table";
import Download from "lucide-react/dist/esm/icons/download.mjs";
import Search from "lucide-react/dist/esm/icons/search.mjs";
import SlidersHorizontal from "lucide-react/dist/esm/icons/sliders-horizontal.mjs";
import Trash2 from "lucide-react/dist/esm/icons/trash-2.mjs";
import { useId, useState, type Dispatch, type SetStateAction } from "react";

import type { DataTableLabels } from "./advanced-data-table";
import { Button, IconButton } from "./button";
import { Checkbox, Input, NativeSelect } from "./forms";
import { Popover } from "./overlays";
import {
  tablePageSizes,
  type TableDensity,
  type TableSavedView,
} from "./table-preferences";

export function DataTableControls<T>({
  canExport,
  showPageSize,
  density,
  globalFilter,
  labels,
  onExport,
  onApplySavedView,
  onDeleteSavedView,
  onReset,
  onSaveView,
  pageSize,
  setDensity,
  savedViews,
  showExport,
  showSearch,
  table,
}: {
  canExport: boolean;
  showPageSize: boolean;
  density: TableDensity;
  globalFilter: string;
  labels: DataTableLabels;
  onExport: () => void;
  onApplySavedView: (view: TableSavedView) => void;
  onDeleteSavedView: (name: string) => void;
  onReset: () => void;
  onSaveView: (name: string) => void;
  pageSize: number;
  setDensity: Dispatch<SetStateAction<TableDensity>>;
  savedViews: TableSavedView[];
  showExport: boolean;
  showSearch: boolean;
  table: Table<T>;
}) {
  const pageSizeId = useId();
  const [viewName, setViewName] = useState("");
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
      {/* How many rows you are looking at, stated before the view controls.
          Without it a filtered grid gives no sense of how much it removed. */}
      <span className="rm-table-count">
        {table.getFilteredRowModel().rows.length} {labels.results}
      </span>
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
          {showPageSize ? (
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
          <div className="rm-table-view-label">{labels.savedViews}</div>
          <div className="rm-table-saved-view-create">
            <Input
              aria-label={labels.viewName}
              maxLength={80}
              onChange={(event) => setViewName(event.currentTarget.value)}
              placeholder={labels.viewName}
              value={viewName}
            />
            <Button
              disabled={viewName.trim().length === 0}
              onClick={() => {
                onSaveView(viewName.trim());
                setViewName("");
              }}
              size="sm"
              variant="outline"
            >
              {labels.saveView}
            </Button>
          </div>
          {savedViews.length > 0 ? (
            <div className="rm-table-saved-views">
              {savedViews.map((view) => (
                <div className="rm-table-saved-view" key={view.name}>
                  <Button
                    className="rm-table-saved-view-name"
                    onClick={() => onApplySavedView(view)}
                    size="sm"
                    variant="ghost"
                  >
                    {view.name}
                  </Button>
                  <IconButton
                    aria-label={`${labels.deleteView}: ${view.name}`}
                    onClick={() => onDeleteSavedView(view.name)}
                    variant="ghost"
                  >
                    <Trash2 aria-hidden size={13} />
                  </IconButton>
                </div>
              ))}
            </div>
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
