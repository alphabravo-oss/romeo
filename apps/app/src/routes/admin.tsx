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
import Smartphone from "lucide-react/dist/esm/icons/smartphone.mjs";
import ScrollText from "lucide-react/dist/esm/icons/scroll-text.mjs";
import Server from "lucide-react/dist/esm/icons/server.mjs";
import ShieldCheck from "lucide-react/dist/esm/icons/shield-check.mjs";
import UserCog from "lucide-react/dist/esm/icons/user-cog.mjs";
import Users from "lucide-react/dist/esm/icons/users.mjs";
import UsersRound from "lucide-react/dist/esm/icons/users-round.mjs";
import Webhook from "lucide-react/dist/esm/icons/webhook.mjs";
import Workflow from "lucide-react/dist/esm/icons/workflow.mjs";

import { AdminOverview } from "../components/AdminOverview";
import { AbuseControlsPanel } from "../components/AbuseControlsPanel";
import { AnalyticsPanel } from "../components/AnalyticsPanel";
import { ApiKeyPanel } from "../components/ApiKeyPanel";
import { AuditPanel } from "../components/AuditPanel";
import { BillingPanel } from "../components/BillingPanel";
import { ConsoleLayout } from "../components/ConsoleLayout";
import { PageHeader } from "../components/PageHeader";
import { ConnectedAppsPanel } from "../components/ConnectedAppsPanel";
import { DataConnectorPanel } from "../components/DataConnectorPanel";
import { AuthProvidersPanel } from "../components/AuthProvidersPanel";
import { DeviceTokensPanel } from "../components/DeviceTokensPanel";
import { GovernancePanel } from "../components/GovernancePanel";
import { GroupsPanel } from "../components/GroupsPanel";
import { ImpersonationPanel } from "../components/ImpersonationPanel";
import { ModelPricingPanel } from "../components/ModelPricingPanel";
import { NotificationChannelPanel } from "../components/NotificationChannelPanel";
import { OperationsPosturePanel } from "../components/OperationsPosturePanel";
import { OrganizationsPanel } from "../components/OrganizationsPanel";
import { PromptTemplatePanel } from "../components/PromptTemplatePanel";
import { RagGovernancePanel } from "../components/RagGovernancePanel";
import { ProviderPanel } from "../components/ProviderPanel";
import { QuotaPanel } from "../components/QuotaPanel";
import { ServiceAccountPanel } from "../components/ServiceAccountPanel";
import { ToolConnectorPanel } from "../components/ToolConnectorPanel";
import { useAdminController } from "../components/useAdminController";
import { UsagePanel } from "../components/UsagePanel";
import { UsersPanel } from "../components/UsersPanel";
import { WebhooksPanel } from "../components/WebhooksPanel";
import { WorkflowsPanel } from "../components/WorkflowsPanel";

export const Route = createFileRoute("/admin")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { section?: string } =>
    typeof search.section === "string" ? { section: search.section } : {},
  component: AdminPage,
});

const GROUPS = [
  {
    label: "Operations",
    items: [
      { key: "overview", label: "Overview", icon: LayoutDashboard },
      { key: "usage", label: "Usage & quotas", icon: BarChart3 },
      { key: "analytics", label: "Analytics", icon: LineChart },
      { key: "audit", label: "Audit log", icon: ScrollText },
      { key: "posture", label: "System posture", icon: Activity },
    ],
  },
  {
    label: "Configuration",
    items: [
      { key: "providers", label: "Providers", icon: Server },
      { key: "connections", label: "Connections", icon: Plug },
      { key: "governance", label: "Governance", icon: ShieldCheck },
      { key: "rag", label: "RAG governance", icon: Database },
      { key: "abuse", label: "Abuse & security", icon: ShieldAlert },
      { key: "billing", label: "Billing", icon: CreditCard },
      { key: "prompt-templates", label: "Prompt templates", icon: FileText },
    ],
  },
  {
    label: "Access & identity",
    items: [
      { key: "access", label: "Access & keys", icon: KeyRound },
      { key: "users", label: "Users", icon: Users },
      { key: "groups", label: "Groups", icon: UsersRound },
      { key: "organizations", label: "Organizations", icon: Building2 },
      { key: "impersonation", label: "Impersonation", icon: UserCog },
      { key: "device-tokens", label: "Device tokens", icon: Smartphone },
      { key: "auth-providers", label: "Authentication", icon: KeySquare },
    ],
  },
  {
    label: "Automation",
    items: [
      { key: "workflows", label: "Workflows", icon: Workflow },
      { key: "webhooks", label: "Webhooks", icon: Webhook },
      { key: "notification-channels", label: "Notifications", icon: Bell },
      { key: "connected-apps", label: "Connected apps", icon: Link2 },
    ],
  },
];

const META: Record<string, { title: string; description: string }> = {
  overview: {
    title: "Overview",
    description: "Organization health, providers, jobs, and agents at a glance.",
  },
  usage: {
    title: "Usage & quotas",
    description: "Consumption across the organization and per-workspace limits.",
  },
  analytics: {
    title: "Analytics",
    description: "Cross-organization rollup of usage, evals, providers, and tools.",
  },
  audit: {
    title: "Audit log",
    description: "A record of security-relevant actions across the organization.",
  },
  posture: {
    title: "System posture",
    description: "Release-readiness, Postgres, job queue, and quota coordination health.",
  },
  providers: {
    title: "Providers",
    description: "Model providers, connections, and per-model pricing.",
  },
  connections: {
    title: "Connections",
    description: "Data sources and external tool integrations.",
  },
  governance: {
    title: "Governance",
    description: "Retention, lifecycle, data-deletion, and data-export controls.",
  },
  rag: {
    title: "RAG governance",
    description: "Retrieval policy, posture, change requests, and replay evaluation.",
  },
  abuse: {
    title: "Abuse & security",
    description: "Abuse controls and edge-security posture.",
  },
  access: {
    title: "Access & keys",
    description: "API keys and service accounts. Configure sign-on under Authentication.",
  },
  billing: {
    title: "Billing",
    description: "Plan, quota templates, and external billing events.",
  },
  "prompt-templates": {
    title: "Prompt templates",
    description: "Reusable prompt templates and the shared marketplace.",
  },
  users: {
    title: "Users",
    description: "Members of the organization and their account status.",
  },
  groups: {
    title: "Groups",
    description: "Access groups and their membership.",
  },
  organizations: {
    title: "Organizations",
    description: "Organizations visible to your account.",
  },
  impersonation: {
    title: "Impersonation",
    description: "Review and act on support impersonation requests.",
  },
  workflows: {
    title: "Workflows",
    description: "Workflow templates, runs, and approval gates.",
  },
  webhooks: {
    title: "Webhooks",
    description: "Outbound webhook subscriptions and delivery history.",
  },
  "notification-channels": {
    title: "Notifications",
    description: "Delivery channels and notification history.",
  },
  "device-tokens": {
    title: "Device tokens",
    description: "Long-lived device credentials and their scopes.",
  },
  "auth-providers": {
    title: "Authentication",
    description: "Enable and configure single sign-on providers.",
  },
  "connected-apps": {
    title: "Connected apps",
    description: "Delegated OAuth providers and active connections.",
  },
};

function AdminPage() {
  const admin = useAdminController();
  const { section: sectionParam } = Route.useSearch();
  const navigate = Route.useNavigate();
  const section = sectionParam ?? "overview";

  // Client-side gate is UX only — the API enforces real authz on every
  // admin endpoint. ponytail: no beforeLoad/router-context plumbing needed.
  if (admin.subject === undefined) {
    return <div className="rm-empty">Loading…</div>;
  }
  if (admin.subject.isAdmin !== true) {
    return (
      <div className="rm-admin-denied">
        <h1>Admins only</h1>
        <p>You don’t have access to the admin console.</p>
        <Link className="rm-button" to="/">
          Back to workspace
        </Link>
      </div>
    );
  }

  return (
    <ConsoleLayout
      active={section}
      groups={GROUPS}
      onSelect={(key) => void navigate({ search: { section: key } })}
      title="Admin"
    >
      <PageHeader
        description={META[section]!.description}
        title={META[section]!.title}
      />
      {admin.error ? (
        <div className="rm-composer-error">{admin.error}</div>
      ) : null}

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
            onCreateProvider={(input) => void admin.handleCreateProvider(input)}
            onSyncProvider={(providerId) =>
              void admin.handleSyncProvider(providerId)
            }
            operationalSummary={admin.providerOperationalSummary}
            providers={admin.providers}
            syncingProviderId={admin.syncingProviderId}
          />
          <ModelPricingPanel
            isUpdating={admin.isUpdatingModelPricing}
            models={admin.models}
            onUpdatePricing={(input) =>
              void admin.handleUpdateModelPricing(input)
            }
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

      {section === "users" ? <UsersPanel /> : null}

      {section === "groups" ? <GroupsPanel /> : null}

      {section === "organizations" ? <OrganizationsPanel /> : null}

      {section === "impersonation" ? <ImpersonationPanel /> : null}

      {section === "device-tokens" ? <DeviceTokensPanel /> : null}

      {section === "auth-providers" ? <AuthProvidersPanel /> : null}

      {section === "connected-apps" ? <ConnectedAppsPanel /> : null}

      {section === "workflows" ? <WorkflowsPanel /> : null}

      {section === "webhooks" ? <WebhooksPanel /> : null}

      {section === "notification-channels" ? (
        <NotificationChannelPanel />
      ) : null}
    </ConsoleLayout>
  );
}
