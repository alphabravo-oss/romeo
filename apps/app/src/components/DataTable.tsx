import {
  DataTable as SharedDataTable,
  createColumnHelper,
  type ColumnDef,
  type DataTableLabels,
  type DataTableProps,
  type ServerPagination,
  type ServerTableState,
} from "@romeo/ui";
import { lazy, Suspense } from "react";
import { formatNumber } from "../lib/locale-format";
import { useLocale } from "../lib/i18n";
import { useOptionalWorkspace } from "./WorkspaceContext";

const AuthoritativeDataTable = lazy(async () => ({
  default: (await import("./AuthoritativeDataTable")).AuthoritativeDataTable,
}));

export { createColumnHelper };
export type { ColumnDef, ServerPagination, ServerTableState };

export function DataTable<T>(
  props: Omit<DataTableProps<T>, "formatNumber" | "labels">,
) {
  const { locale, t } = useLocale();
  const workspaceId = useOptionalWorkspace()?.workspaceId;
  const labels: DataTableLabels = {
    approximate: t("tableApproximate"),
    bulkActions: t("tableBulkActions"),
    columns: t("tableColumns"),
    comfortable: t("tableComfortable"),
    compact: t("tableCompact"),
    density: t("tableDensity"),
    defaultExportFileName: contextualTableFilename(t("tableExportFileStem")),
    error: t("tableError"),
    exportCsv: t("tableExportCsv"),
    loading: t("tableLoading"),
    nextPage: t("tableNextPage"),
    noMatches: t("tableNoMatches"),
    noRecords: t("tableNoRecords"),
    of: t("tableOf"),
    options: t("tableOptions"),
    operationFailed: t("tableOperationFailed"),
    page: t("tablePage"),
    previousPage: t("tablePreviousPage"),
    resetView: t("tableResetView"),
    retry: t("tableRetry"),
    results: t("tableResults"),
    rowsPerPage: t("tableRowsPerPage"),
    search: t("tableSearch"),
    searchPlaceholder: t("tableSearchPlaceholder"),
    selectAllRows: t("tableSelectAllRows"),
    selected: t("tableSelected"),
    selectRow: t("tableSelectRow"),
    shown: t("tableShown"),
    savedViews: t("tableSavedViews"),
    saveView: t("tableSaveView"),
    viewName: t("tableViewName"),
    deleteView: t("tableDeleteView"),
    deselectRow: t("tableDeselectRow"),
    total: t("tableTotal"),
    defaultView: t("tableDefaultView"),
    shareView: t("tableShareView"),
    unshareView: t("tableUnshareView"),
    serverAuthorityUnavailable: t("tableServerAuthorityUnavailable"),
    undo: t("undo"),
    viewDeleted: t("tableViewDeleted"),
  };
  const exportFileName =
    props.exportFileName === undefined
      ? labels.defaultExportFileName
      : props.exportFileName;
  const table = (
    <SharedDataTable
      {...props}
      exportFileName={exportFileName}
      formatNumber={(value) => formatNumber(value, locale)}
      labels={labels}
    />
  );
  const authorityScope = props.serverState?.authorityScope;
  if (authorityScope === undefined) return table;
  return (
    <Suspense fallback={table}>
      <AuthoritativeDataTable
        authorityScope={authorityScope}
        workspaceId={workspaceId}
      >
        {table}
      </AuthoritativeDataTable>
    </Suspense>
  );
}

function contextualTableFilename(localizedStem: string): string {
  if (typeof location === "undefined") return `${localizedStem}.csv`;
  const params = new URLSearchParams(location.search);
  const routeName =
    params.get("section") ??
    location.pathname.split("/").filter(Boolean).at(-1) ??
    localizedStem;
  const context = routeName
    .normalize("NFKC")
    .replace(/[^a-z0-9_-]+/giu, "-")
    .replace(/^-+|-+$/gu, "")
    .toLowerCase();
  return `romeo-${context || localizedStem}-${new Date().toISOString().slice(0, 10)}.csv`;
}
