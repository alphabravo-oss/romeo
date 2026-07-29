import Activity from "lucide-react/dist/esm/icons/activity.mjs";
import BarChart3 from "lucide-react/dist/esm/icons/bar-chart-3.mjs";
import Bell from "lucide-react/dist/esm/icons/bell.mjs";
import Building2 from "lucide-react/dist/esm/icons/building-2.mjs";
import CreditCard from "lucide-react/dist/esm/icons/credit-card.mjs";
import Database from "lucide-react/dist/esm/icons/database.mjs";
import FileText from "lucide-react/dist/esm/icons/file-text.mjs";
import KeyRound from "lucide-react/dist/esm/icons/key-round.mjs";
import KeySquare from "lucide-react/dist/esm/icons/key-square.mjs";
import LayoutDashboard from "lucide-react/dist/esm/icons/layout-dashboard.mjs";
import LineChart from "lucide-react/dist/esm/icons/line-chart.mjs";
import Link2 from "lucide-react/dist/esm/icons/link-2.mjs";
import Plug from "lucide-react/dist/esm/icons/plug.mjs";
import ScrollText from "lucide-react/dist/esm/icons/scroll-text.mjs";
import Search from "lucide-react/dist/esm/icons/search.mjs";
import Server from "lucide-react/dist/esm/icons/server.mjs";
import ShieldAlert from "lucide-react/dist/esm/icons/shield-alert.mjs";
import ShieldCheck from "lucide-react/dist/esm/icons/shield-check.mjs";
import UserCog from "lucide-react/dist/esm/icons/user-cog.mjs";
import Users from "lucide-react/dist/esm/icons/users.mjs";
import UsersRound from "lucide-react/dist/esm/icons/users-round.mjs";
import Webhook from "lucide-react/dist/esm/icons/webhook.mjs";
import Workflow from "lucide-react/dist/esm/icons/workflow.mjs";

import type { MessageKey } from "../lib/i18n";

export const ADMIN_GROUPS: Array<{
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

export const ADMIN_META: Record<
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
