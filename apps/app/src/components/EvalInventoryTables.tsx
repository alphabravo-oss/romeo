import { StatusBadge } from "@romeo/ui";
import { useMemo } from "react";

import type { EvalRun, EvalRunResult, EvalSuite } from "../features/types";
import { useLocale } from "../lib/i18n";
import { LocalizedDateTime, LocalizedNumber } from "../lib/locale-format";
import { createColumnHelper, DataTable } from "./DataTable";
import { useInventoriedServerTable } from "../lib/inventoried-server-table";

const suiteColumn = createColumnHelper<EvalSuite>();
const runColumn = createColumnHelper<EvalRun>();
const resultColumn = createColumnHelper<EvalRunResult>();

export function EvalSuiteTable({
  data,
  onSelect,
}: {
  data: EvalSuite[];
  onSelect: (id: string) => void;
}) {
  const { t } = useLocale();
  const inventoriedTable = useInventoriedServerTable<any>("eval_suites");
  const columns = useMemo(
    () => [
      suiteColumn.accessor("name", {
        header: t("evalSuites"),
        cell: ({ row }) => (
          <span className="block min-w-0">
            <strong className="block truncate">{row.original.name}</strong>
            <small className="block truncate font-mono text-muted">
              {row.original.id}
            </small>
          </span>
        ),
      }),
      suiteColumn.accessor("updatedAt", {
        header: t("evalUpdated"),
        cell: ({ getValue }) => <LocalizedDateTime value={getValue()} />,
      }),
    ],
    [t],
  );
  return (
    <DataTable
      serverState={inventoriedTable.serverState}
      columns={columns}
      data={inventoriedTable.rows}
      getRowId={(suite) => suite.id}
      onRowActivate={(suite) => onSelect(suite.id)}
      preferenceKey="eval-suites"
      rowAriaLabel={(suite) => suite.name}
      searchVisibility="always"
    />
  );
}

export function EvalRunTable({
  data,
  onSelect,
}: {
  data: EvalRun[];
  onSelect: (id: string) => void;
}) {
  const { t } = useLocale();
  const columns = useMemo(
    () => [
      runColumn.accessor("status", {
        header: t("status"),
        cell: ({ getValue }) => (
          <StatusBadge tone={getValue() === "passed" ? "success" : "danger"}>
            {t(
              getValue() === "passed" ? "evalStatusPassed" : "evalStatusFailed",
            )}
          </StatusBadge>
        ),
      }),
      runColumn.accessor("score", {
        header: t("evalScore"),
        cell: ({ getValue }) => (
          <LocalizedNumber
            options={{ maximumFractionDigits: 0, style: "percent" }}
            value={getValue()}
          />
        ),
      }),
      runColumn.accessor("modelId", {
        header: t("evalModel"),
        cell: ({ getValue }) => (
          <span className="font-mono text-xs">{getValue()}</span>
        ),
      }),
      runColumn.display({
        id: "reasoningPolicy",
        header: t("evalReasoningPolicy"),
        cell: ({ row }) => {
          const policy = row.original.reasoningPolicy?.effective;
          if (policy === undefined) return t("evalNotAvailable");
          if (policy.mode === "off") return t("evalReasoningOff");
          return policy.effort === undefined
            ? t("evalReasoningAuto")
            : t(
                policy.effort === "low"
                  ? "evalReasoningLow"
                  : policy.effort === "medium"
                    ? "evalReasoningMedium"
                    : "evalReasoningHigh",
              );
        },
      }),
      runColumn.display({
        id: "latency",
        header: t("evalAverageLatency"),
        cell: ({ row }) =>
          row.original.metrics === undefined ? (
            t("evalNotAvailable")
          ) : (
            <LocalizedNumber value={row.original.metrics.latencyMs} />
          ),
      }),
      runColumn.accessor("completedAt", {
        header: t("evalCompleted"),
        cell: ({ getValue }) => <LocalizedDateTime value={getValue()} />,
      }),
    ],
    [t],
  );
  return (
    <DataTable
      columns={columns}
      data={data}
      getRowId={(run) => run.id}
      minTableWidth={900}
      onRowActivate={(run) => onSelect(run.id)}
      preferenceKey="eval-runs"
      rowAriaLabel={(run) => `${run.status} ${run.modelId}`}
      searchVisibility="always"
    />
  );
}

export function EvalResultTable({
  data,
  onSelect,
}: {
  data: EvalRunResult[];
  onSelect: (id: string) => void;
}) {
  const { t } = useLocale();
  const columns = useMemo(
    () => [
      resultColumn.accessor("output", {
        header: t("evalOutput"),
        cell: ({ getValue }) => (
          <span className="block max-w-xl truncate">{getValue()}</span>
        ),
      }),
      resultColumn.accessor("status", {
        header: t("status"),
        cell: ({ getValue }) => (
          <StatusBadge tone={getValue() === "passed" ? "success" : "danger"}>
            {t(
              getValue() === "passed" ? "evalStatusPassed" : "evalStatusFailed",
            )}
          </StatusBadge>
        ),
      }),
      resultColumn.accessor("score", {
        header: t("evalScore"),
        cell: ({ getValue }) => (
          <LocalizedNumber
            options={{ maximumFractionDigits: 0, style: "percent" }}
            value={getValue()}
          />
        ),
      }),
      resultColumn.accessor("createdAt", {
        header: t("evalUpdated"),
        cell: ({ getValue }) => <LocalizedDateTime value={getValue()} />,
      }),
    ],
    [t],
  );
  return (
    <DataTable
      columns={columns}
      data={data}
      getRowId={(result) => result.id}
      minTableWidth={720}
      onRowActivate={(result) => onSelect(result.id)}
      preferenceKey="eval-results"
      rowAriaLabel={(result) => result.output}
      searchVisibility="always"
    />
  );
}
