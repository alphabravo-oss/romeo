import { Button } from "@romeo/ui";
import { useQuery } from "@tanstack/react-query";

import { listToolCalls } from "../features/tools";
import type { ToolCallRecord } from "../features/tools";
import { useLocale } from "../lib/i18n";
import { PanelState } from "../lib/panel-state";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";

const col = createColumnHelper<ToolCallRecord>();

export function ToolTracePanel({
  activeAgentId,
}: {
  activeAgentId: string | undefined;
}) {
  const { t } = useLocale();
  const callsQuery = useQuery({
    queryKey: ["toolCalls", activeAgentId],
    queryFn: () => listToolCalls(activeAgentId),
    enabled: activeAgentId !== undefined,
  });

  if (activeAgentId === undefined) {
    return (
      <section className="rm-panel p-4">
        <div className="rm-card-header">
          <div className="text-sm text-muted">{t("toolTraceCalls")}</div>
        </div>
        <div className="rm-empty">{t("toolTraceSelectAgent")}</div>
      </section>
    );
  }

  const columns: ColumnDef<ToolCallRecord, any>[] = [
    col.accessor("toolId", {
      header: t("toolTraceTool"),
      cell: (c) => <span className="font-medium">{c.getValue()}</span>,
    }),
    col.accessor("status", {
      header: t("status"),
      cell: (c) => {
        const status = c.getValue();
        const tone =
          status === "success"
            ? "pass"
            : status === "failure" || status === "blocked"
              ? "fail"
              : "warn";
        return <span className={`rm-status ${tone}`}>{status}</span>;
      },
    }),
    col.accessor((row) => row.inputKeys.join(", ") || t("toolTraceNoneValue"), {
      id: "input",
      header: t("toolTraceInput"),
      cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>,
    }),
    col.accessor(
      (row) =>
        (row.outputKeys.join(", ") || row.errorCode) ?? t("toolTraceNoneValue"),
      {
        id: "output",
        header: t("toolTraceOutput"),
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>,
      },
    ),
    col.accessor("runId", {
      header: t("toolTraceRun"),
      cell: (c) => (
        <span className="rm-cell-muted rm-mono">{c.getValue() ?? "-"}</span>
      ),
    }),
  ];

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-header">
        <div className="text-sm text-muted">{t("toolTraceCalls")}</div>
        <Button
          disabled={callsQuery.isFetching || activeAgentId === undefined}
          onClick={() => void callsQuery.refetch()}
          type="button"
        >
          {callsQuery.isFetching ? t("refreshing") : t("refresh")}
        </Button>
      </div>
      <PanelState query={callsQuery} empty={t("toolTraceNone")}>
        {(calls) => (
          <DataTable
            columns={columns}
            data={calls}
            empty={t("toolTraceNone")}
          />
        )}
      </PanelState>
    </section>
  );
}
