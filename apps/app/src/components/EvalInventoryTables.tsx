import { StatusBadge } from "@romeo/ui";
import { useMemo } from "react";

import type { EvalRun, EvalRunResult, EvalSuite } from "../features/types";
import { useLocale } from "../lib/i18n";
import { LocalizedDateTime, LocalizedNumber } from "../lib/locale-format";
import { createColumnHelper, DataTable } from "./DataTable";

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
      columns={columns}
      data={data}
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
      minTableWidth={680}
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
