import { Input, Button, Field, StatusBadge } from "@romeo/ui";
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
import { ResourceRow } from "./ResourceRow";
import { SettingsSection } from "./SettingsSection";

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
    <div className="rm-console-page">
      <SettingsSection
        description={t("workspaceToolsCatalogHelp")}
        title={t("workspaceToolsCatalog")}
      >
        {tools.length === 0 ? (
          <p className="rm-list-empty">{t("workspaceToolsNoTools")}</p>
        ) : (
          <DataTable
            columns={columns}
            data={tools}
            getRowId={(tool) => tool.id}
            preferenceKey="workspace-agent-tools"
          />
        )}
      </SettingsSection>
      <SettingsSection
        description={t("workspaceToolsTryHelp")}
        title={t("workspaceToolsTry")}
      >
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void calculatorForm.handleSubmit();
          }}
        >
          <calculatorForm.Field
            name="expression"
            validators={{
              onChange: ({ value }: { value: string }) =>
                !value?.trim()
                  ? t("workspaceToolExpressionRequired")
                  : undefined,
            }}
          >
            {(field) => (
              <Field label={t("workspaceToolExpression")}>
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
              </Field>
            )}
          </calculatorForm.Field>
          <calculatorForm.Subscribe
            selector={(state) => ({
              canSubmit: state.canSubmit,
              isSubmitting: state.isSubmitting,
            })}
          >
            {({ canSubmit, isSubmitting }) => (
              <div className="rm-resource-row__actions rm-resource-row__actions--start">
                <Button
                  className="inline-flex items-center justify-center gap-2"
                  disabled={
                    !canSubmit ||
                    isSubmitting ||
                    isExecuting ||
                    !canRunCalculator
                  }
                  type="submit"
                  variant="primary"
                >
                  <Calculator aria-hidden="true" size={16} />
                  <span>
                    {isExecuting
                      ? t("agentRunning")
                      : t("workspaceToolRunCalculator")}
                  </span>
                </Button>
              </div>
            )}
          </calculatorForm.Subscribe>
        </form>
        <form onSubmit={handleDateTimeSubmit}>
          <ResourceRow
            actions={
              <Button
                className="inline-flex items-center justify-center gap-2"
                disabled={isExecuting || !canRunDateTime}
                type="submit"
                variant="ghost"
              >
                <Clock3 aria-hidden="true" size={16} />
                <span>
                  {isExecuting
                    ? t("agentRunning")
                    : t("workspaceToolRunDateTime")}
                </span>
              </Button>
            }
            meta={t("workspaceToolsDateTimeHelp")}
            title={t("workspaceToolRunDateTime")}
          />
        </form>
        {result ? (
          <pre className="rm-console-output">
            <span className="rm-resource-row__meta">
              {t("workspaceToolsResult")}
            </span>
            {"\n"}
            {result}
          </pre>
        ) : null}
      </SettingsSection>
      {pendingApproval ? (
        <ToolApprovalModal
          approval={pendingApproval}
          isExecuting={isExecuting}
          onApprove={onApproveTool}
          onCancel={onCancelToolApproval}
        />
      ) : null}
    </div>
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
