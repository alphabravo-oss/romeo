import { Link, createFileRoute } from "@tanstack/react-router";
import { Suspense, lazy, useCallback } from "react";
import { Button } from "@romeo/ui";

import { ConsoleLayout } from "../components/ConsoleLayout";
import { PageHeader } from "../components/PageHeader";
import { WorkspaceUserMenu } from "../components/WorkspaceUserMenu";
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
import adminCss from "../styles/admin.css?url";

function lazyNamed<
  T extends Record<K, React.ComponentType<any>>,
  K extends keyof T,
>(loader: () => Promise<T>, name: K) {
  return lazy(async () => ({ default: (await loader())[name] }));
}

const AdminOverview = lazyNamed(
  () => import("../components/AdminOverview"),
  "AdminOverview",
);
const AbuseControlsPanel = lazyNamed(
  () => import("../components/AbuseControlsPanel"),
  "AbuseControlsPanel",
);
const AnalyticsPanel = lazyNamed(
  () => import("../components/AnalyticsPanel"),
  "AnalyticsPanel",
);
const ApiKeyPanel = lazyNamed(
  () => import("../components/ApiKeyPanel"),
  "ApiKeyPanel",
);
const AuditPanel = lazyNamed(
  () => import("../components/AuditPanel"),
  "AuditPanel",
);
const BillingPanel = lazyNamed(
  () => import("../components/BillingPanel"),
  "BillingPanel",
);
const ConnectedAppsPanel = lazyNamed(
  () => import("../components/ConnectedAppsPanel"),
  "ConnectedAppsPanel",
);
const ChatExperiencePanel = lazyNamed(
  () => import("../components/ChatExperiencePanel"),
  "ChatExperiencePanel",
);
const DataConnectorPanel = lazyNamed(
  () => import("../components/DataConnectorPanel"),
  "DataConnectorPanel",
);
const AuthProvidersPanel = lazyNamed(
  () => import("../components/AuthProvidersPanel"),
  "AuthProvidersPanel",
);
const GovernancePanel = lazyNamed(
  () => import("../components/GovernancePanel"),
  "GovernancePanel",
);
const GroupsPanel = lazyNamed(
  () => import("../components/GroupsPanel"),
  "GroupsPanel",
);
const ImpersonationPanel = lazyNamed(
  () => import("../components/ImpersonationPanel"),
  "ImpersonationPanel",
);
const ModelCatalogPanel = lazyNamed(
  () => import("../components/ModelCatalogPanel"),
  "ModelCatalogPanel",
);
const NotificationChannelPanel = lazyNamed(
  () => import("../components/NotificationChannelPanel"),
  "NotificationChannelPanel",
);
const OperationsPosturePanel = lazyNamed(
  () => import("../components/OperationsPosturePanel"),
  "OperationsPosturePanel",
);
const OrganizationsPanel = lazyNamed(
  () => import("../components/OrganizationsPanel"),
  "OrganizationsPanel",
);
const PromptTemplatePanel = lazyNamed(
  () => import("../components/PromptTemplatePanel"),
  "PromptTemplatePanel",
);
const RagGovernancePanel = lazyNamed(
  () => import("../components/RagGovernancePanel"),
  "RagGovernancePanel",
);
const ProviderPanel = lazyNamed(
  () => import("../components/ProviderPanel"),
  "ProviderPanel",
);
const ProviderObservabilityPanel = lazyNamed(
  () => import("../components/ProviderObservabilityPanel"),
  "ProviderObservabilityPanel",
);
const QuotaPanel = lazyNamed(
  () => import("../components/QuotaPanel"),
  "QuotaPanel",
);
const ServiceAccountPanel = lazyNamed(
  () => import("../components/ServiceAccountPanel"),
  "ServiceAccountPanel",
);
const ToolConnectorPanel = lazyNamed(
  () => import("../components/ToolConnectorPanel"),
  "ToolConnectorPanel",
);
const UsagePanel = lazyNamed(
  () => import("../components/UsagePanel"),
  "UsagePanel",
);
const UsersPanel = lazyNamed(
  () => import("../components/UsersPanel"),
  "UsersPanel",
);
const WebhooksPanel = lazyNamed(
  () => import("../components/WebhooksPanel"),
  "WebhooksPanel",
);
const WorkflowsPanel = lazyNamed(
  () => import("../components/WorkflowsPanel"),
  "WorkflowsPanel",
);
const WebSearchPanel = lazyNamed(
  () => import("../components/WebSearchPanel"),
  "WebSearchPanel",
);

interface AdminSearch {
  availability?: string;
  model?: string;
  page?: number;
  provider?: string;
  query?: string;
  section?: string;
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
    ...(typeof search.model === "string" ? { model: search.model } : {}),
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
  const providerView = ["connections", "models", "observability"].includes(
    search.view ?? "",
  )
    ? search.view!
    : "connections";
  const usageView = ["consumption", "quotas"].includes(search.view ?? "")
    ? search.view!
    : "consumption";
  const connectionView = ["sources", "imports", "catalog", "tools"].includes(
    search.view ?? "",
  )
    ? search.view!
    : "sources";
  const updateProviderSearch = useCallback(
    (next: {
      availability?: "all" | "enabled" | "disabled";
      model?: string | null;
      page?: number;
      provider?: string;
      query?: string;
    }) =>
      void navigate({
        search: (previous) => {
          const merged = {
            ...previous,
            section: "providers",
            view: "models",
            ...next,
          };
          if (merged.model !== null) return merged;
          const { model: _model, ...withoutModel } = merged;
          return withoutModel;
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
      groups={ADMIN_GROUPS.map((group) => ({
        label: t(group.labelKey),
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
      <PageHeader
        description={t(ADMIN_META[section]!.descriptionKey)}
        title={t(ADMIN_META[section]!.titleKey)}
      />
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
          <div className="grid gap-4">
            <AdminViewNav
              active={providerView}
              ariaLabel={t("navProviders")}
              items={[
                ["connections", t("connections")],
                ["models", t("models")],
                ["observability", t("observability")],
              ]}
              section="providers"
            />
            {providerView === "connections" ? (
              <ProviderPanel
                isCreating={admin.isCreatingProvider}
                isUpdating={admin.isUpdatingProvider}
                pullingProviderId={admin.pullingProviderId}
                deletingModelId={admin.deletingModelId}
                onCreateProvider={admin.handleCreateProvider}
                onPullProviderModel={admin.handlePullProviderModel}
                onDeleteProviderModel={admin.handleDeleteProviderModel}
                onSyncProvider={admin.handleSyncProvider}
                onUpdateProvider={admin.handleUpdateProvider}
                onVerifyProvider={admin.handleVerifyProvider}
                operationalSummary={admin.providerOperationalSummary}
                models={admin.models}
                providers={admin.providers}
                syncingProviderId={admin.syncingProviderId}
                verifyingProviderId={admin.verifyingProviderId}
              />
            ) : null}
            {providerView === "models" ? (
              <ModelCatalogPanel
                availability={
                  search.availability === "enabled" ||
                  search.availability === "disabled"
                    ? search.availability
                    : "all"
                }
                isUpdating={
                  admin.isUpdatingModelPricing || admin.isUpdatingModel
                }
                models={admin.models}
                onNavigationChange={updateProviderSearch}
                providers={admin.providers}
                providerId={search.provider ?? "all"}
                query={search.query ?? ""}
                selectedModelId={search.model}
                page={search.page ?? 0}
                onUpdateModel={admin.handleUpdateModel}
                onUpdatePricing={admin.handleUpdateModelPricing}
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
            {connectionView === "tools" ? <ToolConnectorPanel /> : null}
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
            <ApiKeyPanel />
            <ServiceAccountPanel />
          </div>
        ) : null}

        {section === "rag" ? <RagGovernancePanel /> : null}

        {section === "abuse" ? <AbuseControlsPanel /> : null}

        {section === "billing" ? <BillingPanel /> : null}

        {section === "prompt-templates" ? <PromptTemplatePanel /> : null}
        {section === "web-search" ? <WebSearchPanel /> : null}

        {section === "users" ? <UsersPanel /> : null}

        {section === "groups" ? <GroupsPanel /> : null}

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
    </ConsoleLayout>
  );
}

function AdminViewNav({
  active,
  ariaLabel,
  items,
  section,
}: {
  active: string;
  ariaLabel: string;
  items: ReadonlyArray<readonly [string, string]>;
  section: string;
}) {
  return (
    <nav aria-label={ariaLabel} className="rm-ui-tabs">
      <div className="rm-ui-tabs__list">
        {items.map(([value, label]) => (
          <Button
            asChild
            className="rm-ui-tabs__trigger"
            data-state={active === value ? "active" : "inactive"}
            key={value}
            variant="ghost"
          >
            <Link
              aria-current={active === value ? "page" : undefined}
              search={{ section, view: value }}
              to="/admin"
            >
              {label}
            </Link>
          </Button>
        ))}
      </div>
    </nav>
  );
}
