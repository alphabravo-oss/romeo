import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import {
  exportAdminAnalyticsSummaryCsv,
  getAdminAnalyticsSummary,
} from "../api/analytics-client";
import type {
  AdminAnalyticsSummary,
  AdminAnalyticsToolSummaryRow,
} from "../api/analytics-types";
import { downloadCsv } from "../lib/csv";
import { PanelState } from "../lib/panel-state";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";
import { PanelStats } from "./PanelStats";

const toolCol = createColumnHelper<AdminAnalyticsToolSummaryRow>();

const toolColumns: ColumnDef<AdminAnalyticsToolSummaryRow, any>[] = [
  toolCol.accessor("toolId", {
    header: "Tool",
    cell: (c) => <span className="rm-mono font-medium">{c.getValue()}</span>,
  }),
  toolCol.accessor("totalCount", {
    header: "Total",
    cell: (c) => <span>{c.getValue()}</span>,
  }),
  toolCol.accessor("successCount", {
    header: "Success",
    cell: (c) => <span>{c.getValue()}</span>,
  }),
  toolCol.accessor("failureCount", {
    header: "Failure",
    cell: (c) => <span>{c.getValue()}</span>,
  }),
  toolCol.accessor("blockedCount", {
    header: "Blocked",
    cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>,
  }),
  toolCol.accessor("pendingApprovalCount", {
    header: "Pending approval",
    cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>,
  }),
];

export function AnalyticsPanel() {
  const summaryQuery = useQuery({
    queryKey: ["adminAnalyticsSummary"],
    queryFn: getAdminAnalyticsSummary,
  });
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string>();

  return (
    <section className="rm-panel p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted">Analytics</div>
        <div className="flex flex-wrap gap-2">
          <button
            className="rm-button"
            disabled={isExporting || summaryQuery.data === undefined}
            onClick={() => void exportCsv()}
            type="button"
          >
            {isExporting ? "Exporting" : "Export CSV"}
          </button>
          <button
            className="rm-button"
            disabled={summaryQuery.isFetching}
            onClick={() => void summaryQuery.refetch()}
            type="button"
          >
            {summaryQuery.isFetching ? "Refreshing" : "Refresh"}
          </button>
        </div>
      </div>
      {exportError ? (
        <div className="mb-3 text-sm text-red-300">{exportError}</div>
      ) : null}
      <PanelState query={summaryQuery} isEmpty={() => false}>
        {(summary) => <AnalyticsSummaryView summary={summary} />}
      </PanelState>
    </section>
  );

  async function exportCsv() {
    setExportError(undefined);
    setIsExporting(true);
    try {
      const csv = await exportAdminAnalyticsSummaryCsv();
      downloadCsv(csv, "romeo-admin-analytics-summary.csv");
    } catch (caught) {
      setExportError(
        caught instanceof Error
          ? caught.message
          : "Unable to export analytics summary.",
      );
    } finally {
      setIsExporting(false);
    }
  }
}

function AnalyticsSummaryView({
  summary,
}: {
  summary: AdminAnalyticsSummary;
}): React.ReactNode {
  const tools = summary.tools.byTool;

  return (
    <>
      <PanelStats
        items={[
          { label: "Status", value: summary.status },
          { label: "Eval status", value: summary.evals.status },
          { label: "Eval suites", value: summary.evals.suiteCount },
          { label: "Eval runs", value: summary.evals.generatedRunCount },
          {
            label: "Est. cost",
            value: formatUsd(summary.usage.estimatedCostUsd),
          },
          { label: "Usage events", value: summary.usage.eventCount },
          { label: "Tool calls", value: summary.tools.totalCount },
          { label: "Tool failures", value: summary.tools.failureCount },
          {
            label: "Provider alerts",
            value: summary.providers.criticalAlertCount,
          },
          { label: "Jobs failed", value: summary.jobs.failed },
        ]}
      />
      <div className="mb-2 mt-3 text-xs font-medium text-muted">
        Tool breakdown
      </div>
      <DataTable
        columns={toolColumns}
        data={tools}
        empty="No tool activity yet."
      />
      <div className="mt-3 text-xs text-muted">
        Generated {new Date(summary.generatedAt).toLocaleString()}
      </div>
    </>
  );
}

function formatUsd(value: number): string {
  return `$${value.toFixed(6)}`;
}
