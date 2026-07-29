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
    exportCsv: t("tableExportCsv"),
    loading: t("tableLoading"),
    nextPage: t("tableNextPage"),
    noMatches: t("tableNoMatches"),
    noRecords: t("tableNoRecords"),
    of: t("tableOf"),
    options: t("tableOptions"),
    page: t("tablePage"),
    previousPage: t("tablePreviousPage"),
    resetView: t("tableResetView"),
    results: t("tableResults"),
    rowsPerPage: t("tableRowsPerPage"),
    search: t("tableSearch"),
    searchPlaceholder: t("tableSearchPlaceholder"),
    selectAllRows: t("tableSelectAllRows"),
    selected: t("tableSelected"),
    selectRow: t("tableSelectRow"),
    shown: t("tableShown"),
    total: t("tableTotal"),
  };
  const exportFileName =
    props.exportFileName === undefined
      ? contextualTableFilename()
      : props.exportFileName;
  return (
    <SharedDataTable
      {...props}
      exportFileName={exportFileName}
      formatNumber={(value) => formatNumber(value, locale)}
      labels={labels}
    />
  );
}

function contextualTableFilename(): string {
  if (typeof location === "undefined") return "romeo-table.csv";
  const params = new URLSearchParams(location.search);
  const routeName =
    params.get("section") ??
    location.pathname.split("/").filter(Boolean).at(-1) ??
    "table";
  const context = routeName
    .normalize("NFKC")
    .replace(/[^a-z0-9_-]+/giu, "-")
    .replace(/^-+|-+$/gu, "")
    .toLowerCase();
  return `romeo-${context || "table"}-${new Date().toISOString().slice(0, 10)}.csv`;
}
