import type { ColumnDef } from "@tanstack/react-table";

import type { DataTableLabels } from "./advanced-data-table-types";
import { Checkbox } from "./forms";

export function createSelectionColumn<T>({
  labels,
  rowAriaLabel,
}: {
  labels: Pick<DataTableLabels, "deselectRow" | "selectAllRows" | "selectRow">;
  rowAriaLabel: ((row: T) => string) | undefined;
}): ColumnDef<T, any> {
  return {
    id: "__select__",
    enableSorting: false,
    enableHiding: false,
    size: 36,
    header: ({ table }) => (
      <Checkbox
        aria-label={labels.selectAllRows}
        checked={
          table.getIsAllRowsSelected()
            ? true
            : table.getIsSomeRowsSelected()
              ? "indeterminate"
              : false
        }
        className="rm-table-select"
        name="row-selection-all"
        onCheckedChange={(checked) =>
          table.toggleAllRowsSelected(checked === true)
        }
      />
    ),
    cell: ({ row }) => {
      const rowName = rowAriaLabel?.(row.original).trim() || row.id;
      return (
        <Checkbox
          aria-label={`${row.getIsSelected() ? labels.deselectRow : labels.selectRow}: ${rowName}`}
          checked={row.getIsSelected()}
          className="rm-table-select"
          disabled={!row.getCanSelect()}
          name={`row-selection-${row.id}`}
          onCheckedChange={(checked) => row.toggleSelected(checked === true)}
        />
      );
    },
  };
}
