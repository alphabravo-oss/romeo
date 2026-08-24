import { Button, StatusBadge } from "@romeo/ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  usageAlertsQueryOptions,
  usageSummaryQueryOptions,
} from "../features/operational-governance/query-options";
import { exportUsageEventsCsv } from "../features/operational-governance/queries";
import { usageMetricDefinitionsQueryOptions } from "../features/operational-governance/usage-metric-query-options";
import type {
  UsageAlert,
  UsageEvent,
  UsageSummaryMetric,
} from "../features/operational-governance/types";
import { downloadCsv } from "../lib/csv";
import { useLocale, type MessageKey } from "../lib/i18n";
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
import { safeUserErrorMessage } from "../lib/safe-user-error";
import { UsageMetricCatalogSection } from "./UsageMetricCatalog";
import { useInventoriedServerTable } from "../lib/inventoried-server-table";

const alertCol = createColumnHelper<UsageAlert>();

type Translate = (key: MessageKey) => string;

function alertColumns(t: Translate): ColumnDef<UsageAlert, any>[] {
  return [
    alertCol.accessor("severity", {
      header: t("usageSeverity"),
      cell: (c) => (
        <StatusBadge
          tone={
            c.getValue() === "warning"
              ? "warning"
              : c.getValue() === "critical"
                ? "danger"
                : "danger"
          }
        >
          {t(usageSeverityMessageKey(c.getValue()))}
        </StatusBadge>
      ),
    }),
    alertCol.accessor("metric", {
      header: t("usageMetric"),
      cell: (c) => <MetricLabel metric={c.getValue()} t={t} />,
    }),
    alertCol.accessor("percentUsed", {
      id: "percentUsed",
      header: t("usagePercentUsed"),
      cell: (c) => (
        <span>
          <LocalizedNumber
            options={{ style: "percent", maximumFractionDigits: 0 }}
            value={c.getValue()}
          />
        </span>
      ),
    }),
    alertCol.accessor((row) => `${row.scopeType}:${row.scopeId}`, {
      id: "scope",
      header: t("usageScope"),
      cell: (c) => (
        <span className="rm-cell-muted rm-mono" translate="no">
          {c.getValue()}
        </span>
      ),
    }),
  ];
}

const totalCol = createColumnHelper<UsageSummaryMetric>();

function totalColumns(t: Translate): ColumnDef<UsageSummaryMetric, any>[] {
  return [
    totalCol.accessor("metric", {
      header: t("usageMetric"),
      cell: (c) => <MetricLabel metric={c.getValue()} t={t} />,
    }),
    totalCol.accessor("quantity", {
      header: t("usageQuantity"),
      cell: (c) => (
        <span>
          <LocalizedNumber value={c.getValue()} />
        </span>
      ),
    }),
    totalCol.accessor("unit", {
      header: t("usageUnit"),
      cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>,
    }),
    totalCol.accessor("estimatedCostUsd", {
      header: t("usageEstimatedCost"),
      cell: (c) => (
        <span className="rm-cell-muted">
          {c.getValue() > 0 ? <LocalizedCurrency value={c.getValue()} /> : "-"}
        </span>
      ),
    }),
  ];
}

const eventCol = createColumnHelper<UsageEvent>();

function eventColumns(t: Translate): ColumnDef<UsageEvent, any>[] {
  return [
    eventCol.accessor("createdAt", {
      header: t("usageTime"),
      cell: (c) => (
        <span className="rm-cell-muted">
          <LocalizedDateTime value={c.getValue()} />
        </span>
      ),
    }),
    eventCol.accessor("metric", {
      header: t("usageMetric"),
      cell: (c) => <MetricLabel metric={c.getValue()} t={t} />,
    }),
    eventCol.accessor("quantity", {
      header: t("usageQuantity"),
      cell: (c) => (
        <span>
          <LocalizedNumber value={c.getValue()} />
        </span>
      ),
    }),
    eventCol.accessor("unit", {
      header: t("usageUnit"),
      cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>,
    }),
    eventCol.accessor("sourceType", {
      header: t("usageSource"),
      cell: (c) => (
        <span className="rm-cell-muted">
          {t(usageSourceMessageKey(c.getValue()))}
        </span>
      ),
    }),
  ];
}

export function UsagePanel() {
  const { t } = useLocale();
  const [range, setRange] = useState<RangePreset>("7d");
  const interval = useMemo(() => {
    const bounds = rangeToBounds(range, new Date());
    return {
      ...(bounds.from === undefined ? {} : { from: bounds.from.toISOString() }),
      to: bounds.to.toISOString(),
    };
  }, [range]);
  const inventoriedTable = useInventoriedServerTable("usage_events", {
    filters: [
      ...(interval.from === undefined
        ? []
        : [
            {
              field: "createdAt" as const,
              operator: "gte" as const,
              value: interval.from,
            },
          ]),
      { field: "createdAt", operator: "lt", value: interval.to },
    ],
  });
  const summaryQuery = useQuery(usageSummaryQueryOptions(interval));
  const alertsQuery = useQuery(usageAlertsQueryOptions());
  const metricDefinitionsQuery = useQuery(usageMetricDefinitionsQueryOptions());
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string>();
  const alerts = alertsQuery.data ?? [];
  const totals = summaryQuery.data?.totals ?? [];
  const runCount = metricQuantity(totals, (metric) => metric === "run.started");
  const toolCallCount = metricQuantity(
    totals,
    (metric) =>
      metric === "tool.call" ||
      metric === "tool.call.success" ||
      metric === "tool.call.failure",
  );
  const tokenCount = tokenQuantity(totals);
  const estimatedCost = totals.reduce(
    (sum, metric) => sum + metric.estimatedCostUsd,
    0,
  );

  return (
    <Section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted">{t("usageTitle")}</div>
        <div className="flex flex-wrap gap-2">
          <DateRangeSelect onChange={setRange} value={range} />
          <Button
            disabled={isExporting || inventoriedTable.estimatedTotal === 0}
            onClick={() => void exportCsv()}
            type="button"
          >
            {isExporting ? t("analyticsExporting") : t("analyticsExportCsv")}
          </Button>
          <PageActions
            onRefresh={() => void refresh()}
            refreshLabel={t("usageRefresh")}
            refreshing={
              inventoriedTable.query.isFetching ||
              summaryQuery.isFetching ||
              alertsQuery.isFetching ||
              metricDefinitionsQuery.isFetching
            }
          />
        </div>
      </div>
      <p className="mb-3 text-xs text-muted" role="status">
        {t("usageAppliedInterval")}:{" "}
        {interval.from ? (
          <LocalizedDateTime value={interval.from} />
        ) : (
          t("usageAllTime")
        )}{" "}
        – <LocalizedDateTime value={interval.to} /> ({t("usageToExclusive")})
      </p>
      {exportError ? (
        <div className="rm-composer-error mb-3" role="alert">
          {exportError}
        </div>
      ) : null}
      <StatRow
        items={[
          { label: t("usageRuns"), value: runCount },
          { label: t("usageTokens"), value: tokenCount },
          { label: t("usageToolCalls"), value: toolCallCount },
          {
            label: t("usageEstimatedCost"),
            value: <LocalizedCurrency value={estimatedCost} />,
          },
        ]}
      />
      {alerts.length > 0 ? (
        <>
          <div className="mb-2 mt-3 text-xs font-medium text-muted">
            {t("usageAlerts")}
          </div>
          <DataTable
            columns={alertColumns(t)}
            data={alerts}
            empty={t("usageNoAlerts")}
          />
        </>
      ) : null}
      <div className="mb-2 mt-3 text-xs font-medium text-muted">
        {t("usageTotals")}
      </div>
      <DataTable
        columns={totalColumns(t)}
        data={totals}
        empty={t("usageNoTotals")}
      />
      <div className="mb-2 mt-3 text-xs font-medium text-muted">
        {t("usageEvents")}
      </div>
      <DataTable
        columns={eventColumns(t)}
        data={inventoriedTable.rows}
        empty={t("usageNoEvents")}
        preferenceKey={`usage-events-${range}`}
        serverState={inventoriedTable.serverState}
      />
      <UsageMetricCatalogSection query={metricDefinitionsQuery} t={t} />
    </Section>
  );

  async function refresh() {
    await Promise.all([
      inventoriedTable.query.refetch(),
      summaryQuery.refetch(),
      alertsQuery.refetch(),
      metricDefinitionsQuery.refetch(),
    ]);
  }

  async function exportCsv() {
    setExportError(undefined);
    setIsExporting(true);
    try {
      const csv = await exportUsageEventsCsv(interval);
      downloadCsv(csv, "romeo-usage-events.csv");
    } catch (caught) {
      setExportError(safeUserErrorMessage(caught, t("usageUnableExport")));
      toast(t("usageUnableExport"), "error");
    } finally {
      setIsExporting(false);
    }
  }
}

function metricQuantity(
  totals: UsageSummaryMetric[],
  predicate: (metric: string) => boolean,
): number {
  return totals
    .filter((item) => predicate(item.metric))
    .reduce((sum, item) => sum + item.quantity, 0);
}

export function tokenQuantity(totals: UsageSummaryMetric[]): number {
  const reportedTotal = metricQuantity(
    totals,
    (metric) => metric === "llm.total_token.reported",
  );
  if (reportedTotal > 0) return reportedTotal;
  const reportedParts = metricQuantity(
    totals,
    (metric) =>
      metric === "llm.input_token.reported" ||
      metric === "llm.output_token.reported",
  );
  if (reportedParts > 0) return reportedParts;
  return metricQuantity(
    totals,
    (metric) =>
      metric === "llm.input_token.estimated" ||
      metric === "llm.output_token.estimated",
  );
}

function MetricLabel({
  metric,
  t,
}: {
  metric: string;
  t: Translate;
}): React.ReactNode {
  const label =
    metric === "run.started"
      ? t("usageRunsStarted")
      : metric === "run.completed"
        ? t("usageRunsCompleted")
        : metric === "llm.reasoning_token.reported"
          ? t("usageReasoningTokens")
          : metric.includes("input_token")
            ? t("usageInputTokens")
            : metric.includes("output_token")
              ? t("usageOutputTokens")
              : metric.includes("total_token")
                ? t("usageTotalTokens")
                : metric === "tool.call"
                  ? t("usageToolCalls")
                  : metric === "image.generated"
                    ? t("usageImagesGenerated")
                    : metric === "storage.byte"
                      ? t("usageStorageBytes")
                      : metric === "pipeline_duration"
                        ? t("usagePipelineDuration")
                        : humanizeMetric(metric);
  return <span className="font-medium">{label}</span>;
}

function humanizeMetric(metric: string): string {
  const words = metric.replace(/[._]+/gu, " ").trim();
  if (words.length === 0) return "";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function usageSeverityMessageKey(severity: UsageAlert["severity"]): MessageKey {
  if (severity === "warning") return "usageSeverityWarning";
  if (severity === "critical") return "usageSeverityCritical";
  return "usageSeverityExceeded";
}

function usageSourceMessageKey(source: UsageEvent["sourceType"]): MessageKey {
  if (source === "retrieval") return "usageSourceRetrieval";
  if (source === "run") return "usageSourceRun";
  if (source === "tool") return "usageSourceTool";
  if (source === "storage") return "usageSourceStorage";
  return "usageSourceVoice";
}
