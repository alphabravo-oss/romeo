import { StatusBadge } from "@romeo/ui";
import type { ReactNode } from "react";

import type {
  Provider,
  ProviderOperationalSummary,
} from "../features/providers/types";
import { useLocale } from "../lib/i18n";
import {
  LocalizedDuration,
  LocalizedNumber,
  LocalizedTokens,
} from "../lib/locale-format";
import { Section, StatRow } from "./console";
import { DataTable, createColumnHelper, type ColumnDef } from "./DataTable";

interface MetricRow {
  id: string;
  label: string;
  value: ReactNode;
}

function operationalAlertLabel(code: string): string {
  return code
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

interface ProviderHealthRow {
  circuit: string;
  enabledModels: number;
  id: string;
  name: string;
  reasons: string;
  status: "available" | "degraded" | "unavailable";
  totalModels: number;
}

const metricColumn = createColumnHelper<MetricRow>();
const healthColumn = createColumnHelper<ProviderHealthRow>();

export function ProviderObservabilityPanel({
  operationalSummary,
  providers,
}: {
  operationalSummary: ProviderOperationalSummary | undefined;
  providers: Provider[];
}) {
  const { t } = useLocale();
  const providerNames = new Map(
    providers.map((provider) => [provider.id, provider.name]),
  );
  const runtime = operationalSummary?.runtime;
  const metrics: MetricRow[] = runtime
    ? [
        {
          id: "ttft",
          label: t("ttftP95"),
          value: (
            <LocalizedDuration milliseconds={runtime.timeToFirstTokenP95Ms} />
          ),
        },
        {
          id: "throughput",
          label: t("outputSpeed"),
          value: (
            <>
              <LocalizedNumber
                options={{ maximumFractionDigits: 1 }}
                value={runtime.outputThroughputAverage}
              />{" "}
              tok/s
            </>
          ),
        },
        {
          id: "queue",
          label: t("queueP95"),
          value: <LocalizedDuration milliseconds={runtime.queueWaitP95Ms} />,
        },
        {
          id: "context",
          label: t("contextAverage"),
          value: (
            <LocalizedTokens
              value={Math.round(runtime.contextInputTokensAverage)}
            />
          ),
        },
        {
          id: "reconnects",
          label: t("reconnects"),
          value: <LocalizedNumber value={runtime.sseReconnectCount} />,
        },
        {
          id: "provider-errors",
          label: t("providerErrors"),
          value: <LocalizedNumber value={runtime.providerErrorCount} />,
        },
        {
          id: "storage-errors",
          label: t("storageErrors"),
          value: <LocalizedNumber value={runtime.objectStoreFailureCount} />,
        },
      ]
    : [];
  const healthRows: ProviderHealthRow[] =
    operationalSummary?.providers.map((provider) => ({
      circuit: provider.circuit.state,
      enabledModels: provider.enabledModelCount,
      id: provider.providerId,
      name: providerNames.get(provider.providerId) ?? t("unknown"),
      reasons: provider.reasons.map(operationalAlertLabel).join(", "),
      status: provider.status,
      totalModels: provider.modelCount,
    })) ?? [];
  const metricColumns: ColumnDef<MetricRow, any>[] = [
    metricColumn.accessor("label", { header: t("metric") }),
    metricColumn.accessor("value", {
      header: t("value"),
      cell: (context) => context.getValue(),
    }),
  ];
  const healthColumns: ColumnDef<ProviderHealthRow, any>[] = [
    healthColumn.accessor("name", {
      header: t("provider"),
      cell: (context) => <span translate="no">{context.getValue()}</span>,
    }),
    healthColumn.accessor("status", {
      header: t("status"),
      cell: (context) => (
        <StatusBadge
          tone={
            context.getValue() === "available"
              ? "success"
              : context.getValue() === "degraded"
                ? "warning"
                : "danger"
          }
        >
          {context.getValue()}
        </StatusBadge>
      ),
    }),
    healthColumn.accessor("enabledModels", {
      header: t("models"),
      cell: (context) => {
        const row = context.row.original;
        return `${row.enabledModels}/${row.totalModels}`;
      },
    }),
    healthColumn.accessor("circuit", {
      header: t("circuit"),
      cell: (context) => (
        <StatusBadge
          tone={context.getValue() === "closed" ? "success" : "warning"}
        >
          {context.getValue()}
        </StatusBadge>
      ),
    }),
    healthColumn.accessor("reasons", {
      header: t("reasons"),
      cell: (context) => context.getValue() || "—",
    }),
  ];

  return (
    <Section>
      <div className="rm-card-title">{t("observability")}</div>
      <div className="mt-4 grid gap-5">
        <StatRow
          items={[
            {
              label: t("posture"),
              value: operationalSummary?.status ?? t("unknown"),
            },
            {
              label: t("availability"),
              value: healthRows.filter((row) => row.status === "available")
                .length,
            },
            {
              label: t("operationalAlerts"),
              value: operationalSummary?.alerts.length ?? 0,
            },
          ]}
        />
        {operationalSummary?.alerts.length ? (
          <ul aria-label={t("operationalAlerts")} className="grid gap-1">
            {operationalSummary.alerts.map((alert) => (
              <li className="rm-connection-result error" key={alert.id}>
                <span>{operationalAlertLabel(alert.code)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="grid gap-2">
          <h3 className="font-medium">{t("connectionHealth")}</h3>
          <DataTable
            columns={healthColumns}
            data={healthRows}
            getRowId={(row) => row.id}
            minTableWidth={720}
          />
        </div>
        <div className="grid gap-2">
          <h3 className="font-medium">{t("runtimeMetrics")}</h3>
          <DataTable
            columns={metricColumns}
            data={metrics}
            getRowId={(row) => row.id}
          />
        </div>
      </div>
    </Section>
  );
}
