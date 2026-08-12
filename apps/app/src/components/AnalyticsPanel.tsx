import { Button, LinkButton, StatusBadge } from "@romeo/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import {
  exportAdminAnalyticsSummaryCsv,
  getAdminAnalyticsSummary,
} from "../features/admin-insights";
import type {
  AdminAnalyticsAttentionModel,
  AdminAnalyticsSummary,
  AdminAnalyticsToolSummaryRow,
  AdminAnalyticsUsageMetric,
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
import { Section, StatRow } from "./console";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";
import { DateRangeSelect } from "./DateRangeSelect";
import { PageActions } from "./PageActions";
import { rangeToBounds, type RangePreset } from "./date-range";

const toolCol = createColumnHelper<AdminAnalyticsToolSummaryRow>();
const usageCol = createColumnHelper<AdminAnalyticsUsageMetric>();
const attentionCol = createColumnHelper<AdminAnalyticsAttentionModel>();

interface AnalyticsSignalRow {
  detail?: string;
  id: string;
  label: string;
  tone: "danger" | "neutral" | "success" | "warning";
  value: number | string;
}

const signalCol = createColumnHelper<AnalyticsSignalRow>();

type Translate = (key: MessageKey) => string;

function analyticsWindow(range: RangePreset): { from?: string; to?: string } {
  const bounds = rangeToBounds(range, new Date());
  const query: { from?: string; to?: string } = {
    to: bounds.to.toISOString(),
  };
  if (bounds.from !== undefined) query.from = bounds.from.toISOString();
  return query;
}

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
  const [range, setRange] = useState<RangePreset>("7d");
  const summaryQuery = useQuery({
    queryKey: ["adminAnalyticsSummary", range],
    queryFn: () => getAdminAnalyticsSummary(analyticsWindow(range)),
    refetchInterval: 30_000,
  });
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string>();

  return (
    <Section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted">{t("analyticsTitle")}</div>
        <div className="flex flex-wrap gap-2">
          <DateRangeSelect onChange={setRange} value={range} />
          <Button
            disabled={isExporting || summaryQuery.data === undefined}
            onClick={() => void exportCsv()}
            type="button"
          >
            {isExporting ? t("analyticsExporting") : t("analyticsExportCsv")}
          </Button>
          <PageActions
            onRefresh={() => void summaryQuery.refetch()}
            refreshLabel={t("refresh")}
            refreshing={summaryQuery.isFetching}
          />
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
    </Section>
  );

  async function exportCsv() {
    setExportError(undefined);
    setIsExporting(true);
    try {
      const csv = await exportAdminAnalyticsSummaryCsv(analyticsWindow(range));
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
  const usageTotals = summary.usage.totals.filter(
    (metric) =>
      !metric.metric.startsWith("sse.") && metric.metric !== "queue.wait",
  );
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
  const usageColumns: ColumnDef<AdminAnalyticsUsageMetric, any>[] = [
    usageCol.accessor("metric", {
      header: t("analyticsMetric"),
      cell: (cell) => (
        <span className="rm-mono" translate="no">
          {cell.getValue()}
        </span>
      ),
    }),
    usageCol.accessor("quantity", {
      header: t("usageQuantity"),
      cell: (cell) => <LocalizedNumber value={cell.getValue()} />,
    }),
    usageCol.accessor("unit", {
      header: t("usageUnit"),
      cell: (cell) => <span className="text-muted">{cell.getValue()}</span>,
    }),
    usageCol.accessor("estimatedCostUsd", {
      header: t("analyticsEstimatedCost"),
      cell: (cell) => <LocalizedCurrency value={cell.getValue()} />,
    }),
  ];
  const attentionColumns: ColumnDef<AdminAnalyticsAttentionModel, any>[] = [
    attentionCol.accessor("displayName", {
      header: t("models"),
      cell: (cell) => <span className="font-medium">{cell.getValue()}</span>,
    }),
    attentionCol.accessor(
      (row) =>
        row.issues.map((issue) => t(modelIssueMessageKey(issue))).join(" · "),
      {
        id: "issues",
        header: t("modelNeedsAttention"),
        cell: (cell) => <span className="text-sm">{cell.getValue()}</span>,
      },
    ),
    attentionCol.display({
      id: "open",
      header: t("analyticsDetails"),
      cell: (cell) => (
        <LinkButton
          href={`/admin?section=providers&view=base-models&model=${encodeURIComponent(cell.row.original.modelId)}`}
          size="sm"
          variant="outline"
        >
          {t("analyticsOpenModel")}
        </LinkButton>
      ),
    }),
  ];

  return (
    <>
      <p className="mb-3 text-xs text-muted">{t("analyticsWindowNote")}</p>
      <StatRow
        items={[
          {
            label: t("analyticsStatus"),
            value: t(analyticsStatusMessageKey(summary.status)),
          },
          { label: t("usageRuns"), value: summary.usage.runsStarted },
          { label: t("usageTokens"), value: summary.usage.totalTokens },
          {
            label: t("analyticsEstimatedCost"),
            value: <LocalizedCurrency value={summary.usage.estimatedCostUsd} />,
          },
          { label: t("analyticsToolCalls"), value: summary.tools.totalCount },
        ]}
      />
      {summary.usage.unpricedTokenQuantity > 0 ? (
        <div className="rm-attention-note mt-3" role="status">
          <strong>
            {t("analyticsUnpricedTokens")} ·{" "}
            <LocalizedNumber value={summary.usage.unpricedTokenQuantity} />
          </strong>
          <p>{t("analyticsUnpricedHelp")}</p>
        </div>
      ) : null}
      <div className="mb-2 mt-3 text-xs font-medium text-muted">
        {t("modelNeedsAttention")}
      </div>
      {summary.attention.models.length === 0 ? (
        <p className="text-xs text-muted">{t("analyticsNoAttention")}</p>
      ) : (
        <>
          <div className="rm-attention-note mb-2" role="status">
            <strong>{t("modelNeedsAttention")}</strong>
            <p>{t("analyticsNeedsAttentionHelp")}</p>
          </div>
          <DataTable
            columns={attentionColumns}
            data={summary.attention.models}
            getRowId={(row) => row.modelId}
          />
        </>
      )}
      <div className="mb-2 mt-3 text-xs font-medium text-muted">
        {t("analyticsOperationalSignals")}
      </div>
      <DataTable
        columns={signalColumns}
        data={signals}
        getRowId={(row) => row.id}
      />
      <div className="mb-2 mt-3 text-xs font-medium text-muted">
        {t("analyticsUsageBreakdown")}
      </div>
      <DataTable
        columns={usageColumns}
        data={usageTotals}
        empty={t("analyticsNoUsageTotals")}
        getRowId={(row) => `${row.metric}:${row.unit}`}
      />
      <div className="mb-2 mt-3 text-xs font-medium text-muted">
        {t("analyticsEvalBreakdown")}
      </div>
      <StatRow
        items={[
          { label: t("analyticsEvalSuites"), value: summary.evals.suiteCount },
          {
            label: t("analyticsEvalRuns"),
            value: summary.evals.generatedRunCount,
          },
          {
            label: t("analyticsEvalStatus"),
            value: t(evalStatusMessageKey(summary.evals.status)),
          },
          {
            label: t("analyticsActivityEvents"),
            value: summary.usage.activityEventCount,
          },
          { label: t("analyticsUsageEvents"), value: summary.usage.eventCount },
        ]}
      />
      <div className="mb-2 mt-3 text-xs font-medium text-muted">
        {t("analyticsJobBreakdown")}
      </div>
      <StatRow
        items={[
          { label: t("analyticsJobsQueued"), value: summary.jobs.queued },
          { label: t("analyticsJobsRunning"), value: summary.jobs.running },
          { label: t("analyticsJobsCompleted"), value: summary.jobs.completed },
          { label: t("analyticsJobsFailed"), value: summary.jobs.failed },
          {
            label: t("analyticsJobsDeadLettered"),
            value: summary.jobs.deadLettered,
          },
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
        {summary.window.from ? (
          <>
            {" · "}
            <LocalizedDateTime value={summary.window.from} />
            {" – "}
            <LocalizedDateTime value={summary.window.to} />
          </>
        ) : null}
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

export function modelIssueMessageKey(
  issue: AdminAnalyticsAttentionModel["issues"][number],
): MessageKey {
  if (issue === "missing_pricing") return "modelIssueMissingPricing";
  if (issue === "invalid_context_window") return "modelIssueInvalidContext";
  if (issue === "missing_max_output") return "modelIssueMissingMaxOutput";
  return "modelIssueUnavailable";
}
