import type { RomeoEnv } from "@romeo/config";
import type { ObjectStore } from "@romeo/storage";
import type { VoiceProvider } from "@romeo/voices";

import type { RomeoRepository } from "../domain/repository";
import { AgentKnowledgeService } from "./agent-knowledge-service";
import { AgentService } from "./agent-service";
import { AnalyticsService } from "./analytics-service";
import { ApiKeyService } from "./api-key-service";
import { AuditService } from "./audit-service";
import type { AbuseControlService } from "./abuse-control-service";
import type { AuthProviderSettingsService } from "./auth-provider-settings-service";
import { BillingService } from "./billing-service";
import type { BrowserAutomationService } from "./browser-automation-service";
import { ChannelService } from "./channel-service";
import { ChatCommentService } from "./chat-comment-service";
import type { ChatService } from "./chat-service";
import { ChatTagService } from "./chat-tag-service";
import { CollaborationService } from "./collaboration-service";
import type { DataConnectorExecutor } from "./data-connector-executors";
import { DataConnectorService } from "./data-connector-service";
import type { DelegatedOAuthService } from "./delegated-oauth-service";
import type { DirectorySyncService } from "./directory-sync-service";
import { DeviceAuthorizationService } from "./device-authorization-service";
import { EdgeSecurityService } from "./edge-security-service";
import { EvalService } from "./eval-service";
import type { FileService } from "./file-service";
import { GaEvidencePostureService } from "./ga-evidence-posture-service";
import { GovernanceService } from "./governance-service";
import { GroupService } from "./group-service";
import { ImageGenerationService } from "./image-generation-service";
import { InterfacePreferenceService } from "./interface-preference-service";
import { JobService } from "./job-service";
import type { KnowledgeService } from "./knowledge-service";
import { LdapAuthService } from "./ldap-auth-service";
import { LocalAuthService } from "./local-auth-service";
import type { ManagedSecretService } from "./managed-secret-service";
import type { NotificationDeliverySender } from "./notification-delivery";
import { NotificationService } from "./notification-service";
import { OAuth2PkceService } from "./oauth2-pkce-service";
import { OidcPkceService } from "./oidc-pkce-service";
import type { OidcAuthenticator } from "./oidc-auth-service";
import { OpenAiChatCompletionsService } from "./openai-chat-completions-service";
import { OpenAiEmbeddingsService } from "./openai-embeddings-service";
import { OpenAiModelsService } from "./openai-models-service";
import type { OpenWebUiCompatibilityService } from "./openwebui-compatibility-service";
import { PostgresOperationalPostureService } from "./postgres-operational-posture-service";
import { PromptTemplateService } from "./prompt-template-service";
import { ProviderService } from "./provider-service";
import type { createQdrantKnowledgeVectorStore } from "./qdrant-knowledge-vector-store";
import type { QuotaCoordinator } from "./quota-coordination";
import { QuotaService } from "./quota-service";
import { RagPolicyService } from "./rag-policy-service";
import { RagPostureService } from "./rag-posture-service";
import { ReadinessService } from "./readiness-service";
import type { RunService } from "./run-service";
import { SamlAuthService } from "./saml-auth-service";
import { ScimService } from "./scim-service";
import type { SecretResolver } from "./secret-resolver";
import { SecretRotationService } from "./secret-rotation-service";
import { ServiceAccountService } from "./service-account-service";
import type { SessionService } from "./session-service";
import { SsoSettingsService } from "./sso-settings-service";
import { TenantAdminService } from "./tenant-admin-service";
import type { TemporaryChatCleanupWorker } from "./temporary-chat-cleanup-worker";
import { ToolConnectorService } from "./tool-connector-service";
import type { ToolService } from "./tool-service";
import { UsageService } from "./usage-service";
import type { UserLifecycleService } from "./user-lifecycle-service";
import type { VectorStoreDeploymentPosture } from "./vector-store-deployment";
import { VoiceService } from "./voice-service";
import type { WebhookService } from "./webhook-service";
import type { WebSearchService } from "./web-search-service";
import type { WorkflowService } from "./workflow-service";
import { WorkspaceContentService } from "./workspace-content-service";
import { WorkspaceService } from "./workspace-service";
import type { CreateServicesOptions, RomeoServices } from "./index";
import { parseCsvEnvironmentList } from "./data-connector-executor-factory";

interface ServiceRegistryInput {
  abuseControls: AbuseControlService;
  activeVectorStoreDeployment: VectorStoreDeploymentPosture;
  authProviderSettings: AuthProviderSettingsService;
  browserAutomation: BrowserAutomationService;
  chats: ChatService;
  dataConnectorExecutor: DataConnectorExecutor;
  delegatedOAuth: DelegatedOAuthService;
  directorySync: DirectorySyncService;
  env: RomeoEnv;
  files: FileService;
  knowledge: KnowledgeService;
  knowledgeVectorStore?: ReturnType<typeof createQdrantKnowledgeVectorStore>;
  managedSecrets: ManagedSecretService;
  notificationDelivery: NotificationDeliverySender;
  objectStore: ObjectStore;
  oidc: OidcAuthenticator;
  openWebUiCompatibility: OpenWebUiCompatibilityService;
  options: CreateServicesOptions;
  quotaCoordinator: QuotaCoordinator;
  repository: RomeoRepository;
  runs: RunService;
  secretResolver: SecretResolver;
  sessions: SessionService;
  temporaryChatCleanup: TemporaryChatCleanupWorker;
  toolConnectorOptions: ConstructorParameters<typeof ToolConnectorService>[2];
  tools: ToolService;
  users: UserLifecycleService;
  voiceProvider: VoiceProvider;
  webhooks: WebhookService;
  webSearch: WebSearchService;
  workflows: WorkflowService;
}

export function buildServiceRegistry(
  input: ServiceRegistryInput,
): RomeoServices {
  const {
    abuseControls,
    activeVectorStoreDeployment,
    authProviderSettings,
    browserAutomation,
    chats,
    dataConnectorExecutor,
    delegatedOAuth,
    directorySync,
    env,
    files,
    knowledge,
    knowledgeVectorStore,
    managedSecrets,
    notificationDelivery,
    objectStore,
    oidc,
    openWebUiCompatibility,
    options,
    quotaCoordinator,
    repository,
    runs,
    secretResolver,
    sessions,
    temporaryChatCleanup,
    toolConnectorOptions,
    tools,
    users,
    voiceProvider,
    webhooks,
    webSearch,
    workflows,
  } = input;

  return {
    abuseControls,
    analytics: new AnalyticsService(repository),
    agentKnowledge: new AgentKnowledgeService(repository),
    agents: new AgentService(repository, {
      encryptionKey: env.MANAGED_SECRET_ENCRYPTION_KEY,
      previousEncryptionKey: env.MANAGED_SECRET_ENCRYPTION_KEY_PREVIOUS,
    }),
    apiKeys: new ApiKeyService(repository),
    audit: new AuditService(repository),
    authProviderSettings,
    billing: new BillingService(repository, {
      genericWebhookSecret: env.BILLING_GENERIC_WEBHOOK_SECRET,
      genericWebhookToleranceSeconds:
        env.BILLING_GENERIC_WEBHOOK_TOLERANCE_SECONDS,
      stripeWebhookSecret: env.BILLING_STRIPE_WEBHOOK_SECRET,
      stripeWebhookToleranceSeconds:
        env.BILLING_STRIPE_WEBHOOK_TOLERANCE_SECONDS,
      webhookOrgId: env.BILLING_WEBHOOK_ORG_ID,
    }),
    browserAutomation,
    channels: new ChannelService(repository, openWebUiCompatibility),
    chats,
    temporaryChatCleanup,
    chatComments: new ChatCommentService(repository, notificationDelivery),
    chatTags: new ChatTagService(repository),
    collaboration: new CollaborationService(repository),
    dataConnectors: new DataConnectorService(
      repository,
      knowledge,
      dataConnectorExecutor,
      dataConnectorPosture(env),
    ),
    delegatedOAuth,
    deployment: { tenancyMode: env.TENANCY_MODE },
    directorySync,
    deviceAuthorizations: new DeviceAuthorizationService(repository),
    edgeSecurity: new EdgeSecurityService(env),
    evals: new EvalService(repository, {
      quotaCoordinator,
      secretResolver,
      webhooks,
      ...(options.providerFetch === undefined
        ? {}
        : { providerFetch: options.providerFetch }),
    }),
    files,
    gaEvidencePosture: new GaEvidencePostureService(env),
    governance: new GovernanceService(repository, objectStore, {
      env,
      scimEnabled: env.SCIM_ENABLED,
      deleteKnowledgeSource: (value) => knowledge.deleteSource(value),
    }),
    groups: new GroupService(repository),
    images: new ImageGenerationService(repository, files, {
      quotaCoordinator,
      secretResolver,
      webhooks,
      ...(options.providerFetch === undefined
        ? {}
        : { fetchImpl: options.providerFetch }),
    }),
    interfacePreferences: new InterfacePreferenceService(repository),
    jobs: new JobService(repository),
    knowledge,
    ldapAuth: new LdapAuthService(
      repository,
      sessions,
      authProviderSettings,
      secretResolver,
      env,
      options.ldapClientFactory === undefined
        ? {}
        : { clientFactory: options.ldapClientFactory },
    ),
    localAuth: new LocalAuthService(repository, sessions, env),
    managedSecrets,
    notifications: new NotificationService(repository, notificationDelivery),
    oidc,
    oidcPkce: new OidcPkceService(
      repository,
      sessions,
      env,
      authProviderSettings,
      options.oidcFetch === undefined ? {} : { fetchImpl: options.oidcFetch },
    ),
    oauth2Pkce: new OAuth2PkceService(
      repository,
      sessions,
      env,
      authProviderSettings,
      secretResolver,
      options.delegatedOAuthFetch === undefined
        ? {}
        : { fetchImpl: options.delegatedOAuthFetch },
    ),
    samlAuth: new SamlAuthService(
      repository,
      sessions,
      authProviderSettings,
      secretResolver,
      env,
      options.samlClientFactory === undefined
        ? {}
        : { clientFactory: options.samlClientFactory },
    ),
    scim: new ScimService(repository, { enabled: env.SCIM_ENABLED }),
    openAiChatCompletions: new OpenAiChatCompletionsService(repository, {
      quotaCoordinator,
      secretResolver,
      webhooks,
      ...(options.providerFetch === undefined
        ? {}
        : { fetchImpl: options.providerFetch }),
    }),
    openAiEmbeddings: new OpenAiEmbeddingsService(repository, {
      quotaCoordinator,
      secretResolver,
      webhooks,
      ...(options.embeddingFetch === undefined
        ? {}
        : { fetchImpl: options.embeddingFetch }),
    }),
    openAiModels: new OpenAiModelsService(repository),
    openWebUiCompatibility,
    postgresOperationalPosture: new PostgresOperationalPostureService(env),
    providers: new ProviderService(repository, {
      secretResolver,
      ...(options.providerFetch === undefined
        ? {}
        : { fetchImpl: options.providerFetch }),
    }),
    prompts: new PromptTemplateService(repository),
    quotas: new QuotaService(repository, quotaCoordinator),
    ragPolicy: new RagPolicyService(repository),
    ragPosture: new RagPostureService(
      repository,
      activeVectorStoreDeployment,
      env.PGVECTOR_PHYSICAL_ISOLATION_EVIDENCE_PATH,
      env.QDRANT_LIVE_EVIDENCE_PATH,
    ),
    readiness: new ReadinessService(
      repository,
      env,
      activeVectorStoreDeployment,
      knowledgeVectorStore,
    ),
    runs,
    serviceAccounts: new ServiceAccountService(repository),
    secretRotation: new SecretRotationService(repository, env, managedSecrets),
    sessions,
    ssoSettings: new SsoSettingsService(
      repository,
      env,
      options.oidcFetch,
      users,
    ),
    tenantAdmin: new TenantAdminService(repository, abuseControls, objectStore),
    toolConnectors: new ToolConnectorService(
      repository,
      secretResolver,
      toolConnectorOptions,
    ),
    tools,
    usage: new UsageService(repository),
    users,
    voices: new VoiceService(repository, voiceProvider, objectStore),
    webhooks,
    webSearch,
    workflows,
    workspace: new WorkspaceService(repository),
    workspaceContent: new WorkspaceContentService(
      repository,
      files,
      objectStore,
    ),
  };
}

function dataConnectorPosture(env: RomeoEnv) {
  return {
    executionDriver: env.DATA_CONNECTOR_EXECUTION_DRIVER,
    egressPolicy: env.DATA_CONNECTOR_EGRESS_POLICY,
    allowedHostRuleCount: parseCsvEnvironmentList(
      env.DATA_CONNECTOR_FETCH_ALLOWED_HOSTS,
    ).length,
    fetchMaxBytes: env.DATA_CONNECTOR_FETCH_MAX_BYTES,
    fetchRetryAttempts: env.DATA_CONNECTOR_FETCH_RETRY_ATTEMPTS,
    fetchRetryBackoffMs: env.DATA_CONNECTOR_FETCH_RETRY_BACKOFF_MS,
    fetchTimeoutMs: env.DATA_CONNECTOR_FETCH_TIMEOUT_MS,
    liveEvidencePath: env.DATA_CONNECTOR_LIVE_EVIDENCE_PATH,
    workerEnabled: env.DATA_CONNECTOR_WORKER_ENABLED,
    networkPolicyConfigured: env.DATA_CONNECTOR_NETWORK_POLICY_ENABLED,
    secretResolverDriver: env.SECRET_RESOLVER_DRIVER,
    managedSecretConfigured:
      env.MANAGED_SECRET_ENCRYPTION_KEY.trim().length >= 32,
    githubDeploymentTokenConfigured:
      env.DATA_CONNECTOR_GITHUB_TOKEN.trim().length > 0,
    delegatedOAuthGithubConfigured:
      env.DELEGATED_OAUTH_GITHUB_CLIENT_ID.trim().length > 0 &&
      env.DELEGATED_OAUTH_GITHUB_CLIENT_SECRET.trim().length > 0 &&
      env.DELEGATED_OAUTH_TOKEN_ENCRYPTION_KEY.trim().length >= 32,
    s3EndpointConfigured: env.S3_ENDPOINT.trim().length > 0,
    s3DeploymentCredentialsConfigured:
      env.S3_ACCESS_KEY_ID.trim().length > 0 &&
      env.S3_SECRET_ACCESS_KEY.trim().length > 0,
  };
}
