import { Link, createFileRoute } from "@tanstack/react-router";
import { Suspense, useCallback } from "react";
import { Button } from "@romeo/ui";

import { ConsoleLayout } from "../components/ConsoleLayout";
import { AdminViewNav } from "../components/AdminViewNav";
import { Page } from "../components/console";
import { WorkspaceUserMenu } from "../components/WorkspaceUserMenu";
import { AdminUsersRoutePanel } from "../components/AdminUsersRoutePanel";
import {
  ADMIN_GROUPS,
  ADMIN_META,
} from "../components/admin-console-navigation";
import { useAdminController } from "../components/useAdminController";
import {
  localeNamespaceGroups,
  useLocale,
  useLocaleNamespaces,
} from "../lib/i18n";
import { resolveSectionKey } from "../lib/section-routing";
import {
  resolveAgentStudioTab,
  type AgentStudioTab,
} from "../components/AgentStudioPanel";
import { modelAvailabilityFilter } from "../components/model-catalog-navigation";
import {
  AbuseControlsPanel,
  AdminOverview,
  AnalyticsPanel,
  ApiKeyPanel,
  AuditPanel,
  AuthProvidersPanel,
  BillingPanel,
  ChatExperiencePanel,
  ConnectedAppsPanel,
  DataConnectorPanel,
  GovernancePanel,
  GroupsPanel,
  ImpersonationPanel,
  ManagedModelAdminPanel,
  ModelCatalogPanel,
  NotificationChannelPanel,
  OperationsPosturePanel,
  OrganizationsPanel,
  PromptTemplatePanel,
  ProviderObservabilityPanel,
  ProviderPanel,
  QuotaPanel,
  RagGovernancePanel,
  ServiceAccountPanel,
  ToolConnectorPanel,
  UsagePanel,
  WebhooksPanel,
  WebSearchPanel,
  WorkflowsPanel,
  WorkspaceMembersPanel,
} from "../components/admin-lazy-panels";
import adminCss from "../styles/admin.css?url";

interface AdminSearch {
  availability?: string;
  connection?: string;
  direction?: string;
  managedModel?: string;
  managedModelTab?: string;
  model?: string;
  page?: number;
  provider?: string;
  query?: string;
  section?: string;
  sort?: string;
  toolConnector?: string;
  view?: string;
}

export const Route = createFileRoute("/admin")({
  head: () => ({
    links: [{ rel: "stylesheet", href: adminCss }],
  }),
  validateSearch: (search: Record<string, unknown>): AdminSearch => ({
    ...(typeof search.section === "string" ? { section: search.section } : {}),
    ...(typeof search.view === "string" ? { view: search.view } : {}),
    ...(typeof search.query === "string" ? { query: search.query } : {}),
    ...(typeof search.provider === "string"
      ? { provider: search.provider }
      : {}),
    ...(typeof search.availability === "string"
      ? { availability: search.availability }
      : {}),
    ...(typeof search.connection === "string"
      ? { connection: search.connection }
      : {}),
    ...(typeof search.direction === "string"
      ? { direction: search.direction }
      : {}),
    ...(typeof search.managedModel === "string"
      ? { managedModel: search.managedModel }
      : {}),
    ...(typeof search.managedModelTab === "string"
      ? { managedModelTab: search.managedModelTab }
      : {}),
    ...(typeof search.model === "string" ? { model: search.model } : {}),
    ...(typeof search.sort === "string" ? { sort: search.sort } : {}),
    ...(typeof search.toolConnector === "string"
      ? { toolConnector: search.toolConnector }
      : {}),
    ...(typeof search.page === "number" && Number.isInteger(search.page)
      ? { page: Math.max(0, search.page) }
      : {}),
  }),
  component: AdminPage,
});

function AdminPage() {
  useLocaleNamespaces(localeNamespaceGroups.admin);
  const { t } = useLocale();
  const admin = useAdminController();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { section: sectionParam } = search;
  const section = resolveSectionKey(sectionParam, ADMIN_META, "overview");
  const providerView =
    search.view === "models"
      ? "base-models"
      : ["providers", "base-models", "curated", "observability"].includes(
            search.view ?? "",
          )
        ? search.view!
        : "providers";
  const usageView = ["consumption", "quotas"].includes(search.view ?? "")
    ? search.view!
    : "consumption";
  const connectionView = ["sources", "imports", "catalog", "tools"].includes(
    search.view ?? "",
  )
    ? search.view!
    : "sources";
  const accessView = ["keys", "service-accounts"].includes(search.view ?? "")
    ? search.view!
    : "keys";
  const updateProviderSearch = useCallback(
    (next: {
      availability?:
        | "all"
        | "available"
        | "unavailable"
        | "enabled"
        | "disabled";
      direction?: "asc" | "desc";
      model?: string | null;
      page?: number;
      provider?: string;
      query?: string;
      sort?:
        | "availability"
        | "contextWindow"
        | "displayName"
        | "enabled"
        | "name";
    }) =>
      void navigate({
        search: (previous) => {
          const merged = {
            ...previous,
            section: "providers",
            view: "base-models",
            ...next,
          };
          if (merged.model !== null) return merged;
          const { model: _model, ...withoutModel } = merged;
          return withoutModel;
        },
      }),
    [navigate],
  );
  const updateManagedModelSearch = useCallback(
    (managedModel: string | null) =>
      void navigate({
        search: (previous) => {
          const {
            managedModel: _managedModel,
            managedModelTab: _managedModelTab,
            ...rest
          } = previous;
          return {
            ...rest,
            section: "providers",
            view: "curated",
            ...(managedModel ? { managedModel } : {}),
          };
        },
      }),
    [navigate],
  );
  const updateManagedModelTab = useCallback(
    (managedModelTab: AgentStudioTab) =>
      void navigate({
        search: (previous) => ({
          ...previous,
          section: "providers",
          view: "curated",
          managedModelTab,
        }),
      }),
    [navigate],
  );
  const updateProviderConnectionSearch = useCallback(
    (connection: string | null) =>
      void navigate({
        search: {
          section: "providers",
          view: "providers",
          ...(connection ? { connection } : {}),
        },
      }),
    [navigate],
  );
  const updateToolConnectorSearch = useCallback(
    (toolConnector: string | null) =>
      void navigate({
        search: (previous) => {
          const { toolConnector: _toolConnector, ...rest } = previous;
          return {
            ...rest,
            section: "connections",
            view: "tools",
            ...(toolConnector ? { toolConnector } : {}),
          };
        },
      }),
    [navigate],
  );

  // Client-side gate is UX only — the API enforces real authz on every
  // admin endpoint. ponytail: no beforeLoad/router-context plumbing needed.
  if (admin.subject === undefined) {
    return <div className="rm-empty">{t("loading")}</div>;
  }
  if (admin.subject.isAdmin !== true) {
    return (
      <div className="rm-admin-denied">
        <h1>{t("adminsOnly")}</h1>
        <p>{t("adminAccessDenied")}</p>
        <Button asChild>
          <Link to="/">{t("backToWorkspace")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <ConsoleLayout
      active={section}
      groups={ADMIN_GROUPS.map((group, index) => ({
        id: group.labelKey ?? `group-${index}`,
        ...(group.labelKey === undefined ? {} : { label: t(group.labelKey) }),
        items: group.items.map((item) => ({
          key: item.key,
          label: t(item.labelKey),
          icon: item.icon,
        })),
      }))}
      route="/admin"
      title={t("admin")}
      userMenu={
        <WorkspaceUserMenu
          isAdmin
          userLabel={
            admin.subject.name ??
            admin.subject.email ??
            admin.subject.id ??
            t("account")
          }
        />
      }
    >
      {/* One Page owns the header and the rhythm for every admin section, so a
          panel never renders its own page chrome and no two sections disagree
          about it. */}
      <Page
        description={t(ADMIN_META[section]!.descriptionKey)}
        title={t(ADMIN_META[section]!.titleKey)}
      >
        {admin.error ? (
          <div className="rm-composer-error">{admin.error}</div>
        ) : null}

        <Suspense
          fallback={
            <div className="rm-empty" role="status">
              {t("loadingSection")}
            </div>
          }
        >
          {section === "overview" ? (
            <AdminOverview
              agentCount={admin.agents.length}
              providerSummary={admin.providerOperationalSummary}
            />
          ) : null}

          {section === "usage" ? (
            <div className="grid gap-4">
              <AdminViewNav
                active={usageView}
                ariaLabel={t("navUsageQuotas")}
                items={[
                  ["consumption", t("usageConsumption")],
                  ["quotas", t("usageQuotas")],
                ]}
                section="usage"
              />
              {usageView === "consumption" ? <UsagePanel /> : null}
              {usageView === "quotas" ? <QuotaPanel /> : null}
            </div>
          ) : null}

          {section === "analytics" ? <AnalyticsPanel /> : null}

          {section === "audit" ? <AuditPanel /> : null}

          {section === "posture" ? <OperationsPosturePanel /> : null}

          {section === "providers" ? (
            <div className="grid min-w-0 gap-4">
              <AdminViewNav
                active={providerView}
                ariaLabel={t("navProviders")}
                items={[
                  ["providers", t("providers")],
                  ["base-models", t("baseModels")],
                  ["curated", t("curatedModels")],
                  ["observability", t("observability")],
                ]}
                section="providers"
              />
              {providerView === "providers" ? (
                <ProviderPanel
                  agents={admin.agents}
                  isCreating={admin.isCreatingProvider}
                  isUpdating={admin.isUpdatingProvider || admin.isUpdatingModel}
                  pullingProviderId={admin.pullingProviderId}
                  deletingModelId={admin.deletingModelId}
                  onCreateProvider={admin.handleCreateProvider}
                  onPullProviderModel={admin.handlePullProviderModel}
                  onDeleteProviderModel={admin.handleDeleteProviderModel}
                  onSyncProvider={admin.handleSyncProvider}
                  onUpdateModel={admin.handleUpdateModel}
                  onUpdateProvider={admin.handleUpdateProvider}
                  onVerifyProvider={admin.handleVerifyProvider}
                  operationalSummary={admin.providerOperationalSummary}
                  models={admin.models}
                  providers={admin.providers}
                  onProviderSelectionChange={updateProviderConnectionSearch}
                  selectedProviderId={search.connection}
                  syncingProviderId={admin.syncingProviderId}
                  verifyingProviderId={admin.verifyingProviderId}
                />
              ) : null}
              {providerView === "base-models" ? (
                <ModelCatalogPanel
                  agents={admin.agents}
                  availability={modelAvailabilityFilter(search.availability)}
                  isUpdating={
                    admin.isUpdatingModelPricing || admin.isUpdatingModel
                  }
                  models={admin.models}
                  onNavigationChange={updateProviderSearch}
                  direction={search.direction === "desc" ? "desc" : "asc"}
                  providers={admin.providers}
                  providerId={search.provider ?? "all"}
                  query={search.query ?? ""}
                  selectedModelId={search.model}
                  page={search.page ?? 0}
                  sort={
                    [
                      "availability",
                      "contextWindow",
                      "displayName",
                      "enabled",
                      "name",
                    ].includes(search.sort ?? "")
                      ? (search.sort as
                          | "availability"
                          | "contextWindow"
                          | "displayName"
                          | "enabled"
                          | "name")
                      : "displayName"
                  }
                  onUpdateModel={admin.handleUpdateModel}
                  onUpdatePricing={admin.handleUpdateModelPricing}
                  onManagedModelCreated={updateManagedModelSearch}
                  workspaceId={admin.workspace?.id}
                />
              ) : null}
              {providerView === "curated" ? (
                <ManagedModelAdminPanel
                  activeTab={resolveAgentStudioTab(search.managedModelTab)}
                  agents={admin.agents}
                  models={admin.models}
                  onNavigationChange={updateManagedModelSearch}
                  onTabChange={updateManagedModelTab}
                  providers={admin.providers}
                  selectedAgentId={search.managedModel}
                  workspaceDefaultAgentId={admin.workspace?.defaultAgentId}
                  workspaceId={admin.workspace?.id}
                />
              ) : null}
              {providerView === "observability" ? (
                <ProviderObservabilityPanel
                  operationalSummary={admin.providerOperationalSummary}
                  providers={admin.providers}
                />
              ) : null}
            </div>
          ) : null}

          {section === "chat-experience" ? <ChatExperiencePanel /> : null}

          {section === "connections" ? (
            <div className="grid gap-4">
              <AdminViewNav
                active={connectionView}
                ariaLabel={t("navConnections")}
                items={[
                  ["sources", t("connectorSourcesTab")],
                  ["imports", t("connectorImportsTab")],
                  ["catalog", t("connectorCatalogTab")],
                  ["tools", t("connectorToolsTab")],
                ]}
                section="connections"
              />
              {connectionView === "tools" ? (
                <ToolConnectorPanel
                  onSelectionChange={updateToolConnectorSearch}
                  selectedConnectorId={search.toolConnector}
                />
              ) : null}
              {connectionView !== "tools" ? (
                <DataConnectorPanel
                  view={connectionView as "catalog" | "imports" | "sources"}
                  workspaceId={admin.workspace?.id}
                />
              ) : null}
            </div>
          ) : null}

          {section === "governance" ? (
            <GovernancePanel
              activeChatId={undefined}
              onChatArchived={admin.handleChatArchived}
              onChatDeleted={admin.handleChatDeleted}
              onWorkspaceArchived={admin.handleWorkspaceArchived}
              workspace={admin.workspace}
            />
          ) : null}

          {section === "access" ? (
            <div className="grid gap-4">
              <AdminViewNav
                active={accessView}
                ariaLabel={t("navAccessKeys")}
                items={[
                  ["keys", t("navAccessKeys")],
                  ["service-accounts", t("serviceAccounts")],
                ]}
                section="access"
              />
              {accessView === "keys" ? <ApiKeyPanel /> : null}
              {accessView === "service-accounts" ? (
                <ServiceAccountPanel />
              ) : null}
            </div>
          ) : null}

          {section === "rag" ? <RagGovernancePanel /> : null}

          {section === "abuse" ? <AbuseControlsPanel /> : null}

          {section === "billing" ? <BillingPanel /> : null}

          {section === "prompt-templates" ? <PromptTemplatePanel /> : null}
          {section === "web-search" ? <WebSearchPanel /> : null}

          {section === "users" ? (
            <AdminUsersRoutePanel
              direction={search.direction}
              page={search.page}
              query={search.query}
              sort={search.sort}
            />
          ) : null}

          {section === "groups" ? <GroupsPanel /> : null}

          {section === "workspace-members" ? <WorkspaceMembersPanel /> : null}

          {section === "organizations" ? <OrganizationsPanel /> : null}

          {section === "impersonation" ? <ImpersonationPanel /> : null}

          {section === "auth-providers" ? <AuthProvidersPanel /> : null}

          {section === "connected-apps" ? <ConnectedAppsPanel /> : null}

          {section === "workflows" ? <WorkflowsPanel /> : null}

          {section === "webhooks" ? <WebhooksPanel /> : null}

          {section === "notification-channels" ? (
            <NotificationChannelPanel />
          ) : null}
        </Suspense>
      </Page>
    </ConsoleLayout>
  );
}
