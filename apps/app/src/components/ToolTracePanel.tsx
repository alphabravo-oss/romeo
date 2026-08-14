import { useQuery } from "@tanstack/react-query";

import { toolCallsQueryOptions } from "../features/tools";
import type { ToolCallRecord } from "../features/tools";
import { useLocale } from "../lib/i18n";
import { PanelState } from "../lib/panel-state";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";
import { PageActions } from "./PageActions";
import { Section } from "./console";
import { useInventoriedServerTable } from "../lib/inventoried-server-table";

const col = createColumnHelper<ToolCallRecord>();

export function ToolTracePanel({
  activeAgentId,
}: {
  activeAgentId: string | undefined;
}) {
  const { t } = useLocale();
  const inventoriedTable = useInventoriedServerTable<any>("tool_trace_calls");
  const callsQuery = useQuery(toolCallsQueryOptions(activeAgentId));

  if (activeAgentId === undefined) {
    return (
      <Section
        description={t("toolTraceSelectAgent")}
        title={t("toolTraceCalls")}
      >
        <p className="rm-list-empty">{t("toolTraceSelectAgent")}</p>
      </Section>
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
    <Section
      actions={
        <PageActions
          onRefresh={() => void callsQuery.refetch()}
          refreshLabel={t("refresh")}
          refreshing={callsQuery.isFetching || activeAgentId === undefined}
        />
      }
      title={t("toolTraceCalls")}
    >
      <PanelState query={callsQuery} empty={t("toolTraceNone")}>
        {(calls) => (
          <DataTable
            serverState={inventoriedTable.serverState}
            columns={columns}
            data={inventoriedTable.rows}
            empty={t("toolTraceNone")}
          />
        )}
      </PanelState>
    </Section>
  );
}
