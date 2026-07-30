import { lazy } from "react";

function lazyNamed<
  T extends Record<K, React.ComponentType<any>>,
  K extends keyof T,
>(loader: () => Promise<T>, name: K) {
  return lazy(async () => ({ default: (await loader())[name] }));
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
export const UsagePanel = lazyNamed(() => import("./UsagePanel"), "UsagePanel");
export const UsersPanel = lazyNamed(() => import("./UsersPanel"), "UsersPanel");
export const WebhooksPanel = lazyNamed(
  () => import("./WebhooksPanel"),
  "WebhooksPanel",
);
export const WorkflowsPanel = lazyNamed(
  () => import("./WorkflowsPanel"),
  "WorkflowsPanel",
);
export const WebSearchPanel = lazyNamed(
  () => import("./WebSearchPanel"),
  "WebSearchPanel",
);
