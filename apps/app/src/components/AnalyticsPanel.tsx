import { Button, StatusBadge } from "@romeo/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import {
  exportAdminAnalyticsSummaryCsv,
  getAdminAnalyticsSummary,
} from "../features/admin-insights";
import type {
  AdminAnalyticsSummary,
  AdminAnalyticsToolSummaryRow,
} from "../features/admin-insights";
import { downloadCsv } from "../lib/csv";
import { useLocale, type MessageKey } from "../lib/i18n";
import { PanelState } from "../lib/panel-state";
import { toast } from "../lib/toast";
import {
  LocalizedCurrency,
  LocalizedDateTime,
  LocalizedNumber,
} from "../lib/locale-format";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";
import { PanelStats } from "./PanelStats";

const toolCol = createColumnHelper<AdminAnalyticsToolSummaryRow>();

interface AnalyticsSignalRow {
  detail?: string;
  id: string;
  label: string;
  tone: "danger" | "neutral" | "success" | "warning";
  value: number | string;
}

const signalCol = createColumnHelper<AnalyticsSignalRow>();

type Translate = (key: MessageKey) => string;

function toolColumns(
  t: Translate,
): ColumnDef<AdminAnalyticsToolSummaryRow, any>[] {
  return [
    toolCol.accessor("toolId", {
      header: t("analyticsTool"),
      cell: (c) => (
        <span className="rm-mono font-medium" translate="no">
          {c.getValue()}
        </span>
      ),
    }),
    toolCol.accessor("totalCount", {
      header: t("analyticsTotal"),
      cell: (c) => (
        <span>
          <LocalizedNumber value={c.getValue()} />
        </span>
      ),
    }),
    toolCol.accessor("successCount", {
      header: t("analyticsSuccess"),
      cell: (c) => (
        <span>
          <LocalizedNumber value={c.getValue()} />
        </span>
      ),
    }),
    toolCol.accessor("failureCount", {
      header: t("analyticsFailure"),
      cell: (c) => (
        <span>
          <LocalizedNumber value={c.getValue()} />
        </span>
      ),
    }),
    toolCol.accessor("blockedCount", {
      header: t("analyticsBlocked"),
      cell: (c) => (
        <span className="rm-cell-muted">
          <LocalizedNumber value={c.getValue()} />
        </span>
      ),
    }),
    toolCol.accessor("pendingApprovalCount", {
      header: t("analyticsPendingApproval"),
      cell: (c) => (
        <span className="rm-cell-muted">
          <LocalizedNumber value={c.getValue()} />
        </span>
      ),
    }),
  ];
}

export function AnalyticsPanel() {
  const { t } = useLocale();
  const summaryQuery = useQuery({
    queryKey: ["adminAnalyticsSummary"],
    queryFn: getAdminAnalyticsSummary,
  });
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string>();

  return (
    <section className="rm-panel p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted">{t("analyticsTitle")}</div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={isExporting || summaryQuery.data === undefined}
            onClick={() => void exportCsv()}
            type="button"
          >
            {isExporting ? t("analyticsExporting") : t("analyticsExportCsv")}
          </Button>
          <Button
            disabled={summaryQuery.isFetching}
            onClick={() => void summaryQuery.refetch()}
            type="button"
          >
            {summaryQuery.isFetching ? t("refreshing") : t("refresh")}
          </Button>
        </div>
      </div>
      {exportError ? (
        <div className="rm-composer-error mb-3" role="alert">
          {exportError}
        </div>
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
        caught instanceof Error ? caught.message : t("analyticsUnableExport"),
      );
      toast(t("analyticsUnableExport"), "error");
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
  const { t } = useLocale();
  const tools = summary.tools.byTool;
  const signals: AnalyticsSignalRow[] = [
    {
      id: "evals",
      label: t("analyticsEvalStatus"),
      detail: `${summary.evals.suiteCount} ${t("analyticsEvalSuites")} · ${summary.evals.generatedRunCount} ${t("analyticsEvalRuns")}`,
      tone:
        summary.evals.status === "passed"
          ? "success"
          : summary.evals.status === "failed"
            ? "danger"
            : "warning",
      value: t(evalStatusMessageKey(summary.evals.status)),
    },
    {
      id: "tool-failures",
      label: t("analyticsToolFailures"),
      tone: summary.tools.failureCount > 0 ? "warning" : "success",
      value: summary.tools.failureCount,
    },
    {
      id: "provider-alerts",
      label: t("analyticsProviderAlerts"),
      tone: summary.providers.criticalAlertCount > 0 ? "danger" : "success",
      value: summary.providers.criticalAlertCount,
    },
    {
      id: "failed-jobs",
      label: t("analyticsJobsFailed"),
      tone: summary.jobs.failed > 0 ? "danger" : "success",
      value: summary.jobs.failed,
    },
  ];
  const signalColumns: ColumnDef<AnalyticsSignalRow, any>[] = [
    signalCol.accessor("label", {
      header: t("analyticsOperationalSignal"),
      cell: (cell) => <span className="font-medium">{cell.getValue()}</span>,
    }),
    signalCol.accessor("value", {
      header: t("analyticsCurrentValue"),
      cell: (cell) => (
        <StatusBadge tone={cell.row.original.tone}>
          {typeof cell.getValue() === "number" ? (
            <LocalizedNumber value={cell.getValue() as number} />
          ) : (
            cell.getValue()
          )}
        </StatusBadge>
      ),
    }),
    signalCol.accessor((row) => row.detail ?? "—", {
      id: "detail",
      header: t("analyticsDetails"),
      cell: (cell) => <span className="text-muted">{cell.getValue()}</span>,
    }),
  ];

  return (
    <>
      <PanelStats
        items={[
          {
            label: t("analyticsStatus"),
            value: t(analyticsStatusMessageKey(summary.status)),
          },
          {
            label: t("analyticsEstimatedCost"),
            value: <LocalizedCurrency value={summary.usage.estimatedCostUsd} />,
          },
          { label: t("analyticsUsageEvents"), value: summary.usage.eventCount },
          { label: t("analyticsToolCalls"), value: summary.tools.totalCount },
        ]}
      />
      <div className="mb-2 mt-3 text-xs font-medium text-muted">
        {t("analyticsOperationalSignals")}
      </div>
      <DataTable
        columns={signalColumns}
        data={signals}
        getRowId={(row) => row.id}
      />
      <div className="mb-2 mt-3 text-xs font-medium text-muted">
        {t("analyticsToolBreakdown")}
      </div>
      <DataTable
        columns={toolColumns(t)}
        data={tools}
        empty={t("analyticsNoToolActivity")}
      />
      <div className="mt-3 text-xs text-muted">
        {t("analyticsGenerated")}{" "}
        <LocalizedDateTime value={summary.generatedAt} />
      </div>
    </>
  );
}

function analyticsStatusMessageKey(
  status: AdminAnalyticsSummary["status"],
): MessageKey {
  if (status === "healthy") return "analyticsHealthy";
  if (status === "degraded") return "analyticsDegraded";
  return "analyticsCritical";
}

function evalStatusMessageKey(
  status: AdminAnalyticsSummary["evals"]["status"],
): MessageKey {
  if (status === "passed") return "evalStatusPassed";
  if (status === "failed") return "evalStatusFailed";
  if (status === "not_required") return "evalStatusNotRequired";
  return "evalStatusMissing";
}
