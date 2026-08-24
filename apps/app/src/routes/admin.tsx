import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useMemo } from "react";
import { Button } from "@romeo/ui";

import { ConsoleLayout } from "../components/ConsoleLayout";
import { Page } from "../components/console";
import { WorkspaceUserMenu } from "../components/WorkspaceUserMenu";
import { AdminUsersRoutePanel } from "../components/AdminUsersRoutePanel";
import { AdminAuditRoutePanel } from "../components/AdminAuditRoutePanel";
import {
  ADMIN_GROUPS,
  ADMIN_META,
} from "../components/admin-console-navigation";
import { useAdminController } from "../components/useAdminController";
import { useAdminTabState } from "../components/useAdminTabState";
import { useAdminDetailNavigation } from "../components/useAdminDetailNavigation";
import {
  localeNamespacesForAdminSection,
  useLocale,
  useLocaleNamespaces,
} from "../lib/i18n";
import { resolveSectionKey } from "../lib/section-routing";
import { bootstrapQueryOptions } from "../lib/api-query-options";
import { useRouterApiClient } from "../lib/router-context";
import { resolveAgentStudioTab } from "../components/agent-studio-model";
import {
  AbuseControlsPanel,
  AdminOverview,
  AnalyticsPanel,
  ApiKeyPanel,
  AuthProvidersPanel,
  BillingPanel,
  CapabilityAdminPanel,
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
  TrustComputePanel,
  UsagePanel,
  WebhooksPanel,
  WebSearchPanel,
  WorkspaceMembersPanel,
  preloadAdminSection,
} from "../components/admin-lazy-panels";
import adminCss from "../styles/admin.css?url";
import { validateAdminSearch } from "./-admin-route-search";
import {
  resolveAdminAccessView,
  resolveAdminConnectionView,
  resolveAdminProviderView,
  resolveAdminUsageView,
} from "./-admin-route-views";
import { loadAdminRouteData } from "./-admin-route-loader";

const AdminViewNav = lazy(async () => ({
  default: (await import("../components/AdminViewNav")).AdminViewNav,
}));

export const Route = createFileRoute("/admin")({
  loaderDeps: ({ search }) => ({
    ...(search.section === undefined ? {} : { section: search.section }),
    ...(search.workspace === undefined
      ? {}
      : { workspaceId: search.workspace }),
  }),
  loader: loadAdminRouteData,
  head: () => ({
    links: [{ rel: "stylesheet", href: adminCss }],
  }),
  validateSearch: validateAdminSearch,
  component: AdminPage,
});

function AdminPage() {
  const { t } = useLocale();
  const admin = useAdminController();
  const apiClient = useRouterApiClient();
  const bootstrapQuery = useQuery(bootstrapQueryOptions(apiClient));
  const billingEnabled =
    bootstrapQuery.data?.deployment?.billingEnabled === true;
  const search = Route.useSearch();
  const tabState = useAdminTabState(search);
  const {
    updateManagedModelSearch,
    updateManagedModelTab,
    updateProviderConnectionSearch,
    updateToolConnectorSearch,
  } = useAdminDetailNavigation();
  const { section: sectionParam } = search;
  const section = resolveSectionKey(sectionParam, ADMIN_META, "overview");
  useLocaleNamespaces(localeNamespacesForAdminSection(section));
  const providerView = resolveAdminProviderView(search.view);
  const usageView = resolveAdminUsageView(search.view);
  const connectionView = resolveAdminConnectionView(search.view);
  const accessView = resolveAdminAccessView(search.view);
  const navigationGroups = useMemo(
    () =>
      ADMIN_GROUPS.map((group, index) => ({
        id: group.labelKey ?? `group-${index}`,
        ...(group.labelKey === undefined ? {} : { label: t(group.labelKey) }),
        items: group.items
          .filter((item) => billingEnabled || item.key !== "billing")
          .map((item) => ({
            key: item.key,
            label: t(item.labelKey),
            icon: item.icon,
          })),
      })),
    [billingEnabled, t],
  );
  // Client-side gate is UX only — the API enforces real authz on every
  // admin endpoint. ponytail: no beforeLoad/router-context plumbing needed.
  if (admin.subject === undefined) {
    return <div className="rm-loading">{t("loading")}</div>;
  }
  if (admin.subject.isAdmin !== true) {
    return (
      <div className="rm-admin-denied">
        <h1>{t("adminsOnly")}</h1>
        <p>{t("adminAccessDenied")}</p>
        <Button asChild>
          <Link preload="intent" to="/">
            {t("backToWorkspace")}
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <ConsoleLayout
      active={section}
      groups={navigationGroups}
      route="/admin"
      title={t("admin")}
      onSectionIntent={preloadAdminSection}
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
          <div className="rm-composer-error" role="alert">
            {admin.error}
          </div>
        ) : null}

        <Suspense
          fallback={
            <div className="rm-loading" role="status">
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

          {section === "audit" ? <AdminAuditRoutePanel /> : null}

          {section === "posture" ? (
            <OperationsPosturePanel tabState={tabState} />
          ) : null}

          {section === "providers" ? (
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
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
                  isUpdating={
                    admin.isUpdatingModelPricing || admin.isUpdatingModel
                  }
                  models={admin.models}
                  providers={admin.providers}
                  routeSearch={search}
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
              tabState={tabState}
              workspace={admin.workspace}
            />
          ) : null}

          {section === "capabilities" ? <CapabilityAdminPanel /> : null}
          {section === "compute" ? <TrustComputePanel /> : null}

          {section === "access" ? (
            <div className="grid gap-4">
              <AdminViewNav
                active={accessView}
                ariaLabel={t("navAccessKeys")}
                // "API keys", not the page's own name: a tab that repeats the
                // page title tells you nothing about what the tab contains.
                items={[
                  ["keys", t("apiKeys")],
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

          {section === "rag" ? (
            <RagGovernancePanel tabState={tabState} />
          ) : null}

          {section === "abuse" ? (
            <AbuseControlsPanel tabState={tabState} />
          ) : null}

          {section === "billing" && billingEnabled ? (
            <BillingPanel tabState={tabState} />
          ) : null}

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

          {section === "webhooks" ? <WebhooksPanel /> : null}

          {section === "notification-channels" ? (
            <NotificationChannelPanel tabState={tabState} />
          ) : null}
        </Suspense>
      </Page>
    </ConsoleLayout>
  );
}
