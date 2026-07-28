import { Button } from "@romeo/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import {
  exportUsageEventsCsv,
  getUsageSummary,
  listUsageAlerts,
  listUsageEvents,
} from "../features";
import type {
  UsageAlert,
  UsageEvent,
  UsageSummaryMetric,
} from "../features/types";
import { downloadCsv } from "../lib/csv";
import { useLocale, type MessageKey } from "../lib/i18n";
import {
  LocalizedCurrency,
  LocalizedDateTime,
  LocalizedNumber,
} from "../lib/locale-format";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";

const alertCol = createColumnHelper<UsageAlert>();

type Translate = (key: MessageKey) => string;

function alertColumns(t: Translate): ColumnDef<UsageAlert, any>[] {
  return [
    alertCol.accessor("severity", {
      header: t("usageSeverity"),
      cell: (c) => (
        <span className="font-medium">
          {t(usageSeverityMessageKey(c.getValue()))}
        </span>
      ),
    }),
    alertCol.accessor("metric", {
      header: t("usageMetric"),
      cell: (c) => <span className="rm-mono">{c.getValue()}</span>,
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
        <span className="rm-cell-muted rm-mono">{c.getValue()}</span>
      ),
    }),
  ];
}

const totalCol = createColumnHelper<UsageSummaryMetric>();

function totalColumns(t: Translate): ColumnDef<UsageSummaryMetric, any>[] {
  return [
    totalCol.accessor("metric", {
      header: t("usageMetric"),
      cell: (c) => <span className="font-medium">{c.getValue()}</span>,
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
      cell: (c) => <span className="font-medium">{c.getValue()}</span>,
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
  const usageQuery = useQuery({
    queryKey: ["usageEvents"],
    queryFn: listUsageEvents,
  });
  const summaryQuery = useQuery({
    queryKey: ["usageSummary"],
    queryFn: getUsageSummary,
  });
  const alertsQuery = useQuery({
    queryKey: ["usageAlerts"],
    queryFn: listUsageAlerts,
  });
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string>();
  const alerts = alertsQuery.data ?? [];
  const events = usageQuery.data ?? [];
  const totals = summaryQuery.data?.totals ?? [];

  return (
    <section className="rm-panel p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted">{t("usageTitle")}</div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={isExporting || events.length === 0}
            onClick={() => void exportCsv()}
            type="button"
          >
            {isExporting ? t("analyticsExporting") : t("analyticsExportCsv")}
          </Button>
          <Button
            disabled={
              usageQuery.isFetching ||
              summaryQuery.isFetching ||
              alertsQuery.isFetching
            }
            onClick={() => void refresh()}
            type="button"
          >
            {usageQuery.isFetching ||
            summaryQuery.isFetching ||
            alertsQuery.isFetching
              ? t("refreshing")
              : t("usageRefresh")}
          </Button>
        </div>
      </div>
      {exportError ? (
        <div className="mb-3 text-sm text-red-300">{exportError}</div>
      ) : null}
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
        data={events}
        empty={t("usageNoEvents")}
      />
    </section>
  );

  async function refresh() {
    await Promise.all([
      usageQuery.refetch(),
      summaryQuery.refetch(),
      alertsQuery.refetch(),
    ]);
  }

  async function exportCsv() {
    setExportError(undefined);
    setIsExporting(true);
    try {
      const csv = await exportUsageEventsCsv();
      downloadCsv(csv, "romeo-usage-events.csv");
    } catch (caught) {
      setExportError(
        caught instanceof Error ? caught.message : t("usageUnableExport"),
      );
    } finally {
      setIsExporting(false);
    }
  }
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
