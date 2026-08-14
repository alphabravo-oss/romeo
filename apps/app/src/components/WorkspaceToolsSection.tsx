import type { Agent, AgentToolSummary } from "../features/types";
import { ToolPanel } from "./ToolPanel";
import { ToolTracePanel } from "./ToolTracePanel";
import { useToolExecution } from "./useToolExecution";

export function WorkspaceToolsSection({
  activeAgent,
  tools,
}: {
  activeAgent: Agent | undefined;
  tools: AgentToolSummary[];
}) {
  const execution = useToolExecution(activeAgent, tools, () => {});
  return (
    <div className="rm-console-page">
      <ToolPanel
        isExecuting={execution.isExecutingTool}
        onApproveTool={() => void execution.approvePendingTool()}
        onCancelToolApproval={execution.cancelPendingTool}
        onExecuteCalculator={(expression) =>
          void execution.handleExecuteCalculator(expression)
        }
        onExecuteDateTime={() => void execution.handleExecuteDateTime()}
        pendingApproval={execution.pendingApproval}
        result={execution.toolResult}
        tools={tools}
      />
      <ToolTracePanel activeAgentId={activeAgent?.id} />
    </div>
  );
}
