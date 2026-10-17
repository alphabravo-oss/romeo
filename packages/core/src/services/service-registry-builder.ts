import type { RomeoEnv } from "@romeo/config";
import type { ProviderCircuitBreaker } from "@romeo/ai-runtime";
import type { ObjectStore } from "@romeo/storage";
import type { VoiceProvider } from "@romeo/voices";

import type { RomeoRepository } from "../domain/repository";
import { AgentKnowledgeService } from "./agent-knowledge-service";
import { AgentService } from "./agent-service";
import { AnalyticsService } from "./analytics-service";
import { ApiKeyService } from "./api-key-service";
import { AuditService } from "./audit-service";
import {
  AuditIntegrityService,
  VersionedHmacAuditCheckpointSigner,
} from "./audit-integrity";
import type { AbuseControlService } from "./abuse-control-service";
import type { AuthProviderSettingsService } from "./auth-provider-settings-service";
import { BillingService } from "./billing-service";
import type { BrowserAutomationService } from "./browser-automation-service";
import { ChannelService } from "./channel-service";
import type { ChatEventService } from "./chat-event-service";
import { ChatExperienceService } from "./chat-experience-service";
import { ChatCommentService } from "./chat-comment-service";
import type { ChatService } from "./chat-service";
import { ChatTagService } from "./chat-tag-service";
import { CollaborationService } from "./collaboration-service";
import { ContentPolicyService } from "./content-policy-service";
import { ContentPolicyVersionService } from "./content-policy-version-service";
import { PolicyApprovalService } from "./policy-approval-service";
import type { CapabilityService } from "./capability-resolver";
import type { CapabilityPlatformPolicy } from "./capability-platform-policy";
import type { OrganizationCapabilityFlagService } from "./organization-capability-flag-service";
import type { DataConnectorExecutor } from "./data-connector-executors";
import { DataConnectorService } from "./data-connector-service";
import type { DelegatedOAuthService } from "./delegated-oauth-service";
import type { DirectorySyncService } from "./directory-sync-service";
import { DeviceAuthorizationService } from "./device-authorization-service";
import { EdgeSecurityService } from "./edge-security-service";
import { EvalService } from "./eval-service";
import type { FileService } from "./file-service";
import { GovernanceService } from "./governance-service";
import { GovernanceExportWorker } from "./governance-export-worker";
import { GroupService } from "./group-service";
import { ImageGenerationService } from "./image-generation-service";
import { ImageJobStore } from "./image-job-store";
import { ModelCapabilityProbeService } from "./model-capability-probe";
import { InterfacePreferenceService } from "./interface-preference-service";
import type { InternalReadinessService } from "./internal-readiness-service";
import { IdempotencyService } from "./idempotency-service";
import { JobService } from "./job-service";
import {
  InventoriedTablePageService,
  inventoriedTablePageCursorSecrets,
} from "./inventoried-table-page-service";
import { ServerTableExportWorker } from "./server-table-export-worker";
import { ServerTableViewService } from "./server-table-view-service";
import type { KnowledgeService } from "./knowledge-service";
import { LdapAuthService } from "./ldap-auth-service";
import { LocalAuthService } from "./local-auth-service";
import type { ManagedSecretService } from "./managed-secret-service";
import type { NotificationDeliverySender } from "./notification-delivery";
import { NotificationService } from "./notification-service";
import { OAuth2PkceService } from "./oauth2-pkce-service";
import { OidcPkceService } from "./oidc-pkce-service";
import type { OidcRuntimeCache } from "./oidc-client";
import type { OidcAuthenticator } from "./oidc-auth-service";
import { OpenAiChatCompletionsService } from "./openai-chat-completions-service";
import { OpenAiEmbeddingsService } from "./openai-embeddings-service";
import { OpenAiModelsService } from "./openai-models-service";
import { derivePageCursorSecret } from "./page-cursor";
import type { ChannelStore } from "./channel-store";
import { PostgresOperationalPostureService } from "./postgres-operational-posture-service";
import { PromptTemplateService } from "./prompt-template-service";
import { ProviderService } from "./provider-service";
import { ProviderCapabilityReportService } from "./provider-capability-report-service";
import type { createQdrantKnowledgeVectorStore } from "./qdrant-knowledge-vector-store";
import type { QuotaCoordinator } from "./quota-coordination";
import { QuotaService } from "./quota-service";
import { RagPolicyService } from "./rag-policy-service";
import { RagPostureService } from "./rag-posture-service";
import { ReadinessService } from "./readiness-service";
import type { RunService } from "./run-service";
import { RuntimeKeyRotationPostureService } from "./runtime-key-rotation-posture-service";
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

import { WorkspaceContentService } from "./workspace-content-service";
import { WorkspaceService } from "./workspace-service";
import type { CreateServicesOptions, RomeoServices } from "./index";
import { dataConnectorRuntimePosture } from "./service-registry-data-connector-posture";

interface ServiceRegistryInput {
  abuseControls: AbuseControlService;
  activeVectorStoreDeployment: VectorStoreDeploymentPosture;
  authProviderSettings: AuthProviderSettingsService;
  browserAutomation: BrowserAutomationService;
  capabilities: CapabilityService;
  capabilityFlags: OrganizationCapabilityFlagService;
  capabilityPlatformPolicy: CapabilityPlatformPolicy;
  chatEvents: ChatEventService;
  chats: ChatService;
  dataConnectorExecutor: DataConnectorExecutor;
  delegatedOAuth: DelegatedOAuthService;
  directorySync: DirectorySyncService;
  env: RomeoEnv;
  files: FileService;
  internalReadiness: InternalReadinessService;
  knowledge: KnowledgeService;
  knowledgeVectorStore?: ReturnType<typeof createQdrantKnowledgeVectorStore>;
  managedSecrets: ManagedSecretService;
  notificationDelivery: NotificationDeliverySender;
  oidcRuntimeCache: OidcRuntimeCache;
  objectStore: ObjectStore;
  oidc: OidcAuthenticator;
  channelStore: ChannelStore;
  options: CreateServicesOptions;
  providerCircuitBreaker: ProviderCircuitBreaker;
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
}

export function buildServiceRegistry(
  input: ServiceRegistryInput,
): RomeoServices {
  const {
    abuseControls,
    activeVectorStoreDeployment,
    authProviderSettings,
    browserAutomation,
    capabilities,
    capabilityFlags,
    capabilityPlatformPolicy,
    chatEvents,
    chats,
    dataConnectorExecutor,
    delegatedOAuth,
    directorySync,
    env,
    files,
    internalReadiness,
    knowledge,
    knowledgeVectorStore,
    managedSecrets,
    notificationDelivery,
    oidcRuntimeCache,
    objectStore,
    oidc,
    channelStore,
    options,
    providerCircuitBreaker,
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
  } = input;

  const auditCursorSecrets: [string, ...string[]] = [
    derivePageCursorSecret(env.SESSION_SECRET, "audit-table"),
  ];
  if (env.SESSION_SECRET_PREVIOUS.length > 0)
    auditCursorSecrets.push(
      derivePageCursorSecret(env.SESSION_SECRET_PREVIOUS, "audit-table"),
    );

  const tablePages = new InventoriedTablePageService(repository, {
    cursorSecrets: inventoriedTablePageCursorSecrets({
      current: env.SESSION_SECRET,
      ...(env.SESSION_SECRET_PREVIOUS.length > 0
        ? { previous: env.SESSION_SECRET_PREVIOUS }
        : {}),
    }),
  });

  return {
    abuseControls,
    analytics: new AnalyticsService(repository),
    agentKnowledge: new AgentKnowledgeService(repository),
    agents: new AgentService(repository, {
      encryptionKey: env.MANAGED_SECRET_ENCRYPTION_KEY,
      previousEncryptionKey: env.MANAGED_SECRET_ENCRYPTION_KEY_PREVIOUS,
    }),
    apiKeys: new ApiKeyService(repository),
    audit: new AuditService(repository, {
      cursorSecrets: auditCursorSecrets,
    }),
    auditIntegrity: new AuditIntegrityService(
      repository,
      options.auditCheckpointSigner ??
        VersionedHmacAuditCheckpointSigner.fromSecrets({
          current: env.SESSION_SECRET,
          ...(env.SESSION_SECRET_PREVIOUS.length === 0
            ? {}
            : { previous: env.SESSION_SECRET_PREVIOUS }),
        }),
      options.auditExportClient,
    ),
    authProviderSettings,
    billing: new BillingService(repository, {
      enabled: env.BILLING_ENABLED,
      tenancyMode: env.TENANCY_MODE,
      genericWebhookSecret: env.BILLING_GENERIC_WEBHOOK_SECRET,
      genericWebhookToleranceSeconds:
        env.BILLING_GENERIC_WEBHOOK_TOLERANCE_SECONDS,
      stripeWebhookSecret: env.BILLING_STRIPE_WEBHOOK_SECRET,
      stripeWebhookToleranceSeconds:
        env.BILLING_STRIPE_WEBHOOK_TOLERANCE_SECONDS,
      webhookOrgId: env.BILLING_WEBHOOK_ORG_ID,
    }),
    browserAutomation,
    chatEvents,
    chatExperience: new ChatExperienceService(repository),
    channels: new ChannelService(repository, channelStore),
    capabilities,
    capabilityFlags,
    chats,
    temporaryChatCleanup,
    chatComments: new ChatCommentService(
      repository,
      notificationDelivery,
      secretResolver,
    ),
    chatTags: new ChatTagService(repository),
    collaboration: new CollaborationService(repository),
    contentPolicy: new ContentPolicyService(repository),
    contentPolicyVersions: new ContentPolicyVersionService(repository),
    contentPolicyApprovals: new PolicyApprovalService(repository, {
      resolve: (resolution) => runs.resolveContentPolicyApproval(resolution),
      expireDue: (subject) => runs.expireContentPolicyApprovals(subject),
    }),
    dataConnectors: new DataConnectorService(
      repository,
      knowledge,
      dataConnectorExecutor,
      dataConnectorRuntimePosture(env),
    ),
    delegatedOAuth,
    deployment: {
      tenancyMode: env.TENANCY_MODE,
      billingEnabled: env.BILLING_ENABLED,
      malwareScanEnabled: env.FILE_MALWARE_SCAN_ENABLED,
      qdrantConfigured:
        activeVectorStoreDeployment.externalVectorStore.configured,
    },
    directorySync,
    deviceAuthorizations: new DeviceAuthorizationService(repository),
    edgeSecurity: new EdgeSecurityService(env),
    evals: new EvalService(repository, {
      capabilityPlatformPolicy,
      quotaCoordinator,
      secretResolver,
      webhooks,
      ...(options.providerFetch === undefined
        ? {}
        : { providerFetch: options.providerFetch }),
    }),
    files,
    governance: new GovernanceService(repository, objectStore, {
      capabilities,
      scimEnabled: env.SCIM_ENABLED,
      deleteKnowledgeSource: (value) => knowledge.deleteSource(value),
    }),
    governanceExports: new GovernanceExportWorker(
      repository,
      tablePages,
      objectStore,
    ),
    groups: new GroupService(repository),
    imageJobs: new ImageJobStore(repository),
    modelCapabilityProbes: new ModelCapabilityProbeService(repository),
    images: new ImageGenerationService(repository, files, {
      capabilities,
      quotaCoordinator,
      secretResolver,
      webhooks,
      ...(options.providerFetch === undefined
        ? {}
        : { fetchImpl: options.providerFetch }),
    }),
    interfacePreferences: new InterfacePreferenceService(repository),
    internalReadiness,
    idempotency: new IdempotencyService(repository),
    jobs: new JobService(repository),
    tableExports: new ServerTableExportWorker(
      repository,
      tablePages,
      objectStore,
    ),
    tablePages,
    tableViews: new ServerTableViewService(repository),
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
    notifications: new NotificationService(
      repository,
      notificationDelivery,
      secretResolver,
    ),
    oidc,
    oidcPkce: new OidcPkceService(
      repository,
      sessions,
      env,
      authProviderSettings,
      {
        ...(options.oidcFetch === undefined
          ? {}
          : { fetchImpl: options.oidcFetch }),
        runtimeCache: oidcRuntimeCache,
      },
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
      capabilities,
      circuitBreaker: providerCircuitBreaker,
      providerDisabledIds: env.MODEL_PROVIDER_DISABLED_IDS,
      providerFallbackModelId: env.MODEL_PROVIDER_FALLBACK_MODEL_ID,
      providerRetryAttempts: env.MODEL_PROVIDER_RETRY_ATTEMPTS,
      providerRetryBackoffMs: env.MODEL_PROVIDER_RETRY_BACKOFF_MS,
      providerTimeoutMs: env.MODEL_PROVIDER_STREAM_TIMEOUT_MS,
      quotaCoordinator,
      secretResolver,
      webhooks,
      ...(options.providerFetch === undefined
        ? {}
        : { fetchImpl: options.providerFetch }),
    }),
    openAiEmbeddings: new OpenAiEmbeddingsService(repository, {
      circuitBreaker: providerCircuitBreaker,
      providerDisabledIds: env.MODEL_PROVIDER_DISABLED_IDS,
      providerFallbackModelId: env.MODEL_PROVIDER_FALLBACK_MODEL_ID,
      providerRetryAttempts: env.MODEL_PROVIDER_RETRY_ATTEMPTS,
      providerRetryBackoffMs: env.MODEL_PROVIDER_RETRY_BACKOFF_MS,
      providerTimeoutMs: env.MODEL_PROVIDER_STREAM_TIMEOUT_MS,
      quotaCoordinator,
      secretResolver,
      webhooks,
      ...(options.embeddingFetch === undefined
        ? {}
        : { fetchImpl: options.embeddingFetch }),
    }),
    openAiModels: new OpenAiModelsService(repository),
    postgresOperationalPosture: new PostgresOperationalPostureService(env),
    providers: new ProviderService(repository, {
      secretResolver,
      catalogSync: {
        enabled:
          env.MODEL_CATALOG_SYNC_ENABLED && process.env.NODE_ENV !== "test",
        intervalMs: env.MODEL_CATALOG_SYNC_INTERVAL_MS,
        timeoutMs: env.MODEL_CATALOG_SYNC_TIMEOUT_MS,
        ttlMs: env.MODEL_CATALOG_SYNC_TTL_MS,
      },
      ...(options.providerFetch === undefined
        ? {}
        : { fetchImpl: options.providerFetch }),
    }),
    providerCapabilityReports: new ProviderCapabilityReportService(repository),
    prompts: new PromptTemplateService(repository),
    quotas: new QuotaService(repository, quotaCoordinator),
    ragPolicy: new RagPolicyService(repository),
    ragPosture: new RagPostureService(repository, activeVectorStoreDeployment),
    readiness: new ReadinessService(
      repository,
      env,
      activeVectorStoreDeployment,
      knowledgeVectorStore,
      objectStore,
    ),
    runs,
    runtimeKeyRotationPosture: new RuntimeKeyRotationPostureService(
      repository,
      env,
    ),
    serviceAccounts: new ServiceAccountService(repository),
    secretRotation: new SecretRotationService(repository, env, managedSecrets),
    sessions,
    ssoSettings: new SsoSettingsService(
      repository,
      env,
      options.oidcFetch,
      users,
    ),
    tenantAdmin: new TenantAdminService(
      repository,
      abuseControls,
      objectStore,
      knowledgeVectorStore,
    ),
    toolConnectors: new ToolConnectorService(
      repository,
      secretResolver,
      toolConnectorOptions,
    ),
    tools,
    usage: new UsageService(repository),
    users,
    voices: new VoiceService(
      repository,
      voiceProvider,
      objectStore,
      capabilities,
    ),
    webhooks,
    webSearch,
    workspace: new WorkspaceService(repository),
    workspaceContent: new WorkspaceContentService(
      repository,
      files,
      objectStore,
    ),
  };
}
