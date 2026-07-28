import { Link, createFileRoute } from "@tanstack/react-router";
import LayoutDashboard from "lucide-react/dist/esm/icons/layout-dashboard.mjs";
import Activity from "lucide-react/dist/esm/icons/activity.mjs";
import BarChart3 from "lucide-react/dist/esm/icons/bar-chart-3.mjs";
import Bell from "lucide-react/dist/esm/icons/bell.mjs";
import Database from "lucide-react/dist/esm/icons/database.mjs";
import LineChart from "lucide-react/dist/esm/icons/line-chart.mjs";
import ShieldAlert from "lucide-react/dist/esm/icons/shield-alert.mjs";
import Building2 from "lucide-react/dist/esm/icons/building-2.mjs";
import CreditCard from "lucide-react/dist/esm/icons/credit-card.mjs";
import FileText from "lucide-react/dist/esm/icons/file-text.mjs";
import KeyRound from "lucide-react/dist/esm/icons/key-round.mjs";
import Link2 from "lucide-react/dist/esm/icons/link-2.mjs";
import Plug from "lucide-react/dist/esm/icons/plug.mjs";
import KeySquare from "lucide-react/dist/esm/icons/key-square.mjs";
import ScrollText from "lucide-react/dist/esm/icons/scroll-text.mjs";
import Server from "lucide-react/dist/esm/icons/server.mjs";
import ShieldCheck from "lucide-react/dist/esm/icons/shield-check.mjs";
import UserCog from "lucide-react/dist/esm/icons/user-cog.mjs";
import Users from "lucide-react/dist/esm/icons/users.mjs";
import UsersRound from "lucide-react/dist/esm/icons/users-round.mjs";
import Webhook from "lucide-react/dist/esm/icons/webhook.mjs";
import Workflow from "lucide-react/dist/esm/icons/workflow.mjs";
import Search from "lucide-react/dist/esm/icons/search.mjs";
import { Suspense, lazy } from "react";
import { Button } from "@romeo/ui";

import { ConsoleLayout } from "../components/ConsoleLayout";
import { PageHeader } from "../components/PageHeader";
import { WorkspaceUserMenu } from "../components/WorkspaceUserMenu";
import { useAdminController } from "../components/useAdminController";
import {
  localeNamespaceGroups,
  type MessageKey,
  useLocale,
  useLocaleNamespaces,
} from "../lib/i18n";
import { resolveSectionKey } from "../lib/section-routing";

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

export const Route = createFileRoute("/admin")({
  validateSearch: (search: Record<string, unknown>): { section?: string } =>
    typeof search.section === "string" ? { section: search.section } : {},
  component: AdminPage,
});

const GROUPS: Array<{
  labelKey: MessageKey;
  items: Array<{
    key: string;
    labelKey: MessageKey;
    icon: React.ComponentType<any>;
  }>;
}> = [
  {
    labelKey: "navOperations",
    items: [
      { key: "overview", labelKey: "navOverview", icon: LayoutDashboard },
      { key: "usage", labelKey: "navUsageQuotas", icon: BarChart3 },
      { key: "analytics", labelKey: "navAnalytics", icon: LineChart },
      { key: "audit", labelKey: "navAuditLog", icon: ScrollText },
      { key: "posture", labelKey: "navSystemPosture", icon: Activity },
    ],
  },
  {
    labelKey: "navConfiguration",
    items: [
      { key: "providers", labelKey: "navProviders", icon: Server },
      { key: "connections", labelKey: "navConnections", icon: Plug },
      { key: "governance", labelKey: "navGovernance", icon: ShieldCheck },
      { key: "rag", labelKey: "navRagGovernance", icon: Database },
      { key: "abuse", labelKey: "navAbuseSecurity", icon: ShieldAlert },
      { key: "billing", labelKey: "navBilling", icon: CreditCard },
      {
        key: "prompt-templates",
        labelKey: "navPromptTemplates",
        icon: FileText,
      },
      { key: "web-search", labelKey: "navWebSearch", icon: Search },
    ],
  },
  {
    labelKey: "navAccessIdentity",
    items: [
      { key: "access", labelKey: "navAccessKeys", icon: KeyRound },
      { key: "users", labelKey: "navUsers", icon: Users },
      { key: "groups", labelKey: "navGroups", icon: UsersRound },
      { key: "organizations", labelKey: "navOrganizations", icon: Building2 },
      { key: "impersonation", labelKey: "navImpersonation", icon: UserCog },
      { key: "auth-providers", labelKey: "navAuthentication", icon: KeySquare },
    ],
  },
  {
    labelKey: "navAutomation",
    items: [
      { key: "workflows", labelKey: "navWorkflows", icon: Workflow },
      { key: "webhooks", labelKey: "navWebhooks", icon: Webhook },
      {
        key: "notification-channels",
        labelKey: "navNotifications",
        icon: Bell,
      },
      { key: "connected-apps", labelKey: "navConnectedApps", icon: Link2 },
    ],
  },
];

const META: Record<
  string,
  { titleKey: MessageKey; descriptionKey: MessageKey }
> = {
  overview: {
    titleKey: "navOverview",
    descriptionKey: "adminOverviewDescription",
  },
  usage: {
    titleKey: "navUsageQuotas",
    descriptionKey: "adminUsageDescription",
  },
  analytics: {
    titleKey: "navAnalytics",
    descriptionKey: "adminAnalyticsDescription",
  },
  audit: { titleKey: "navAuditLog", descriptionKey: "adminAuditDescription" },
  posture: {
    titleKey: "navSystemPosture",
    descriptionKey: "adminPostureDescription",
  },
  providers: {
    titleKey: "navProviders",
    descriptionKey: "adminProvidersDescription",
  },
  connections: {
    titleKey: "navConnections",
    descriptionKey: "adminConnectionsDescription",
  },
  governance: {
    titleKey: "navGovernance",
    descriptionKey: "adminGovernanceDescription",
  },
  rag: { titleKey: "navRagGovernance", descriptionKey: "adminRagDescription" },
  abuse: {
    titleKey: "navAbuseSecurity",
    descriptionKey: "adminAbuseDescription",
  },
  access: {
    titleKey: "navAccessKeys",
    descriptionKey: "adminAccessDescription",
  },
  billing: {
    titleKey: "navBilling",
    descriptionKey: "adminBillingDescription",
  },
  "prompt-templates": {
    titleKey: "navPromptTemplates",
    descriptionKey: "adminPromptTemplatesDescription",
  },
  "web-search": {
    titleKey: "navWebSearch",
    descriptionKey: "adminWebSearchDescription",
  },
  users: { titleKey: "navUsers", descriptionKey: "adminUsersDescription" },
  groups: { titleKey: "navGroups", descriptionKey: "adminGroupsDescription" },
  organizations: {
    titleKey: "navOrganizations",
    descriptionKey: "adminOrganizationsDescription",
  },
  impersonation: {
    titleKey: "navImpersonation",
    descriptionKey: "adminImpersonationDescription",
  },
  workflows: {
    titleKey: "navWorkflows",
    descriptionKey: "adminWorkflowsDescription",
  },
  webhooks: {
    titleKey: "navWebhooks",
    descriptionKey: "adminWebhooksDescription",
  },
  "notification-channels": {
    titleKey: "navNotifications",
    descriptionKey: "adminNotificationsDescription",
  },
  "auth-providers": {
    titleKey: "navAuthentication",
    descriptionKey: "adminAuthenticationDescription",
  },
  "connected-apps": {
    titleKey: "navConnectedApps",
    descriptionKey: "adminConnectedAppsDescription",
  },
};

function AdminPage() {
  useLocaleNamespaces(localeNamespaceGroups.admin);
  const { t } = useLocale();
  const admin = useAdminController();
  const { section: sectionParam } = Route.useSearch();
  const navigate = Route.useNavigate();
  const section = resolveSectionKey(sectionParam, META, "overview");

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
      groups={GROUPS.map((group) => ({
        label: t(group.labelKey),
        items: group.items.map((item) => ({
          key: item.key,
          label: t(item.labelKey),
          icon: item.icon,
        })),
      }))}
      onSelect={(key) => void navigate({ search: { section: key } })}
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
        description={t(META[section]!.descriptionKey)}
        title={t(META[section]!.titleKey)}
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
            <UsagePanel />
            <QuotaPanel />
          </div>
        ) : null}

        {section === "analytics" ? <AnalyticsPanel /> : null}

        {section === "audit" ? <AuditPanel /> : null}

        {section === "posture" ? <OperationsPosturePanel /> : null}

        {section === "providers" ? (
          <div className="grid gap-4">
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
            <ModelCatalogPanel
              isUpdating={admin.isUpdatingModelPricing || admin.isUpdatingModel}
              models={admin.models}
              providers={admin.providers}
              onUpdateModel={admin.handleUpdateModel}
              onUpdatePricing={admin.handleUpdateModelPricing}
            />
          </div>
        ) : null}

        {section === "connections" ? (
          <div className="grid gap-4">
            <DataConnectorPanel workspaceId={admin.workspace?.id} />
            <ToolConnectorPanel />
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
