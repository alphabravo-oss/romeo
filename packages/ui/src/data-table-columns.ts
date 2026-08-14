import type { ColumnDef } from "@tanstack/react-table";

export function columnPreferenceIds<T>(
  columns: readonly ColumnDef<T, any>[],
  includeDisplay: boolean,
): string[] {
  return columns.flatMap((column) => {
    if ("columns" in column && Array.isArray(column.columns)) {
      return columnPreferenceIds(column.columns, includeDisplay);
    }
    if ("accessorKey" in column && column.accessorKey !== undefined) {
      return [String(column.accessorKey)];
    }
    return column.id !== undefined && (includeDisplay || "accessorFn" in column)
      ? [column.id]
      : [];
  });
}
