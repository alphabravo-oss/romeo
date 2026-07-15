import type { ResourceGrant } from "@romeo/auth";
import { defaultProviderCapabilities } from "@romeo/providers";
import type { BaseModel, ProviderInstance } from "@romeo/providers";

import type { DelegatedOAuthConnection } from "../domain/delegated-oauth";
import type {
  Agent,
  AgentKnowledgeBinding,
  AgentToolBinding,
  AgentVersion,
  ApiKey,
  AuditLog,
  BackgroundJob,
  BillingPlan,
  Chat,
  ChatComment,
  ChatTag,
  ChatTagAssignment,
  DataConnector,
  DataConnectorSync,
  DeviceAuthorization,
  EvalCase,
  EvalResultHumanRating,
  EvalRun,
  EvalRunResult,
  EvalSuite,
  FileObject,
  Group,
  GroupMembership,
  KnowledgeBase,
  KnowledgeChunk,
  KnowledgeChunkEmbedding,
  KnowledgeSource,
  LocalMfaFactor,
  LocalPasswordCredential,
  Message,
  MessagePart,
  NotificationDelivery,
  NotificationDeliveryChannel,
  CollaborationChannel,
  CollaborationChannelMember,
  Organization,
  PromptTemplate,
  QuotaBucket,
  ResourceFavorite,
  RetentionPolicy,
  RunRecord,
  ServiceAccount,
  SsoOidcSettings,
  SystemSetting,
  ToolCallRecord,
  ToolConnector,
  ToolOperation,
  UsageEvent,
  User,
  UserNotification,
  UserSession,
  VoiceProfile,
  WebhookDelivery,
  WebhookSubscription,
  WorkspaceFolder,
  WorkspaceFolderItem,
  WorkflowDefinition,
  WorkflowRun,
  Workspace,
} from "../domain/entities";

export interface SeedData {
  organizations: Organization[];
  workspaces: Workspace[];
  users: User[];
  groups: Group[];
  groupMemberships: GroupMembership[];
  ssoOidcSettings: SsoOidcSettings[];
  systemSettings: SystemSetting[];
  apiKeys: ApiKey[];
  deviceAuthorizations: DeviceAuthorization[];
  userSessions: UserSession[];
  localPasswordCredentials: LocalPasswordCredential[];
  localMfaFactors: LocalMfaFactor[];
  serviceAccounts: ServiceAccount[];
  providers: ProviderInstance[];
  models: BaseModel[];
  agents: Agent[];
  agentKnowledgeBindings: AgentKnowledgeBinding[];
  agentToolBindings: AgentToolBinding[];
  agentVersions: AgentVersion[];
  evalSuites: EvalSuite[];
  evalCases: EvalCase[];
  evalRuns: EvalRun[];
  evalRunResults: EvalRunResult[];
  evalResultHumanRatings: EvalResultHumanRating[];
  chats: Chat[];
  messages: Message[];
  messageParts: MessagePart[];
  fileObjects: FileObject[];
  chatComments: ChatComment[];
  chatTags: ChatTag[];
  chatTagAssignments: ChatTagAssignment[];
  collaborationChannels: CollaborationChannel[];
  collaborationChannelMembers: CollaborationChannelMember[];
  userNotifications: UserNotification[];
  notificationDeliveryChannels: NotificationDeliveryChannel[];
  notificationDeliveries: NotificationDelivery[];
  knowledgeBases: KnowledgeBase[];
  knowledgeSources: KnowledgeSource[];
  knowledgeChunks: KnowledgeChunk[];
  knowledgeChunkEmbeddings: KnowledgeChunkEmbedding[];
  dataConnectors: DataConnector[];
  dataConnectorSyncs: DataConnectorSync[];
  delegatedOAuthConnections: DelegatedOAuthConnection[];
  voiceProfiles: VoiceProfile[];
  auditLogs: AuditLog[];
  usageEvents: UsageEvent[];
  billingPlans: BillingPlan[];
  backgroundJobs: BackgroundJob[];
  webhookSubscriptions: WebhookSubscription[];
  webhookDeliveries: WebhookDelivery[];
  workflowDefinitions: WorkflowDefinition[];
  workflowRuns: WorkflowRun[];
  retentionPolicies: RetentionPolicy[];
  quotaBuckets: QuotaBucket[];
  runs: RunRecord[];
  toolCalls: ToolCallRecord[];
  toolConnectors: ToolConnector[];
  toolOperations: ToolOperation[];
  grants: ResourceGrant[];
  promptTemplates: PromptTemplate[];
  resourceFavorites: ResourceFavorite[];
  workspaceFolders: WorkspaceFolder[];
  workspaceFolderItems: WorkspaceFolderItem[];
}

export function createSeedData(now = new Date().toISOString()): SeedData {
  const providers: ProviderInstance[] = [
    {
      id: "provider_openai_compatible",
      orgId: "org_default",
      type: "openai-compatible",
      name: "OpenAI-compatible",
      baseUrl: "https://api.openai.com/v1",
      enabled: true,
      capabilities: defaultProviderCapabilities("openai-compatible"),
    },
    {
      id: "provider_ollama",
      orgId: "org_default",
      type: "ollama",
      name: "Local Ollama",
      baseUrl: "http://localhost:11434",
      enabled: true,
      capabilities: defaultProviderCapabilities("ollama"),
    },
  ];

  const models: BaseModel[] = [
    {
      id: "model_openai_compatible_default",
      providerId: "provider_openai_compatible",
      name: "gpt-compatible",
      displayName: "OpenAI-compatible default",
      enabled: true,
      capabilities: providers[0]!.capabilities,
      contextWindow: 128000,
    },
    {
      id: "model_ollama_default",
      providerId: "provider_ollama",
      name: "llama3.2",
      displayName: "Ollama llama3.2",
      enabled: true,
      capabilities: providers[1]!.capabilities,
      contextWindow: 8192,
    },
  ];

  const defaultAgentVersion: AgentVersion = {
    id: "agent_version_default_v1",
    agentId: "agent_default",
    orgId: "org_default",
    workspaceId: "workspace_default",
    version: 1,
    status: "published",
    baseModelId: "model_openai_compatible_default",
    systemPrompt: "You are Romeo, a secure AI workspace assistant.",
    parameters: { temperature: 0.2 },
    memoryPolicy: { mode: "disabled" },
    safetySettings: {},
    voiceProfileId: "voice_default",
    knowledgeBaseBindings: [{ knowledgeBaseId: "kb_default", enabled: true }],
    // Must match agentToolBindings below: rolling back to this version
    // re-applies these bindings to the agent, which would otherwise silently
    // re-enable the tools this seed deliberately ships disabled.
    toolBindings: [
      { toolId: "tool_calculator", enabled: false, approvalRequired: false },
      { toolId: "tool_datetime", enabled: false, approvalRequired: true },
    ],
    createdBy: "user_dev_admin",
    createdAt: now,
    publishedAt: now,
  };

  return {
    organizations: [
      { id: "org_default", name: "Romeo Local", slug: "romeo-local" },
    ],
    workspaces: [
      {
        id: "workspace_default",
        orgId: "org_default",
        name: "Default",
        slug: "default",
      },
    ],
    users: [
      {
        id: "user_dev_admin",
        orgId: "org_default",
        email: "admin@romeo.local",
        name: "Romeo Admin",
        role: "global_admin",
      },
    ],
    groups: [
      {
        id: "group_admins",
        orgId: "org_default",
        name: "Admins",
        slug: "admins",
        createdAt: now,
      },
    ],
    groupMemberships: [
      {
        groupId: "group_admins",
        userId: "user_dev_admin",
        orgId: "org_default",
        createdAt: now,
      },
    ],
    ssoOidcSettings: [],
    systemSettings: [],
    apiKeys: [],
    deviceAuthorizations: [],
    userSessions: [],
    localPasswordCredentials: [],
    localMfaFactors: [],
    serviceAccounts: [],
    providers,
    models,
    agents: [
      {
        id: "agent_default",
        orgId: "org_default",
        workspaceId: "workspace_default",
        name: "Romeo Assistant",
        createdBy: "user_dev_admin",
        baseModelId: "model_openai_compatible_default",
        systemPrompt: defaultAgentVersion.systemPrompt,
        parameters: defaultAgentVersion.parameters,
        memoryPolicy: defaultAgentVersion.memoryPolicy,
        safetySettings: defaultAgentVersion.safetySettings,
        voiceProfileId: "voice_default",
        publishedVersionId: defaultAgentVersion.id,
        updatedAt: now,
      },
    ],
    agentKnowledgeBindings: [
      createKnowledgeBinding(
        "agent_knowledge_binding_default",
        "kb_default",
        now,
      ),
    ],
    // Bindings ship attached but DISABLED, so Agent Studio still demonstrates
    // tools wired to an agent while the default agent advertises no tools to
    // the model. Enabled by default they break the README's Ollama quick start
    // on both common local models: llama3.2 fires tool_calculator on a bare
    // "hi" with an empty expression and then confabulates a question around the
    // result ("You asked for 1 + 2 * 3, which is 7"), which reads to users like
    // context leaking from another chat; gemma3:4b cannot use tools at all and
    // hard-errors "does not support tools". Turn a tool on per agent to use it.
    agentToolBindings: [
      createToolBinding(
        "agent_tool_binding_calculator",
        "tool_calculator",
        false,
        false,
        now,
      ),
      createToolBinding(
        "agent_tool_binding_datetime",
        "tool_datetime",
        false,
        true,
        now,
      ),
    ],
    agentVersions: [defaultAgentVersion],
    evalSuites: [],
    evalCases: [],
    evalRuns: [],
    evalRunResults: [],
    evalResultHumanRatings: [],
    chats: [
      {
        id: "chat_welcome",
        orgId: "org_default",
        workspaceId: "workspace_default",
        title: "Welcome",
        createdBy: "user_dev_admin",
        updatedAt: now,
      },
    ],
    messages: [],
    messageParts: [],
    fileObjects: [],
    chatComments: [],
    chatTags: [],
    chatTagAssignments: [],
    collaborationChannels: [],
    collaborationChannelMembers: [],
    userNotifications: [],
    notificationDeliveryChannels: [],
    notificationDeliveries: [],
    knowledgeBases: [
      {
        id: "kb_default",
        orgId: "org_default",
        workspaceId: "workspace_default",
        name: "Romeo Handbook",
        description:
          "Seed knowledge base for validating the RAG control plane.",
        createdBy: "user_dev_admin",
        createdAt: now,
        updatedAt: now,
      },
    ],
    knowledgeSources: [],
    knowledgeChunks: [],
    knowledgeChunkEmbeddings: [],
    dataConnectors: [],
    dataConnectorSyncs: [],
    delegatedOAuthConnections: [],
    voiceProfiles: [
      {
        id: "voice_default",
        orgId: "org_default",
        providerId: "voice_disabled",
        providerVoiceId: "disabled-default",
        name: "Romeo Neutral",
        language: "en",
        styleTags: ["neutral"],
        cloningAllowed: false,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
    auditLogs: [],
    usageEvents: [],
    billingPlans: [],
    backgroundJobs: [],
    webhookSubscriptions: [],
    webhookDeliveries: [],
    workflowDefinitions: [],
    workflowRuns: [],
    retentionPolicies: [
      {
        orgId: "org_default",
        auditLogRetentionDays: 365,
        updatedBy: "user_dev_admin",
        updatedAt: now,
      },
    ],
    quotaBuckets: [],
    runs: [],
    toolCalls: [],
    toolConnectors: [],
    toolOperations: [],
    grants: createSeedGrants(),
    promptTemplates: [],
    resourceFavorites: [],
    workspaceFolders: [],
    workspaceFolderItems: [],
  };
}

function createSeedGrants(): ResourceGrant[] {
  const resources: Array<
    [ResourceGrant["resourceType"], string, ResourceGrant["permission"]]
  > = [
    ["chat", "chat_welcome", "write"],
    ["agent", "agent_default", "run"],
    ["tool", "tool_calculator", "use"],
    ["tool", "tool_datetime", "use"],
    ["model", "model_openai_compatible_default", "use"],
    ["model", "model_ollama_default", "use"],
    ["provider", "provider_openai_compatible", "use"],
    ["provider", "provider_ollama", "use"],
    ["knowledge_base", "kb_default", "read"],
    ["knowledge_base", "kb_default", "use"],
    ["knowledge_base", "kb_default", "write"],
    ["voice_profile", "voice_default", "use"],
  ];

  return resources.map(([resourceType, resourceId, permission], index) => ({
    id: `grant_seed_${index + 1}`,
    resourceType,
    resourceId,
    principalType: "group",
    principalId: "group_admins",
    permission,
  }));
}

function createToolBinding(
  id: string,
  toolId: string,
  enabled: boolean,
  approvalRequired: boolean,
  now: string,
): AgentToolBinding {
  return {
    id,
    orgId: "org_default",
    agentId: "agent_default",
    toolId,
    enabled,
    approvalRequired,
    createdAt: now,
    updatedAt: now,
  };
}

function createKnowledgeBinding(
  id: string,
  knowledgeBaseId: string,
  now: string,
): AgentKnowledgeBinding {
  return {
    id,
    orgId: "org_default",
    agentId: "agent_default",
    knowledgeBaseId,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}
