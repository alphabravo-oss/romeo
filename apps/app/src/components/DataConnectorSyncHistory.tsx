import type { DataConnectorSync } from "../features/types";
import { useLocale, type MessageKey } from "../lib/i18n";
import { LocalizedDateTime, LocalizedNumber } from "../lib/locale-format";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";
import { useInventoriedServerTable } from "../lib/inventoried-server-table";

const col = createColumnHelper<DataConnectorSync>();

type Translate = (key: MessageKey) => string;

function syncColumns(t: Translate): ColumnDef<DataConnectorSync, any>[] {
  return [
    col.accessor("startedAt", {
      header: t("connectorSyncStarted"),
      cell: (c) => (
        <span className="rm-cell-muted">
          <LocalizedDateTime value={c.getValue()} />
        </span>
      ),
    }),
    col.accessor((row) => row.completedAt, {
      id: "finished",
      header: t("connectorSyncFinished"),
      cell: (c) => (
        <span className="rm-cell-muted">
          {c.getValue() ? (
            <LocalizedDateTime value={c.getValue()!} />
          ) : (
            t("connectorSyncRunning")
          )}
        </span>
      ),
    }),
    col.accessor("status", {
      header: t("connectorSyncStatus"),
      cell: (c) => (
        <span
          className={`rm-status ${c.getValue() === "completed" ? "pass" : c.getValue() === "failed" ? "fail" : "warn"}`}
        >
          {c.getValue() === "completed"
            ? t("connectorSyncCompleted")
            : c.getValue() === "failed"
              ? t("connectorSyncStatusFailed")
              : t("connectorSyncRunning")}
        </span>
      ),
    }),
    col.accessor("itemCount", {
      header: t("connectorSyncItems"),
      cell: (c) => (
        <span className="rm-mono">
          <LocalizedNumber value={c.getValue()} />
        </span>
      ),
    }),
    col.accessor(
      (row) => (row.errorCode ? connectorErrorLabel(row.errorCode, t) : ""),
      {
        id: "message",
        header: t("connectorSyncMessage"),
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>,
      },
    ),
  ];
}

export function DataConnectorSyncHistory({
  syncs,
}: {
  syncs: DataConnectorSync[];
}) {
  const { t } = useLocale();
  const inventoriedTable = useInventoriedServerTable<DataConnectorSync>(
    "data_connector_sync_runs",
    {
      enabled: syncs[0]?.connectorId !== undefined,
      parentId: syncs[0]?.connectorId,
    },
  );
  const latestFailure = syncs.find((sync) => sync.status === "failed");
  return (
    <div className="mt-3 grid gap-2 text-xs">
      {latestFailure ? (
        <div className="rounded-md border border-red-300 bg-red-50 p-2 text-red-900">
          <div className="font-medium">{t("connectorSyncLatestFailed")}</div>
          <div>{connectorErrorLabel(latestFailure.errorCode, t)}</div>
          {latestFailure.errorCode ? (
            <div className="break-words text-red-700">
              {latestFailure.errorCode}
            </div>
          ) : null}
        </div>
      ) : null}

      <DataTable
        serverState={inventoriedTable.serverState}
        columns={syncColumns(t)}
        data={inventoriedTable.rows}
        empty={t("connectorSyncNone")}
      />
    </div>
  );
}

function connectorErrorLabel(code: string | undefined, t: Translate): string {
  if (code === "connector_execution_disabled")
    return t("connectorSyncExecutionDisabled");
  if (code === "connector_egress_host_blocked")
    return t("connectorSyncHostBlocked");
  if (code === "connector_response_too_large")
    return t("connectorSyncResponseTooLarge");
  if (code === "private_network_host_blocked")
    return t("connectorSyncPrivateHost");
  return t("connectorSyncIncomplete");
}
