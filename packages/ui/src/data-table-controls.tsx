import type { Table } from "@tanstack/react-table";
import Download from "lucide-react/dist/esm/icons/download.mjs";
import Search from "lucide-react/dist/esm/icons/search.mjs";
import SlidersHorizontal from "lucide-react/dist/esm/icons/sliders-horizontal.mjs";
import Trash2 from "lucide-react/dist/esm/icons/trash-2.mjs";
import Star from "lucide-react/dist/esm/icons/star.mjs";
import Users from "lucide-react/dist/esm/icons/users.mjs";
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
  authorityError,
  authorityPending,
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
  onSetDefaultView,
  onSetViewVisibility,
  onUndoDeleteSavedView,
  pageSize,
  setDensity,
  savedViews,
  pendingDeletedView,
  showExport,
  showSearch,
  table,
}: {
  authorityError: string | undefined;
  authorityPending: boolean;
  canExport: boolean;
  showPageSize: boolean;
  density: TableDensity;
  globalFilter: string;
  labels: DataTableLabels;
  onExport: () => void;
  onApplySavedView: (view: TableSavedView) => void;
  onDeleteSavedView: (view: TableSavedView) => void;
  onReset: () => void;
  onSaveView: (name: string) => Promise<void>;
  onSetDefaultView: (view: TableSavedView, isDefault: boolean) => void;
  onSetViewVisibility: (
    view: TableSavedView,
    visibility: "private" | "workspace",
  ) => void;
  onUndoDeleteSavedView: () => void;
  pageSize: number;
  setDensity: Dispatch<SetStateAction<TableDensity>>;
  savedViews: TableSavedView[];
  pendingDeletedView: TableSavedView | undefined;
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
    <div
      aria-label={labels.options}
      className="rm-table-toolbar"
      role="toolbar"
    >
      {authorityError === undefined ? null : (
        <div className="rm-table-authority-error" role="alert">
          {authorityError}
        </div>
      )}
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
                <Checkbox
                  checked={column.getIsVisible()}
                  className="rm-table-view-col"
                  disabled={
                    column.getIsVisible() && visibleContentColumnCount <= 1
                  }
                  key={column.id}
                  label={column.columnDef.header as string}
                  onCheckedChange={(checked) =>
                    column.toggleVisibility(checked === true)
                  }
                />
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
              disabled={viewName.trim().length === 0 || authorityPending}
              onClick={() => {
                void onSaveView(viewName.trim()).then(() => setViewName(""));
              }}
              pending={authorityPending}
              size="sm"
              variant="outline"
            >
              {labels.saveView}
            </Button>
          </div>
          {savedViews.length > 0 ? (
            <div className="rm-table-saved-views">
              {savedViews.map((view) => (
                <div className="rm-table-saved-view" key={view.id ?? view.name}>
                  <Button
                    className="rm-table-saved-view-name"
                    onClick={() => onApplySavedView(view)}
                    size="sm"
                    variant="ghost"
                  >
                    {view.name}
                  </Button>
                  {view.canEdit === false ? null : (
                    <>
                      {view.source === "server" ? (
                        <>
                          <IconButton
                            aria-label={`${labels.defaultView}: ${view.name}`}
                            aria-pressed={view.isDefault === true}
                            disabled={authorityPending}
                            onClick={() =>
                              onSetDefaultView(view, view.isDefault !== true)
                            }
                            variant="ghost"
                          >
                            <Star aria-hidden size={13} />
                          </IconButton>
                          <IconButton
                            aria-label={`${view.visibility === "workspace" ? labels.unshareView : labels.shareView}: ${view.name}`}
                            aria-pressed={view.visibility === "workspace"}
                            disabled={authorityPending}
                            onClick={() =>
                              onSetViewVisibility(
                                view,
                                view.visibility === "workspace"
                                  ? "private"
                                  : "workspace",
                              )
                            }
                            variant="ghost"
                          >
                            <Users aria-hidden size={13} />
                          </IconButton>
                        </>
                      ) : null}
                      <IconButton
                        aria-label={`${labels.deleteView}: ${view.name}`}
                        disabled={authorityPending}
                        onClick={() => onDeleteSavedView(view)}
                        variant="ghost"
                      >
                        <Trash2 aria-hidden size={13} />
                      </IconButton>
                    </>
                  )}
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
      {pendingDeletedView === undefined ? null : (
        <div aria-live="polite" className="rm-table-delete-undo" role="status">
          <span>{labels.viewDeleted}</span>
          <Button onClick={onUndoDeleteSavedView} size="sm" variant="outline">
            {labels.undo}
          </Button>
        </div>
      )}
    </div>
  );
}
