import { createFileRoute } from "@tanstack/react-router";
import Bot from "lucide-react/dist/esm/icons/bot.mjs";
import FlaskConical from "lucide-react/dist/esm/icons/flask-conical.mjs";
import Library from "lucide-react/dist/esm/icons/library.mjs";
import Mic from "lucide-react/dist/esm/icons/mic.mjs";
import Users from "lucide-react/dist/esm/icons/users.mjs";
import Wrench from "lucide-react/dist/esm/icons/wrench.mjs";
import { Field, Select } from "@romeo/ui";
import { useState } from "react";

import { AgentStudioPanel } from "../components/AgentStudioPanel";
import { CollaborationPanel } from "../components/CollaborationPanel";
import { ConsoleLayout } from "../components/ConsoleLayout";
import { EvalPanel } from "../components/EvalPanel";
import { KnowledgePanel } from "../components/KnowledgePanel";
import { PageHeader } from "../components/PageHeader";
import { ToolPanel } from "../components/ToolPanel";
import { ToolTracePanel } from "../components/ToolTracePanel";
import { useToolExecution } from "../components/useToolExecution";
import { useWorkspaceData } from "../components/useWorkspaceData";
import { VoicePanel } from "../components/VoicePanel";
import { WorkspaceUserMenu } from "../components/WorkspaceUserMenu";
import {
  localeNamespaceGroups,
  type MessageKey,
  useLocale,
  useLocaleNamespaces,
} from "../lib/i18n";
import { resolveSectionKey } from "../lib/section-routing";

export const Route = createFileRoute("/workspace")({
  validateSearch: (search: Record<string, unknown>): { section?: string } =>
    typeof search.section === "string" ? { section: search.section } : {},
  component: WorkspacePage,
});

const GROUPS = [
  {
    labelKey: "workspaceBuild" as MessageKey,
    items: [
      { key: "agents", labelKey: "workspaceAgents" as MessageKey, icon: Bot },
      {
        key: "knowledge",
        labelKey: "workspaceKnowledge" as MessageKey,
        icon: Library,
      },
      { key: "tools", labelKey: "workspaceTools" as MessageKey, icon: Wrench },
      { key: "voice", labelKey: "workspaceVoice" as MessageKey, icon: Mic },
      { key: "evals", labelKey: "evals" as MessageKey, icon: FlaskConical },
    ],
  },
  {
    labelKey: "workspaceShare" as MessageKey,
    items: [
      {
        key: "collaboration",
        labelKey: "workspaceCollaboration" as MessageKey,
        icon: Users,
      },
    ],
  },
];

const META: Record<
  string,
  { titleKey: MessageKey; descriptionKey: MessageKey }
> = {
  agents: {
    titleKey: "workspaceAgents",
    descriptionKey: "workspaceAgentsDescription",
  },
  knowledge: {
    titleKey: "workspaceKnowledge",
    descriptionKey: "workspaceKnowledgeDescription",
  },
  tools: {
    titleKey: "workspaceTools",
    descriptionKey: "workspaceToolsDescription",
  },
  voice: {
    titleKey: "workspaceVoice",
    descriptionKey: "workspaceVoiceDescription",
  },
  evals: {
    titleKey: "evals",
    descriptionKey: "workspaceEvalsDescription",
  },
  collaboration: {
    titleKey: "workspaceCollaboration",
    descriptionKey: "workspaceCollaborationDescription",
  },
};

function WorkspacePage() {
  useLocaleNamespaces(localeNamespaceGroups.workspace);
  const { t } = useLocale();
  const { section: sectionParam } = Route.useSearch();
  const navigate = Route.useNavigate();
  const section = resolveSectionKey(sectionParam, META, "agents");
  const [agentId, setAgentId] = useState<string>();
  const data = useWorkspaceData(agentId);
  const tools = useToolExecution(data.activeAgent, data.tools, () => {});
  const workspaceId = data.workspace?.id;

  // Per-agent sections need a chosen agent; expose a picker at the top.
  const agentPicker =
    data.agents.length > 0 ? (
      <div className="rm-console-agentpicker">
        <Field label={t("workspaceAgent")}>
          <Select
            onValueChange={setAgentId}
            options={data.agents.map((agent) => ({
              label: agent.name,
              value: agent.id,
            }))}
            value={data.activeAgent?.id ?? ""}
          />
        </Field>
      </div>
    ) : null;

  return (
    <ConsoleLayout
      active={section}
      groups={GROUPS.map((group) => ({
        label: t(group.labelKey),
        items: group.items.map((item) => ({
          key: item.key,
          label: t(item.labelKey),
          icon: item.icon,
        })),
      }))}
      onSelect={(key) => void navigate({ search: { section: key } })}
      title={t("workspaceSettings")}
      userMenu={
        <WorkspaceUserMenu
          isAdmin={data.subject?.isAdmin === true}
          userLabel={
            data.subject?.name ??
            data.subject?.email ??
            data.subject?.id ??
            t("account")
          }
        />
      }
    >
      <div className="rm-console-topline">
        <PageHeader
          description={t(META[section]!.descriptionKey)}
          title={t(META[section]!.titleKey)}
        />
        {section !== "collaboration" ? agentPicker : null}
      </div>

      {section === "agents" ? (
        <div className="grid gap-4">
          <AgentStudioPanel
            activeAgent={data.activeAgent}
            isAdmin={data.subject?.isAdmin === true}
            models={data.models}
            onAgentCreated={setAgentId}
            providers={data.providers}
            workspaceId={workspaceId}
          />
        </div>
      ) : null}

      {section === "knowledge" ? (
        <KnowledgePanel
          activeAgent={data.activeAgent}
          workspaceId={workspaceId}
        />
      ) : null}

      {section === "tools" ? (
        <div className="grid gap-4">
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
          <ToolTracePanel activeAgentId={data.activeAgent?.id} />
        </div>
      ) : null}

      {section === "voice" ? (
        <VoicePanel activeAgent={data.activeAgent} workspaceId={workspaceId} />
      ) : null}

      {section === "evals" ? (
        <EvalPanel activeAgent={data.activeAgent} />
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
