import type { AuditLogTableRequest } from "../features/types";
import type { ContentKind } from "../features/workspace-content";
import type { Locale } from "./i18n";

type OptionalId = string | null | undefined;
type CatalogPage = { page: number; query: string };
type ShareTargetScope =
  | {
      context:
        | "access-editor"
        | "collaboration"
        | "group-members"
        | "impersonation";
    }
  | { query: string }
  | { resourceId: OptionalId };

const resourceKey = <const TRoot extends string, const TId>(
  root: TRoot,
  id: TId | undefined,
) => (id === undefined ? ([root] as const) : ([root, id] as const));

/**
 * Typed identities for app-owned server state. Generated SDK operations keep
 * their generated keys; client-only streaming rows are the sole exception.
 * Subject and organization isolation is provided by the request/session-owned
 * QueryClient and its mandatory logout/re-authentication purge.
 */
export const abuseControls = () => ["abuseControls"] as const;
export const accessReview = () => ["accessReview"] as const;
export const accessReviewReport = () => ["accessReviewReport"] as const;
export const adminAnalyticsSummary = (range: string) =>
  ["adminAnalyticsSummary", range] as const;
export const adminOrganizations = () => ["admin-organizations"] as const;
export const agentKnowledgeBindings = (agentId?: string) =>
  resourceKey("agentKnowledgeBindings", agentId);
export const agentReadiness = (
  agentId?: string,
  principalType?: string,
  principalId?: string,
) =>
  agentId === undefined
    ? (["agentReadiness"] as const)
    : principalType === undefined && principalId === undefined
      ? (["agentReadiness", agentId] as const)
      : (["agentReadiness", agentId, principalType, principalId] as const);
export const agentShares = (agentId?: string) =>
  resourceKey("agentShares", agentId);
export const agentTools = (agentId?: string) =>
  resourceKey("agentTools", agentId);
export const agentVersions = (agentId?: string) =>
  resourceKey("agentVersions", agentId);
export const agenticRagSettings = () => ["agenticRagSettings"] as const;
export const apiKeys = () => ["apiKeys"] as const;
export const auditLogs = (request?: AuditLogTableRequest) =>
  resourceKey("auditLogs", request);
export const authProviderCatalog = () => ["authProviderCatalog"] as const;
export const authProviderSettings = () => ["authProviderSettings"] as const;
export const billingEntitlements = () => ["billingEntitlements"] as const;
export const billingLifecycle = () => ["billingLifecycle"] as const;
export const billingPlan = () => ["billingPlan"] as const;
export const chat = (chatId?: string) => resourceKey("chat", chatId);
export const chatComments = (chatId?: string) =>
  resourceKey("chatComments", chatId);
export const chatExperience = () => ["chatExperience"] as const;
export const chatSearch = (workspaceId: OptionalId, query: string) =>
  ["chatSearch", workspaceId, query] as const;
export const chatShares = (chatId?: string, purpose?: "access") =>
  chatId === undefined
    ? (["chatShares"] as const)
    : purpose === undefined
      ? (["chatShares", chatId] as const)
      : (["chatShares", chatId, purpose] as const);
export const chatTags = () => ["chatTags"] as const;
export const chats = (workspaceId?: string, view?: "collaboration") =>
  workspaceId === undefined
    ? (["chats"] as const)
    : view === undefined
      ? (["chats", workspaceId] as const)
      : (["chats", workspaceId, view] as const);
export const chatsByTag = (tag?: string) => resourceKey("chatsByTag", tag);
export const commandCatalog = (
  resource: "agents" | "knowledge" | "prompts" | "tools" | "workflows",
  workspaceId?: string,
) =>
  workspaceId === undefined
    ? (["commandCatalog", resource] as const)
    : (["commandCatalog", resource, workspaceId] as const);
export const contentPolicy = () => ["contentPolicy"] as const;
export const contentPolicyVersions = () => ["contentPolicyVersions"] as const;
export const contentPolicyDecisions = () => ["contentPolicyDecisions"] as const;
export const contentPolicyApprovals = () => ["contentPolicyApprovals"] as const;
export const dataConnectorCatalog = () => ["dataConnectorCatalog"] as const;
export const dataConnectorSyncs = (connectorId?: string) =>
  resourceKey("dataConnectorSyncs", connectorId);
export const dataConnectors = (workspaceId?: string) =>
  resourceKey("dataConnectors", workspaceId);
export const dataExportPackages = () => ["dataExportPackages"] as const;
export const dataRightsCoverage = () => ["dataRightsCoverage"] as const;
export const delegatedOAuthConnections = (workspaceId?: string | null) =>
  resourceKey("delegatedOAuthConnections", workspaceId);
export const delegatedOAuthPosture = () => ["delegatedOAuthPosture"] as const;
export const delegatedOAuthProviders = () =>
  ["delegatedOAuthProviders"] as const;
export const deviceAuthorizations = () => ["deviceAuthorizations"] as const;
export const edgeSecurityPosture = () => ["edgeSecurityPosture"] as const;
export const evalDashboard = (agentId?: string) =>
  resourceKey("evalDashboard", agentId);
export const evalReasoningComparison = (suiteId?: string) =>
  resourceKey("evalReasoningComparison", suiteId);
export const evalRatings = (runId?: string) =>
  resourceKey("evalRatings", runId);
export const evalResults = (runId?: string) =>
  resourceKey("evalResults", runId);
export const evalRuns = (agentId?: string) => resourceKey("evalRuns", agentId);
export const evalSuites = (agentId?: string) =>
  resourceKey("evalSuites", agentId);
export const favorites = () => ["favorites"] as const;
export const files = (
  workspaceId?: string,
  scope?: CatalogPage | { purpose: "mention"; query: string },
) =>
  workspaceId === undefined
    ? (["files"] as const)
    : scope === undefined
      ? (["files", workspaceId] as const)
      : (["files", workspaceId, scope] as const);
export const folderItems = (folderId: string) =>
  ["folderItems", folderId] as const;
export const folderItemsBatch = (
  workspaceId: string,
  folderIds: readonly string[],
  limitPerFolder: number,
) => ["folderItemsBatch", workspaceId, { folderIds, limitPerFolder }] as const;
export const folders = (workspaceId?: string) =>
  resourceKey("folders", workspaceId);
export const groups = (groupId?: string, view?: "members") =>
  groupId === undefined
    ? (["groups"] as const)
    : view === undefined
      ? (["groups", groupId] as const)
      : (["groups", groupId, view] as const);
export const impersonationRequests = () => ["impersonationRequests"] as const;
export const impersonationSessions = () => ["impersonationSessions"] as const;
export const jobs = () => ["jobs"] as const;
export const jobsOperationalSummary = () => ["jobsOperationalSummary"] as const;
export const knowledgeBases = (workspaceId?: string) =>
  resourceKey("knowledgeBases", workspaceId);
export const knowledgeIngestReadiness = () =>
  ["knowledgeIngestReadiness"] as const;
export const knowledgeShares = (knowledgeBaseId?: string) =>
  resourceKey("knowledgeShares", knowledgeBaseId);
export const knowledgeSources = (knowledgeBaseId?: string) =>
  resourceKey("knowledgeSources", knowledgeBaseId);
export const localAuthStatus = () => ["localAuthStatus"] as const;
export const loginSession = () => ["login-session"] as const;
export const managedModelCustomizationPolicy = (agentId?: string) =>
  resourceKey("managedModelCustomizationPolicy", agentId);
export const managedModelPreferences = (agentId?: string) =>
  resourceKey("managedModelPreferences", agentId);
export const messageFeedback = (chatId?: string) =>
  resourceKey("messageFeedback", chatId);
export const optimisticMessages = (chatId: string) =>
  ["optimisticMessages", chatId] as const;
export const modelShares = (modelId?: string) =>
  resourceKey("modelShares", modelId);
export const notificationChannels = () => ["notificationChannels"] as const;
export const notificationDeliveries = () => ["notificationDeliveries"] as const;
export const notificationPolicy = () => ["notificationPolicy"] as const;
export const notifications = () => ["notifications"] as const;
export const personalContent = (
  kind: ContentKind,
  workspaceId?: string,
  page?: CatalogPage,
) =>
  workspaceId === undefined
    ? (["personalContent", kind] as const)
    : page === undefined
      ? (["personalContent", kind, workspaceId] as const)
      : (["personalContent", kind, workspaceId, page] as const);
export const postgresOperationalPosture = () =>
  ["postgresOperationalPosture"] as const;
export const postureGaEvidence = () => ["postureGaEvidence"] as const;
export const promptMarketplace = (workspaceId?: string) =>
  resourceKey("promptMarketplace", workspaceId);
export const promptTemplates = (
  workspaceId?: string,
  scope?: CatalogPage | { purpose: "command"; query: string },
) =>
  workspaceId === undefined
    ? (["promptTemplates"] as const)
    : scope === undefined
      ? (["promptTemplates", workspaceId] as const)
      : (["promptTemplates", workspaceId, scope] as const);
export const queuedTurns = (chatId?: string) =>
  resourceKey("queuedTurns", chatId);
export const quotas = () => ["quotas"] as const;
export const quotasDistributedStatus = () =>
  ["quotasDistributedStatus"] as const;
export const ragPolicy = () => ["ragPolicy"] as const;
export const ragPolicyChangeRequest = () => ["ragPolicyChangeRequest"] as const;
export const ragPosture = () => ["ragPosture"] as const;
export const trustPosture = () => ["trustPosture"] as const;
export const readiness = () => ["readiness"] as const;
export const retentionPolicy = () => ["retentionPolicy"] as const;
export const routerSession = (locale: Locale) =>
  ["routerSession", locale] as const;
export const routeWorkspaceSelection = (
  workspaceId: string | undefined,
  chatId: string | undefined,
) => ["routeWorkspaceSelection", { chatId, workspaceId }] as const;
export const serviceAccounts = () => ["serviceAccounts"] as const;
export const tablePages = (request?: {
  cursor?: string;
  filters: readonly { field: string; operator: string; value?: unknown }[];
  limit: number;
  parentId?: string;
  resource: string;
  search?: string;
  sort: readonly { direction: "asc" | "desc"; field: string }[];
  workspaceId?: string;
}) =>
  request === undefined
    ? (["tablePages"] as const)
    : (["tablePages", request] as const);
export const sessions = () => ["sessions"] as const;
export const shareTargets = (scope: ShareTargetScope) =>
  ["shareTargets", scope] as const;
export const streamingMessage = (chatId: string, messageId: string) =>
  ["streamingMessage", chatId, messageId] as const;
export const toolCalls = (agentId?: string) =>
  resourceKey("toolCalls", agentId);
export const toolConnectors = () => ["toolConnectors"] as const;
export const toolOperations = (connectorId?: string) =>
  resourceKey("toolOperations", connectorId);
export const usageAlerts = () => ["usageAlerts"] as const;
export const usageEvents = (range?: string) =>
  resourceKey("usageEvents", range);
export const usageSummary = () => ["usageSummary"] as const;
export const users = (filters?: {
  direction: "asc" | "desc";
  page: number;
  query: string;
  sort: string;
}) =>
  filters === undefined
    ? (["users"] as const)
    : ([
        "users",
        filters.query,
        filters.sort,
        filters.direction,
        filters.page,
      ] as const);
export const voices = () => ["voices"] as const;
export const webSearchConfiguration = () => ["webSearchConfiguration"] as const;
export const webhookDeliveries = (
  webhookId?: string,
  page?: { cursor: string | undefined; pageSize: number },
) =>
  webhookId === undefined
    ? (["webhookDeliveries"] as const)
    : page === undefined
      ? (["webhookDeliveries", webhookId] as const)
      : (["webhookDeliveries", webhookId, page] as const);
export const webhooks = (workspaceId?: string) =>
  resourceKey("webhooks", workspaceId);
export const workflowRuns = (workflowId?: string) =>
  resourceKey("workflowRuns", workflowId);
export const workflowTemplates = (workspaceId?: string) =>
  resourceKey("workflowTemplates", workspaceId);
export const workflows = (workspaceId?: string) =>
  resourceKey("workflows", workspaceId);
export const workspaceCapabilities = (workspaceId: string) =>
  ["workspaceCapabilities", workspaceId] as const;
export const workspaceMembers = (workspaceId?: string) =>
  resourceKey("workspaceMembers", workspaceId);
export const workspaces = () => ["workspaces"] as const;
