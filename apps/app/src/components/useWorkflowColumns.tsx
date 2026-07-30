import { Button } from "@romeo/ui";
import { useMemo } from "react";

import type {
  Workflow,
  WorkflowRun,
  WorkflowTemplate,
} from "../features/workflows";
import { useLocale } from "../lib/i18n";
import { LocalizedDateTime } from "../lib/locale-format";
import { type ColumnDef, createColumnHelper } from "./DataTable";

const workflowCol = createColumnHelper<Workflow>();
const templateCol = createColumnHelper<WorkflowTemplate>();
const runCol = createColumnHelper<WorkflowRun>();

export function useWorkflowColumns(input: {
  approvePending: boolean;
  onApprove: (workflowRunId: string) => void;
  onResume: (workflowRunId: string) => void;
  onRun: (workflowId: string) => void;
  onSelect: (workflowId: string) => void;
  resumePending: boolean;
  startPending: boolean;
}) {
  const { t } = useLocale();
  const {
    approvePending,
    onApprove,
    onResume,
    onRun,
    onSelect,
    resumePending,
    startPending,
  } = input;
  const workflowColumns = useMemo<ColumnDef<Workflow, any>[]>(
    () => [
      workflowCol.accessor("name", {
        header: t("name"),
        cell: (cell) => <span className="font-medium">{cell.getValue()}</span>,
      }),
      workflowCol.accessor((row) => row.steps.length, {
        id: "steps",
        header: t("steps"),
        cell: (cell) => (
          <span className="rm-cell-muted">{cell.getValue()}</span>
        ),
      }),
      workflowCol.accessor((row) => (row.enabled ? "enabled" : "disabled"), {
        id: "enabled",
        header: t("state"),
        cell: (cell) => (
          <span className="rm-cell-muted">
            {cell.getValue() === "enabled" ? t("enabled") : t("disabled")}
          </span>
        ),
      }),
      workflowCol.display({
        id: "actions",
        header: "",
        cell: (cell) => (
          <div className="flex gap-2">
            <Button
              variant="primary"
              disabled={startPending}
              onClick={() => onRun(cell.row.original.id)}
              type="button"
            >
              {t("run")}
            </Button>
            <Button
              onClick={() => onSelect(cell.row.original.id)}
              type="button"
            >
              {t("viewRuns")}
            </Button>
          </div>
        ),
      }),
    ],
    [onRun, onSelect, startPending, t],
  );

  const templateColumns = useMemo<ColumnDef<WorkflowTemplate, any>[]>(
    () => [
      templateCol.accessor("name", {
        header: t("template"),
        cell: (cell) => <span className="font-medium">{cell.getValue()}</span>,
      }),
      templateCol.accessor("description", {
        header: t("workflowDescription"),
        cell: (cell) => (
          <span className="rm-cell-muted">{cell.getValue()}</span>
        ),
      }),
      templateCol.accessor((row) => row.steps.length, {
        id: "steps",
        header: t("steps"),
        cell: (cell) => (
          <span className="rm-cell-muted">{cell.getValue()}</span>
        ),
      }),
    ],
    [t],
  );

  const runColumns = useMemo<ColumnDef<WorkflowRun, any>[]>(
    () => [
      runCol.accessor("id", {
        header: t("run"),
        cell: (cell) => (
          <span className="rm-mono rm-cell-muted">{cell.getValue()}</span>
        ),
      }),
      runCol.accessor("status", {
        header: t("status"),
        cell: (cell) => <span className="font-medium">{cell.getValue()}</span>,
      }),
      runCol.accessor((row) => row.createdAt, {
        id: "createdAt",
        header: t("created"),
        cell: (cell) => (
          <span className="rm-cell-muted">
            <LocalizedDateTime value={cell.getValue()} />
          </span>
        ),
      }),
      runCol.display({
        id: "actions",
        header: "",
        cell: (cell) => {
          const run = cell.row.original;
          return (
            <div className="flex gap-2">
              {run.status === "waiting_approval" ? (
                <Button
                  disabled={approvePending}
                  onClick={() => onApprove(run.id)}
                  type="button"
                >
                  {t("approve")}
                </Button>
              ) : null}
              {run.status === "waiting_run" ? (
                <Button
                  disabled={resumePending}
                  onClick={() => onResume(run.id)}
                  type="button"
                >
                  {t("resume")}
                </Button>
              ) : null}
            </div>
          );
        },
      }),
    ],
    [approvePending, onApprove, onResume, resumePending, t],
  );

  return { runColumns, templateColumns, workflowColumns };
}
