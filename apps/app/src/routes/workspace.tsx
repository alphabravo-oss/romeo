import { createFileRoute } from "@tanstack/react-router";
import Bot from "lucide-react/dist/esm/icons/bot.mjs";
import FlaskConical from "lucide-react/dist/esm/icons/flask-conical.mjs";
import Library from "lucide-react/dist/esm/icons/library.mjs";
import Mic from "lucide-react/dist/esm/icons/mic.mjs";
import Users from "lucide-react/dist/esm/icons/users.mjs";
import Wrench from "lucide-react/dist/esm/icons/wrench.mjs";
import { useState } from "react";

import { AgentStudioPanel } from "../components/AgentStudioPanel";
import { CollaborationPanel } from "../components/CollaborationPanel";
import { ConsoleLayout } from "../components/ConsoleLayout";
import { EvalPanel } from "../components/EvalPanel";
import { KnowledgePanel } from "../components/KnowledgePanel";
import { PageHeader } from "../components/PageHeader";
import { ToolPanel } from "../components/ToolPanel";
import { useToolExecution } from "../components/useToolExecution";
import { useWorkspaceData } from "../components/useWorkspaceData";
import { VoicePanel } from "../components/VoicePanel";

export const Route = createFileRoute("/workspace")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { section?: string } =>
    typeof search.section === "string" ? { section: search.section } : {},
  component: WorkspacePage,
});

const GROUPS = [
  {
    label: "Build",
    items: [
      { key: "agents", label: "Agents", icon: Bot },
      { key: "knowledge", label: "Knowledge", icon: Library },
      { key: "tools", label: "Tools", icon: Wrench },
      { key: "voice", label: "Voice", icon: Mic },
      { key: "evals", label: "Evals", icon: FlaskConical },
    ],
  },
  {
    label: "Share",
    items: [{ key: "collaboration", label: "Collaboration", icon: Users }],
  },
];

const META: Record<string, { title: string; description: string }> = {
  agents: {
    title: "Agents",
    description: "Configure assistant behavior, models, and guardrails.",
  },
  knowledge: {
    title: "Knowledge",
    description: "Sources this agent can retrieve and cite.",
  },
  tools: {
    title: "Tools",
    description: "Capabilities the agent can call, and their approvals.",
  },
  voice: {
    title: "Voice",
    description: "Speech input and synthesized voice for this agent.",
  },
  evals: {
    title: "Evals",
    description: "Test and compare agent responses across models.",
  },
  collaboration: {
    title: "Collaboration",
    description: "Share agents and chats with your teammates.",
  },
};

function WorkspacePage() {
  const { section: sectionParam } = Route.useSearch();
  const navigate = Route.useNavigate();
  const section = sectionParam ?? "agents";
  const [agentId, setAgentId] = useState<string>();
  const data = useWorkspaceData(agentId);
  const tools = useToolExecution(data.activeAgent, data.tools, () => {});
  const workspaceId = data.workspace?.id;

  // Per-agent sections need a chosen agent; expose a picker at the top.
  const agentPicker =
    data.agents.length > 0 ? (
      <div className="rm-console-agentpicker">
        <label htmlFor="ws-agent">Agent</label>
        <select
          id="ws-agent"
          onChange={(event) => setAgentId(event.currentTarget.value)}
          value={data.activeAgent?.id ?? ""}
        >
          {data.agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
      </div>
    ) : null;

  return (
    <ConsoleLayout
      active={section}
      groups={GROUPS}
      onSelect={(key) => void navigate({ search: { section: key } })}
      title="Workspace"
    >
      <div className="rm-console-topline">
        <PageHeader
          description={META[section]!.description}
          title={META[section]!.title}
        />
        {section !== "collaboration" ? agentPicker : null}
      </div>

      {section === "agents" ? (
        <div className="grid gap-4">
          <AgentStudioPanel
            activeAgent={data.activeAgent}
            models={data.models}
            providers={data.providers}
            workspaceId={workspaceId}
          />
        </div>
      ) : null}

      {section === "knowledge" ? (
        <KnowledgePanel activeAgent={data.activeAgent} workspaceId={workspaceId} />
      ) : null}

      {section === "tools" ? (
        <ToolPanel
          isExecuting={tools.isExecutingTool}
          onApproveTool={() => void tools.approvePendingTool()}
          onCancelToolApproval={tools.cancelPendingTool}
          onExecuteCalculator={(expression) =>
            void tools.handleExecuteCalculator(expression)
          }
          onExecuteDateTime={() => void tools.handleExecuteDateTime()}
          pendingApproval={tools.pendingApproval}
          result={tools.toolResult}
          tools={data.tools}
        />
      ) : null}

      {section === "voice" ? (
        <VoicePanel activeAgent={data.activeAgent} workspaceId={workspaceId} />
      ) : null}

      {section === "evals" ? (
        <EvalPanel activeAgent={data.activeAgent} models={data.models} />
      ) : null}

      {section === "collaboration" ? (
        <CollaborationPanel
          activeAgent={data.activeAgent}
          activeChatId={undefined}
          workspaceId={workspaceId}
        />
      ) : null}
    </ConsoleLayout>
  );
}
