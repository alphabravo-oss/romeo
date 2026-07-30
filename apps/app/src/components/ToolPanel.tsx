import { Input, Button, StatusBadge } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import Calculator from "lucide-react/dist/esm/icons/calculator.mjs";
import Clock3 from "lucide-react/dist/esm/icons/clock-3.mjs";
import { useMemo, type FormEvent } from "react";

import type { AgentToolSummary } from "../features/types";
import { useLocale, type MessageKey } from "../lib/i18n";
import { toast } from "../lib/toast";
import { ToolApprovalModal } from "./ToolApprovalModal";
import type { PendingToolApproval } from "./useToolExecution";
import { createColumnHelper, DataTable } from "./DataTable";

const toolColumn = createColumnHelper<AgentToolSummary>();

export function ToolPanel({
  isExecuting,
  onExecuteCalculator,
  onApproveTool,
  onCancelToolApproval,
  onExecuteDateTime,
  pendingApproval,
  result,
  tools,
}: {
  isExecuting: boolean;
  onExecuteCalculator: (expression: string) => void;
  onApproveTool: () => void;
  onCancelToolApproval: () => void;
  onExecuteDateTime: () => void;
  pendingApproval: PendingToolApproval | undefined;
  result: string | undefined;
  tools: AgentToolSummary[];
}) {
  const { t } = useLocale();
  const calculator = tools.find((tool) => tool.id === "tool_calculator");
  const dateTime = tools.find((tool) => tool.id === "tool_datetime");
  const canRunCalculator = isCallable(calculator);
  const canRunDateTime = isCallable(dateTime);
  const columns = useMemo(
    () => [
      toolColumn.accessor("name", {
        header: t("tools"),
        cell: ({ row }) => (
          <span className="block min-w-0">
            <strong className="block truncate">{row.original.name}</strong>
            <small className="block truncate font-mono text-muted">
              {row.original.id}
            </small>
          </span>
        ),
      }),
      toolColumn.accessor("riskLevel", {
        header: t("workspaceToolRisk"),
        cell: ({ getValue }) => t(riskMessageKey(getValue())),
      }),
      toolColumn.accessor((tool) => toolState(tool, t), {
        id: "status",
        header: t("status"),
        cell: ({ row, getValue }) => (
          <StatusBadge tone={isCallable(row.original) ? "success" : "neutral"}>
            {getValue()}
          </StatusBadge>
        ),
      }),
    ],
    [t],
  );

  const calculatorForm = useForm({
    defaultValues: { expression: "2 + 3 * 4" },
    onSubmit: async ({ value }) => {
      try {
        onExecuteCalculator(value.expression);
        toast(t("workspaceToolCalculatorRun"), "success");
      } catch {
        toast(t("workspaceToolCalculatorFailed"), "error");
      }
    },
  });

  function handleDateTimeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      onExecuteDateTime();
      toast(t("workspaceToolDateTimeRun"), "success");
    } catch {
      toast(t("workspaceToolDateTimeFailed"), "error");
    }
  }

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-title">{t("tools")}</div>
      <DataTable
        columns={columns}
        data={tools}
        getRowId={(tool) => tool.id}
        preferenceKey="workspace-agent-tools"
      />
      <form
        className="mt-4 grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void calculatorForm.handleSubmit();
        }}
      >
        <label className="text-sm text-muted" htmlFor="calculator-expression">
          {t("workspaceToolCalculator")}
        </label>
        <calculatorForm.Field
          name="expression"
          validators={{
            onChange: ({ value }: { value: string }) =>
              !value?.trim() ? t("workspaceToolExpressionRequired") : undefined,
          }}
        >
          {(field) => (
            <>
              <Input
                name="expression"
                id="calculator-expression"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value)
                }
                value={field.state.value}
              />
              {field.state.meta.errors.length ? (
                <div className="rm-composer-error">
                  {field.state.meta.errors.join(", ")}
                </div>
              ) : null}
            </>
          )}
        </calculatorForm.Field>
        <calculatorForm.Subscribe
          selector={(state) => ({
            canSubmit: state.canSubmit,
            isSubmitting: state.isSubmitting,
          })}
        >
          {({ canSubmit, isSubmitting }) => (
            <Button
              className="inline-flex items-center justify-center gap-2"
              disabled={
                !canSubmit || isSubmitting || isExecuting || !canRunCalculator
              }
              type="submit"
            >
              <Calculator aria-hidden="true" size={16} />
              <span>
                {isExecuting
                  ? t("agentRunning")
                  : t("workspaceToolRunCalculator")}
              </span>
            </Button>
          )}
        </calculatorForm.Subscribe>
      </form>
      <form className="mt-4 grid gap-2" onSubmit={handleDateTimeSubmit}>
        <Button
          className="inline-flex items-center justify-center gap-2"
          disabled={isExecuting || !canRunDateTime}
          type="submit"
        >
          <Clock3 aria-hidden="true" size={16} />
          <span>
            {isExecuting ? t("agentRunning") : t("workspaceToolRunDateTime")}
          </span>
        </Button>
      </form>
      {result ? (
        <div className="mt-3 rounded-md border border-border p-3 text-sm">
          {result}
        </div>
      ) : null}
      {pendingApproval ? (
        <ToolApprovalModal
          approval={pendingApproval}
          isExecuting={isExecuting}
          onApprove={onApproveTool}
          onCancel={onCancelToolApproval}
        />
      ) : null}
    </section>
  );
}

function isCallable(tool: AgentToolSummary | undefined): boolean {
  return tool?.bound === true && tool.enabled && tool.hasAccess;
}

function toolState(
  tool: AgentToolSummary,
  t: (key: MessageKey) => string,
): string {
  if (!tool.hasAccess) return t("workspaceToolNoAccess");
  if (!tool.bound) return t("workspaceToolNotBound");
  if (!tool.enabled) return t("disabled");
  return tool.approvalRequired
    ? t("workspaceToolApprovalRequired")
    : t("enabled");
}

function riskMessageKey(riskLevel: AgentToolSummary["riskLevel"]): MessageKey {
  if (riskLevel === "low") return "workspaceToolRiskLow";
  if (riskLevel === "medium") return "workspaceToolRiskMedium";
  return "workspaceToolRiskHigh";
}
