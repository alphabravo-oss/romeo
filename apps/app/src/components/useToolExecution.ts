import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { RomeoApiError } from "@romeo/api-client";
import { executeToolMutationOptions } from "../features/tools";
import type { Agent, AgentToolSummary } from "../features/types";
import { safeUserErrorMessage } from "../lib/safe-user-error";

export interface PendingToolApproval {
  approvalRequestId: string;
  toolId: string;
  name: string;
  riskLevel: string;
  approvalPolicy: string;
  inputKeys: string[];
}

export function useToolExecution(
  activeAgent: Agent | undefined,
  tools: AgentToolSummary[],
  onError: (message: string | undefined) => void,
) {
  const [toolResult, setToolResult] = useState<string>();
  const [pendingApproval, setPendingApproval] = useState<PendingToolApproval>();
  const calculatorMutation = useMutation(
    executeToolMutationOptions<{ result: number }>("tool_calculator"),
  );
  const dateTimeMutation = useMutation(
    executeToolMutationOptions<{ iso: string; timeZone: string }>(
      "tool_datetime",
    ),
  );

  async function handleExecuteCalculator(expression: string) {
    if (!activeAgent) return;
    onError(undefined);
    try {
      const result = await calculatorMutation.mutateAsync({
        agentId: activeAgent.id,
        payload: { expression },
      });
      setToolResult(String(result.result));
    } catch (caught) {
      onError(safeUserErrorMessage(caught, "Unable to execute tool."));
    }
  }

  async function handleExecuteDateTime() {
    if (!activeAgent) return;
    onError(undefined);
    try {
      await runDateTime(activeAgent.id, false);
    } catch (caught) {
      if (
        caught instanceof RomeoApiError &&
        caught.code === "tool_approval_required"
      ) {
        const approvalRequestId =
          typeof caught.details.approvalRequestId === "string"
            ? caught.details.approvalRequestId
            : undefined;
        if (approvalRequestId === undefined) {
          onError("Tool approval request was not returned by the server.");
          return;
        }
        const tool = tools.find((item) => item.id === "tool_datetime");
        setPendingApproval({
          approvalRequestId,
          toolId: "tool_datetime",
          name: tool?.name ?? "Date/time",
          riskLevel: tool?.riskLevel ?? "low",
          approvalPolicy:
            tool?.approvalRequired === true
              ? "agent_binding"
              : (tool?.approvalPolicy ?? "always"),
          inputKeys: ["timeZone"],
        });
        return;
      }
      onError(safeUserErrorMessage(caught, "Unable to execute tool."));
    }
  }

  async function approvePendingTool() {
    if (!activeAgent || pendingApproval?.toolId !== "tool_datetime") return;
    onError(undefined);
    try {
      await runDateTime(
        activeAgent.id,
        true,
        pendingApproval.approvalRequestId,
      );
      setPendingApproval(undefined);
    } catch (caught) {
      onError(safeUserErrorMessage(caught, "Unable to execute tool."));
    }
  }

  function cancelPendingTool() {
    setPendingApproval(undefined);
  }

  async function runDateTime(
    agentId: string,
    approved: boolean,
    approvalRequestId?: string,
  ) {
    const result = await dateTimeMutation.mutateAsync({
      agentId,
      approved,
      ...(approvalRequestId === undefined ? {} : { approvalRequestId }),
      payload: dateTimePayload(),
    });
    setToolResult(`${result.timeZone}: ${result.iso}`);
  }

  return {
    approvePendingTool,
    cancelPendingTool,
    handleExecuteCalculator,
    handleExecuteDateTime,
    isExecutingTool: calculatorMutation.isPending || dateTimeMutation.isPending,
    pendingApproval,
    toolResult,
  };
}

function dateTimePayload() {
  return { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
}
