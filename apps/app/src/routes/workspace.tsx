import { createFileRoute } from "@tanstack/react-router";
import Bot from "lucide-react/dist/esm/icons/bot.mjs";
import FlaskConical from "lucide-react/dist/esm/icons/flask-conical.mjs";
import Library from "lucide-react/dist/esm/icons/library.mjs";
import Mic from "lucide-react/dist/esm/icons/mic.mjs";
import Users from "lucide-react/dist/esm/icons/users.mjs";
import Wrench from "lucide-react/dist/esm/icons/wrench.mjs";
import { Field, Select } from "@romeo/ui";
import { Suspense, useState } from "react";

import { ConsoleLayout } from "../components/ConsoleLayout";
import { resolveAgentStudioTab } from "../components/agent-studio-model";
import {
  MasterDetail,
  MasterList,
  MasterListItem,
  Page,
} from "../components/console";
import { useWorkspaceData } from "../components/useWorkspaceData";
import { WorkspaceUserMenu } from "../components/WorkspaceUserMenu";
import {
  AgentStudioPanel,
  CollaborationPanel,
  EvalPanel,
  KnowledgePanel,
  VoicePanel,
  WorkspaceToolsSection,
  preloadWorkspaceSection,
} from "../components/workspace-console-lazy-panels";
import {
  localeNamespacesForWorkspaceSection,
  type MessageKey,
  useLocale,
  useLocaleNamespaces,
} from "../lib/i18n";
import { resolveSectionKey } from "../lib/section-routing";
import { prefetchPrimaryRouteData } from "../lib/route-data";
import { validatedWorkspaceRouteSearch } from "../lib/route-workspace-selection";
import adminCss from "../styles/admin.css?url";

export const Route = createFileRoute("/workspace")({
  loaderDeps: ({ search }) => ({ workspaceId: search.workspace }),
  loader: ({ cause, context, deps }) =>
    prefetchPrimaryRouteData(
      "workspace",
      context,
      cause === "preload" ? "intent" : "navigation",
      deps,
    ),
  head: () => ({
    links: [{ rel: "stylesheet", href: adminCss }],
  }),
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    resource?: string;
    section?: string;
    tab?: string;
    workspace?: string;
  } => ({
    ...(typeof search.resource === "string"
      ? { resource: search.resource }
      : {}),
    ...(typeof search.section === "string" ? { section: search.section } : {}),
    ...(typeof search.tab === "string" ? { tab: search.tab } : {}),
    ...validatedWorkspaceRouteSearch(search.workspace),
  }),
  component: WorkspacePage,
});

// Flat workspace nav (was "workspaceBuild" / "workspaceShare").
const GROUPS = [
  {
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
  const { t } = useLocale();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { section: sectionParam } = search;
  const section = resolveSectionKey(sectionParam, META, "agents");
  useLocaleNamespaces(localeNamespacesForWorkspaceSection(section));
  const [agentId, setAgentId] = useState<string>();
  const data = useWorkspaceData(agentId, { includeDrafts: true });
  const workspaceId = data.workspace?.id;

  // Per-agent sections need a chosen model; expose a picker at the top. The
  // agents section has its own list beside the editor, so a second control for
  // the same choice would just disagree with it.
  const agentPicker =
    data.agents.length > 0 && section !== "agents" ? (
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
        items: group.items.map((item) => ({
          key: item.key,
          label: t(item.labelKey),
          icon: item.icon,
        })),
      }))}
      route="/workspace"
      title={t("workspace")}
      onSectionIntent={preloadWorkspaceSection}
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
      {/* One Page owns the header and rhythm for every workspace section, the
          same way the admin route does. */}
      <Page
        actions={agentPicker}
        description={t(META[section]!.descriptionKey)}
        title={t(META[section]!.titleKey)}
      >
        <Suspense
          fallback={
            <div className="rm-loading" role="status">
              {t("loading")}
            </div>
          }
        >
          {/* Master–detail: the model you are editing stays visible in a list
            beside the editor, instead of hiding behind a header dropdown that
            showed neither the set nor its size. */}
          {section === "agents" ? (
            <MasterDetail
              list={
                <MasterList>
                  {data.agents.map((agent) => (
                    <MasterListItem
                      badge={
                        agent.publishedVersionId === undefined
                          ? t("agentDraftOnly")
                          : t("agentPublished")
                      }
                      key={agent.id}
                      meta={agent.baseModelId}
                      onSelect={() => setAgentId(agent.id)}
                      selected={agent.id === data.activeAgent?.id}
                      title={agent.name}
                    />
                  ))}
                </MasterList>
              }
            >
              <AgentStudioPanel
                activeAgent={data.activeAgent}
                activeTab={resolveAgentStudioTab(search.tab)}
                isAdmin={data.subject?.isAdmin === true}
                models={data.models}
                onAgentCreated={setAgentId}
                onTabChange={(tab) =>
                  void navigate({
                    search: (previous) => ({
                      ...previous,
                      section: "agents",
                      tab,
                    }),
                  })
                }
                providers={data.providers}
                workspaceId={workspaceId}
              />
            </MasterDetail>
          ) : null}

          {section === "knowledge" ? (
            <KnowledgePanel
              activeAgent={data.activeAgent}
              isAdmin={data.subject?.isAdmin === true}
              onSelectionChange={(resource) =>
                void navigate({
                  search: (previous) => {
                    const { resource: _resource, ...rest } = previous;
                    return {
                      ...rest,
                      section: "knowledge",
                      ...(resource ? { resource } : {}),
                    };
                  },
                })
              }
              selectedKnowledgeBaseId={search.resource}
              workspaceId={workspaceId}
            />
          ) : null}

          {section === "tools" ? (
            <WorkspaceToolsSection
              activeAgent={data.activeAgent}
              tools={data.tools}
            />
          ) : null}

          {section === "voice" ? (
            <VoicePanel
              activeAgent={data.activeAgent}
              onSelectionChange={(resource) =>
                void navigate({
                  search: (previous) => {
                    const { resource: _resource, ...rest } = previous;
                    return {
                      ...rest,
                      section: "voice",
                      ...(resource ? { resource } : {}),
                    };
                  },
                })
              }
              selectedVoiceId={search.resource}
              workspaceId={workspaceId}
            />
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
        </Suspense>
      </Page>
    </ConsoleLayout>
  );
}
