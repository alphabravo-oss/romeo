import {
  DataTable as SharedDataTable,
  createColumnHelper,
  type ColumnDef,
  type DataTableLabels,
  type DataTableProps,
  type ServerPagination,
} from "@romeo/ui";
import { formatNumber } from "../lib/locale-format";
import { useLocale } from "../lib/i18n";

export { createColumnHelper };
export type { ColumnDef, ServerPagination };

export function DataTable<T>(
  props: Omit<DataTableProps<T>, "formatNumber" | "labels">,
) {
  const { locale, t } = useLocale();
  const labels: DataTableLabels = {
    columns: t("tableColumns"),
    comfortable: t("tableComfortable"),
    compact: t("tableCompact"),
    density: t("tableDensity"),
    loading: t("tableLoading"),
    nextPage: t("tableNextPage"),
    noMatches: t("tableNoMatches"),
    noRecords: t("tableNoRecords"),
    of: t("tableOf"),
    options: t("tableOptions"),
    previousPage: t("tablePreviousPage"),
    search: t("tableSearch"),
    searchPlaceholder: t("tableSearchPlaceholder"),
    selectAllRows: t("tableSelectAllRows"),
    selected: t("tableSelected"),
    selectRow: t("tableSelectRow"),
    shown: t("tableShown"),
  };
  return (
    <SharedDataTable
      {...props}
      formatNumber={(value) => formatNumber(value, locale)}
      labels={labels}
    />
  );
}
