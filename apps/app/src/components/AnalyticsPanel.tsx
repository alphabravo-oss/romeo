import { Button } from "@romeo/ui";
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

type Translate = (key: MessageKey) => string;

function toolColumns(
  t: Translate,
): ColumnDef<AdminAnalyticsToolSummaryRow, any>[] {
  return [
    toolCol.accessor("toolId", {
      header: t("analyticsTool"),
      cell: (c) => <span className="rm-mono font-medium">{c.getValue()}</span>,
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

  return (
    <>
      <PanelStats
        items={[
          {
            label: t("analyticsStatus"),
            value: t(analyticsStatusMessageKey(summary.status)),
          },
          {
            label: t("analyticsEvalStatus"),
            value: t(evalStatusMessageKey(summary.evals.status)),
          },
          { label: t("analyticsEvalSuites"), value: summary.evals.suiteCount },
          {
            label: t("analyticsEvalRuns"),
            value: summary.evals.generatedRunCount,
          },
          {
            label: t("analyticsEstimatedCost"),
            value: <LocalizedCurrency value={summary.usage.estimatedCostUsd} />,
          },
          { label: t("analyticsUsageEvents"), value: summary.usage.eventCount },
          { label: t("analyticsToolCalls"), value: summary.tools.totalCount },
          {
            label: t("analyticsToolFailures"),
            value: summary.tools.failureCount,
          },
          {
            label: t("analyticsProviderAlerts"),
            value: summary.providers.criticalAlertCount,
          },
          { label: t("analyticsJobsFailed"), value: summary.jobs.failed },
        ]}
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
