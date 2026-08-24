import { lazy } from "react";

import { createRetryableImport } from "../lib/retryable-import";

const panelPreloads = new Map<string, () => Promise<unknown>>();

function lazyNamed<
  T extends Record<K, React.ComponentType<any>>,
  K extends keyof T,
>(loader: () => Promise<T>, name: K) {
  const load = createRetryableImport(loader);
  panelPreloads.set(String(name), load);
  return lazy(async () => ({ default: (await load())[name] }));
}

export const AdminOverview = lazyNamed(
  () => import("./AdminOverview"),
  "AdminOverview",
);
export const AbuseControlsPanel = lazyNamed(
  () => import("./AbuseControlsPanel"),
  "AbuseControlsPanel",
);
export const AnalyticsPanel = lazyNamed(
  () => import("./AnalyticsPanel"),
  "AnalyticsPanel",
);
export const ApiKeyPanel = lazyNamed(
  () => import("./ApiKeyPanel"),
  "ApiKeyPanel",
);
export const AuditPanel = lazyNamed(() => import("./AuditPanel"), "AuditPanel");
export const BillingPanel = lazyNamed(
  () => import("./BillingPanel"),
  "BillingPanel",
);
export const ConnectedAppsPanel = lazyNamed(
  () => import("./ConnectedAppsPanel"),
  "ConnectedAppsPanel",
);
export const ChatExperiencePanel = lazyNamed(
  () => import("./ChatExperiencePanel"),
  "ChatExperiencePanel",
);
export const CapabilityAdminPanel = lazyNamed(
  () => import("./CapabilityAdminPanel"),
  "CapabilityAdminPanel",
);
export const DataConnectorPanel = lazyNamed(
  () => import("./DataConnectorPanel"),
  "DataConnectorPanel",
);
export const AuthProvidersPanel = lazyNamed(
  () => import("./AuthProvidersPanel"),
  "AuthProvidersPanel",
);
export const GovernancePanel = lazyNamed(
  () => import("./GovernancePanel"),
  "GovernancePanel",
);
export const GroupsPanel = lazyNamed(
  () => import("./GroupsPanel"),
  "GroupsPanel",
);
export const ImpersonationPanel = lazyNamed(
  () => import("./ImpersonationPanel"),
  "ImpersonationPanel",
);
export const ModelCatalogPanel = lazyNamed(
  () => import("./ModelCatalogPanel"),
  "ModelCatalogPanel",
);
export const ManagedModelAdminPanel = lazyNamed(
  () => import("./ManagedModelAdminPanel"),
  "ManagedModelAdminPanel",
);
export const NotificationChannelPanel = lazyNamed(
  () => import("./NotificationChannelPanel"),
  "NotificationChannelPanel",
);
export const OperationsPosturePanel = lazyNamed(
  () => import("./OperationsPosturePanel"),
  "OperationsPosturePanel",
);
export const OrganizationsPanel = lazyNamed(
  () => import("./OrganizationsPanel"),
  "OrganizationsPanel",
);
export const PromptTemplatePanel = lazyNamed(
  () => import("./PromptTemplatePanel"),
  "PromptTemplatePanel",
);
export const RagGovernancePanel = lazyNamed(
  () => import("./RagGovernancePanel"),
  "RagGovernancePanel",
);
export const ProviderPanel = lazyNamed(
  () => import("./ProviderPanel"),
  "ProviderPanel",
);
export const ProviderObservabilityPanel = lazyNamed(
  () => import("./ProviderObservabilityPanel"),
  "ProviderObservabilityPanel",
);
export const QuotaPanel = lazyNamed(() => import("./QuotaPanel"), "QuotaPanel");
export const ServiceAccountPanel = lazyNamed(
  () => import("./ServiceAccountPanel"),
  "ServiceAccountPanel",
);
export const ToolConnectorPanel = lazyNamed(
  () => import("./ToolConnectorPanel"),
  "ToolConnectorPanel",
);
export const TrustComputePanel = lazyNamed(
  () => import("./TrustComputePanel"),
  "TrustComputePanel",
);
export const UsagePanel = lazyNamed(() => import("./UsagePanel"), "UsagePanel");
export const UsersPanel = lazyNamed(() => import("./UsersPanel"), "UsersPanel");
export const WebhooksPanel = lazyNamed(
  () => import("./WebhooksPanel"),
  "WebhooksPanel",
);
export const WebSearchPanel = lazyNamed(
  () => import("./WebSearchPanel"),
  "WebSearchPanel",
);
export const WorkspaceMembersPanel = lazyNamed(
  () => import("./WorkspaceMembersPanel"),
  "WorkspaceMembersPanel",
);

const sectionPanelNames: Readonly<Record<string, readonly string[]>> = {
  overview: ["AdminOverview"],
  usage: ["UsagePanel", "QuotaPanel"],
  analytics: ["AnalyticsPanel"],
  audit: ["AuditPanel"],
  posture: ["OperationsPosturePanel"],
  providers: [
    "ProviderPanel",
    "ModelCatalogPanel",
    "ManagedModelAdminPanel",
    "ProviderObservabilityPanel",
  ],
  "chat-experience": ["ChatExperiencePanel"],
  connections: ["ToolConnectorPanel", "DataConnectorPanel"],
  governance: ["GovernancePanel"],
  capabilities: ["CapabilityAdminPanel"],
  compute: ["TrustComputePanel"],
  access: ["ApiKeyPanel", "ServiceAccountPanel"],
  rag: ["RagGovernancePanel"],
  abuse: ["AbuseControlsPanel"],
  billing: ["BillingPanel"],
  "prompt-templates": ["PromptTemplatePanel"],
  "web-search": ["WebSearchPanel"],
  users: ["UsersPanel"],
  groups: ["GroupsPanel"],
  "workspace-members": ["WorkspaceMembersPanel"],
  organizations: ["OrganizationsPanel"],
  impersonation: ["ImpersonationPanel"],
  "auth-providers": ["AuthProvidersPanel"],
  "connected-apps": ["ConnectedAppsPanel"],
  webhooks: ["WebhooksPanel"],
  "notification-channels": ["NotificationChannelPanel"],
};

/** Loads code only. Route data remains behind the authenticated route loader. */
export async function preloadAdminSection(section: string): Promise<void> {
  await Promise.all(
    (sectionPanelNames[section] ?? []).map((name) =>
      panelPreloads.get(name)?.(),
    ),
  );
}
