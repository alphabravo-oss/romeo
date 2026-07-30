import { readEnv, type RomeoEnv } from "@romeo/config";
import { lookup } from "node:dns/promises";
import { disabledObjectStore, type ObjectStore } from "@romeo/storage";
import type { VoiceProvider } from "@romeo/voices";

import type { RomeoRepository } from "../domain/repository";
import { AbuseControlService } from "./abuse-control-service";
import { AnalyticsService } from "./analytics-service";
import { AuditService } from "./audit-service";
import { AuthProviderSettingsService } from "./auth-provider-settings-service";
import { AgentKnowledgeService } from "./agent-knowledge-service";
import { AgentService } from "./agent-service";
import { ApiKeyService } from "./api-key-service";
import { BillingService } from "./billing-service";
import { BrowserAutomationService } from "./browser-automation-service";
import { ChannelService } from "./channel-service";
import { ChatService } from "./chat-service";
import { ChatEventService } from "./chat-event-service";
import type { ChatEventTransport } from "./chat-event-transport";
import { ChatExperienceService } from "./chat-experience-service";
import { ChatCommentService } from "./chat-comment-service";
import { ChatTagService } from "./chat-tag-service";
import { CollaborationService } from "./collaboration-service";
import { DataConnectorService } from "./data-connector-service";
import { createDataConnectorExecutor } from "./data-connector-executor-factory";
import { DelegatedOAuthService } from "./delegated-oauth-service";
import { DirectorySyncService } from "./directory-sync-service";
import type { DataConnectorExecutor } from "./data-connector-executors";
import { GroupService } from "./group-service";
import { DeviceAuthorizationService } from "./device-authorization-service";
import { KnowledgeService } from "./knowledge-service";
import type { KnowledgeBinaryExtractor } from "./knowledge-extraction-worker";
import type { FileOcrProvider } from "./file-ocr";
import { LocalAuthService } from "./local-auth-service";
import { LdapAuthService } from "./ldap-auth-service";
import type { LdapClientFactory } from "./ldap-directory-client";
import { JobService } from "./job-service";
import { withTelemetryObjectStore } from "./telemetry-context";
import { ImageGenerationService } from "./image-generation-service";
import { InterfacePreferenceService } from "./interface-preference-service";
import { EvalService } from "./eval-service";
import { EdgeSecurityService } from "./edge-security-service";
import { FileService, type FileMalwareScanner } from "./file-service";
import { GaEvidencePostureService } from "./ga-evidence-posture-service";
import { GovernanceService } from "./governance-service";
import { ManagedSecretService } from "./managed-secret-service";
import type { SecretWriter } from "./secret-writer";
import {
  type ResendEmailClientFactory,
  type SmtpSendMail,
} from "./notification-delivery";
import type { FcmMessagingClientFactory } from "./notification-delivery-mobile";
import { NotificationService } from "./notification-service";
import { createNotificationDeliverySender } from "./notification-delivery-factory";
import { OpenAiChatCompletionsService } from "./openai-chat-completions-service";
import { OpenAiEmbeddingsService } from "./openai-embeddings-service";
import { OpenAiModelsService } from "./openai-models-service";
import { OpenWebUiCompatibilityService } from "./openwebui-compatibility-service";
import type { OidcAuthenticator } from "./oidc-auth-service";
import { OidcPkceService } from "./oidc-pkce-service";
import { OAuth2PkceService } from "./oauth2-pkce-service";
import { ProviderService } from "./provider-service";
import { PostgresOperationalPostureService } from "./postgres-operational-posture-service";
import { PromptTemplateService } from "./prompt-template-service";
import { createQdrantKnowledgeVectorStore } from "./qdrant-knowledge-vector-store";
import type { QdrantSdkClientFactory } from "./qdrant-knowledge-vector-store";
import type { QuotaCoordinator } from "./quota-coordination";
import { QuotaService } from "./quota-service";
import { RagPolicyService } from "./rag-policy-service";
import { RagPostureService } from "./rag-posture-service";
import { ReadinessService } from "./readiness-service";
import { RunEventSequencer } from "./run-event-sequencer";
import { RunService } from "./run-service";
import { TemporaryChatCleanupWorker } from "./temporary-chat-cleanup-worker";
import { ServiceAccountService } from "./service-account-service";
import {
  canResolveExternalVectorStoreSecret,
  createFileOcrProvider,
  createChatEventTransport,
  createKnowledgeExtractor,
  createObjectStore,
  createOidcAuthenticator,
  createQuotaCoordinator,
  createSecretResolver,
  createSecretWriter,
  createToolDispatchPayloadStore,
  createVoiceProvider,
} from "./service-runtime-factories";
import { buildServiceRegistry } from "./service-registry-builder";
import { SecretRotationService } from "./secret-rotation-service";
import { SessionService } from "./session-service";
import {
  SchemeRoutingSecretResolver,
  type SecretResolver,
} from "./secret-resolver";
import { SamlAuthService } from "./saml-auth-service";
import type { SamlClientFactory } from "./saml-client";
import { ScimService } from "./scim-service";
import { SsoSettingsService } from "./sso-settings-service";
import { TenantAdminService } from "./tenant-admin-service";
import { ToolConnectorService } from "./tool-connector-service";
import { ToolService } from "./tool-service";
import { UsageService } from "./usage-service";
import { UserLifecycleService } from "./user-lifecycle-service";
import { VoiceService } from "./voice-service";
import { WebhookService } from "./webhook-service";
import { WorkflowService } from "./workflow-service";
import { WorkspaceService } from "./workspace-service";
import { WorkspaceContentService } from "./workspace-content-service";
import { WebSearchService } from "./web-search-service";
import {
  vectorStoreDeploymentFromEnv,
  withExternalVectorRoutingActive,
} from "./vector-store-deployment";

export interface RomeoServices {
  abuseControls: AbuseControlService;
  analytics: AnalyticsService;
  agentKnowledge: AgentKnowledgeService;
  agents: AgentService;
  apiKeys: ApiKeyService;
  audit: AuditService;
  authProviderSettings: AuthProviderSettingsService;
  billing: BillingService;
  browserAutomation: BrowserAutomationService;
  channels: ChannelService;
  chatEvents: ChatEventService;
  chatExperience: ChatExperienceService;
  chats: ChatService;
  temporaryChatCleanup: TemporaryChatCleanupWorker;
  chatComments: ChatCommentService;
  chatTags: ChatTagService;
  collaboration: CollaborationService;
  dataConnectors: DataConnectorService;
  delegatedOAuth: DelegatedOAuthService;
  deployment: { tenancyMode: RomeoEnv["TENANCY_MODE"] };
  directorySync: DirectorySyncService;
  deviceAuthorizations: DeviceAuthorizationService;
  edgeSecurity: EdgeSecurityService;
  evals: EvalService;
  files: FileService;
  gaEvidencePosture: GaEvidencePostureService;
  knowledge: KnowledgeService;
  jobs: JobService;
  images: ImageGenerationService;
  interfacePreferences: InterfacePreferenceService;
  ldapAuth: LdapAuthService;
  localAuth: LocalAuthService;
  managedSecrets: ManagedSecretService;
  governance: GovernanceService;
  groups: GroupService;
  notifications: NotificationService;
  oidc: OidcAuthenticator;
  oidcPkce: OidcPkceService;
  oauth2Pkce: OAuth2PkceService;
  openAiChatCompletions: OpenAiChatCompletionsService;
  openAiEmbeddings: OpenAiEmbeddingsService;
  openAiModels: OpenAiModelsService;
  openWebUiCompatibility: OpenWebUiCompatibilityService;
  postgresOperationalPosture: PostgresOperationalPostureService;
  providers: ProviderService;
  prompts: PromptTemplateService;
  quotas: QuotaService;
  ragPolicy: RagPolicyService;
  ragPosture: RagPostureService;
  readiness: ReadinessService;
  runs: RunService;
  samlAuth: SamlAuthService;
  scim: ScimService;
  secretRotation: SecretRotationService;
  serviceAccounts: ServiceAccountService;
  sessions: SessionService;
  ssoSettings: SsoSettingsService;
  tenantAdmin: TenantAdminService;
  toolConnectors: ToolConnectorService;
  tools: ToolService;
  usage: UsageService;
  users: UserLifecycleService;
  voices: VoiceService;
  webhooks: WebhookService;
  webSearch: WebSearchService;
  workflows: WorkflowService;
  workspace: WorkspaceService;
  workspaceContent: WorkspaceContentService;
}

export interface CreateServicesOptions {
  env?: RomeoEnv;
  dataConnectorExecutor?: DataConnectorExecutor;
  knowledgeExtractor?: KnowledgeBinaryExtractor;
  embeddingFetch?: typeof fetch;
  fileMalwareScanner?: FileMalwareScanner;
  fileOcrProvider?: FileOcrProvider;
  delegatedOAuthFetch?: typeof fetch;
  ldapClientFactory?: LdapClientFactory;
  objectStore?: ObjectStore;
  oidcFetch?: typeof fetch;
  providerFetch?: typeof fetch;
  qdrantClientFactory?: QdrantSdkClientFactory;
  quotaCoordinator?: QuotaCoordinator;
  chatEventTransport?: ChatEventTransport;
  samlClientFactory?: SamlClientFactory;
  secretResolver?: SecretResolver;
  secretWriter?: SecretWriter;
  notificationSmtpSendMail?: SmtpSendMail;
  notificationResendClientFactory?: ResendEmailClientFactory;
  notificationFcmClientFactory?: FcmMessagingClientFactory;
  toolOperationFetch?: typeof fetch;
  voiceProvider?: VoiceProvider;
  webhookFetch?: typeof fetch;
}

export function createServices(
  repository: RomeoRepository,
  options: CreateServicesOptions = {},
): RomeoServices {
  const runEventSequencer = new RunEventSequencer();
  const env = options.env ?? readEnv();
  const baseObjectStore = options.objectStore ?? createObjectStore(env);
  const objectStore =
    baseObjectStore === disabledObjectStore
      ? baseObjectStore
      : withTelemetryObjectStore(baseObjectStore);
  const quotaCoordinator =
    options.quotaCoordinator ?? createQuotaCoordinator(env);
  const chatEventTransport =
    options.chatEventTransport ?? createChatEventTransport(env);
  const vectorStoreDeployment = vectorStoreDeploymentFromEnv(env);
  const secretWriter = options.secretWriter ?? createSecretWriter(env);
  const managedSecrets = new ManagedSecretService(
    repository,
    env,
    secretWriter,
  );
  const externalSecretResolver =
    options.secretResolver ?? createSecretResolver(env);
  const secretResolver = new SchemeRoutingSecretResolver(
    { "romeo-secret": managedSecrets },
    externalSecretResolver,
  );
  const knowledgeVectorStore = canResolveExternalVectorStoreSecret(env, options)
    ? createQdrantKnowledgeVectorStore(
        env,
        secretResolver,
        options.qdrantClientFactory,
      )
    : undefined;
  const activeVectorStoreDeployment =
    knowledgeVectorStore === undefined
      ? vectorStoreDeployment
      : withExternalVectorRoutingActive(vectorStoreDeployment);
  const toolDispatchPayloadStore = createToolDispatchPayloadStore(
    env,
    objectStore,
  );
  const delegatedOAuth = new DelegatedOAuthService(
    repository,
    env,
    options.delegatedOAuthFetch === undefined
      ? {}
      : { fetchImpl: options.delegatedOAuthFetch },
  );
  const dataConnectorExecutor =
    options.dataConnectorExecutor ??
    createDataConnectorExecutor(env, secretResolver, delegatedOAuth);
  const knowledgeExtractor =
    options.knowledgeExtractor ?? createKnowledgeExtractor(env);
  const fileOcrProvider = options.fileOcrProvider ?? createFileOcrProvider(env);
  const oidc = createOidcAuthenticator(repository, env, options.oidcFetch);
  const voiceProvider = options.voiceProvider ?? createVoiceProvider(env);
  const sessions = new SessionService(repository);
  const webhookOptions: { fetchImpl?: typeof fetch; signingKey: string } = {
    signingKey: env.WEBHOOK_SIGNING_KEY,
  };
  if (options.webhookFetch !== undefined)
    webhookOptions.fetchImpl = options.webhookFetch;
  const webhooks = new WebhookService(repository, webhookOptions);
  const notificationDelivery = createNotificationDeliverySender(env, {
    ...webhookOptions,
    secretResolver,
    ...(options.notificationSmtpSendMail === undefined
      ? {}
      : { smtpSendMail: options.notificationSmtpSendMail }),
    ...(options.notificationResendClientFactory === undefined
      ? {}
      : { resendClientFactory: options.notificationResendClientFactory }),
    ...(options.notificationFcmClientFactory === undefined
      ? {}
      : { fcmClientFactory: options.notificationFcmClientFactory }),
  });
  const toolOperationExecutionEnabled =
    env.TOOL_OPERATION_EXECUTION_DRIVER === "http-fetch";
  const tools = new ToolService(repository, runEventSequencer, webhooks, {
    externalOperationExecutionEnabled: toolOperationExecutionEnabled,
    maxBytes: env.TOOL_OPERATION_FETCH_MAX_BYTES,
    quotaCoordinator,
    timeoutMs: env.TOOL_OPERATION_FETCH_TIMEOUT_MS,
    secretResolver,
    ...(toolDispatchPayloadStore === undefined
      ? {}
      : { dispatchPayloadStore: toolDispatchPayloadStore }),
    ...(options.toolOperationFetch === undefined
      ? {}
      : { fetchImpl: options.toolOperationFetch }),
  });
  const knowledge = new KnowledgeService(
    repository,
    undefined,
    objectStore,
    knowledgeExtractor,
    options.embeddingFetch,
    webhooks,
    {
      vectorDriver: activeVectorStoreDeployment.activeDriver,
      isolationMode: activeVectorStoreDeployment.isolationMode,
      externalVectorStoreDriver:
        activeVectorStoreDeployment.externalVectorStore.driver,
      externalVectorStoreConfigured:
        activeVectorStoreDeployment.externalVectorStore.configured,
      externalVectorStoreRoutingActive:
        activeVectorStoreDeployment.externalVectorStore.routingActive,
      namespaceConfigured:
        activeVectorStoreDeployment.externalVectorStore.namespacePolicy !==
        "none",
      namespacePolicy:
        activeVectorStoreDeployment.externalVectorStore.namespacePolicy,
      partitioningConfigured:
        activeVectorStoreDeployment.externalVectorStore.partitioningPolicy !==
        "none",
      partitioningPolicy:
        activeVectorStoreDeployment.externalVectorStore.partitioningPolicy,
    },
    knowledgeVectorStore,
    quotaCoordinator,
  );
  const webSearch = new WebSearchService(repository, {
    secretResolver,
    quotaCoordinator,
    webhooks,
    timeoutMs: env.WEB_SEARCH_TIMEOUT_MS,
    ...(options.providerFetch === undefined
      ? {}
      : { fetchImpl: options.providerFetch }),
    hostLookup: async (hostname) =>
      (await lookup(hostname, { all: true })).map((address) => ({
        address: address.address,
        family: address.family === 6 ? 6 : 4,
      })),
  });
  const runs = new RunService(
    repository,
    runEventSequencer,
    webhooks,
    options.embeddingFetch,
    objectStore,
    {
      providerCircuitCooldownMs: env.MODEL_PROVIDER_CIRCUIT_COOLDOWN_MS,
      providerCircuitFailureThreshold:
        env.MODEL_PROVIDER_CIRCUIT_FAILURE_THRESHOLD,
      providerDisabledIds: env.MODEL_PROVIDER_DISABLED_IDS,
      providerFallbackModelId: env.MODEL_PROVIDER_FALLBACK_MODEL_ID,
      providerRetryAttempts: env.MODEL_PROVIDER_RETRY_ATTEMPTS,
      providerRetryBackoffMs: env.MODEL_PROVIDER_RETRY_BACKOFF_MS,
      managedModelPreferenceEncryptionKey: env.MANAGED_SECRET_ENCRYPTION_KEY,
      managedModelPreferencePreviousEncryptionKey:
        env.MANAGED_SECRET_ENCRYPTION_KEY_PREVIOUS,
      modelToolExecutor: (input) =>
        tools.executeForRun(
          input.subject,
          input.runId,
          input.toolId,
          input.input,
          { modelToolCallId: input.modelToolCallId },
        ),
      ...(options.providerFetch === undefined
        ? {}
        : { providerFetch: options.providerFetch }),
      providerStreamTimeoutMs: env.MODEL_PROVIDER_STREAM_TIMEOUT_MS,
      runExecutionLeaseSeconds: env.RUN_EXECUTION_LEASE_SECONDS,
      runRecoveryStaleMs: env.RUN_RECOVERY_STALE_MS,
      secretResolver,
      ...(toolDispatchPayloadStore === undefined
        ? {}
        : { dispatchPayloadStore: toolDispatchPayloadStore }),
      ...(knowledgeVectorStore === undefined ? {} : { knowledgeVectorStore }),
      messageAttachmentMaxBytes: env.MESSAGE_ATTACHMENT_MAX_BYTES,
      malwareScanning: {
        policy: env.FILE_MALWARE_SCAN_POLICY,
        ...(options.fileMalwareScanner === undefined
          ? {}
          : { scanner: options.fileMalwareScanner }),
      },
      quotaCoordinator,
      toolOperationExecutionEnabled,
      webRetrieval: (input) => webSearch.retrievalHits(input.subject, input),
    },
  );
  const users = new UserLifecycleService(repository);
  const directorySync = new DirectorySyncService(repository, users);
  const openWebUiCompatibility = new OpenWebUiCompatibilityService(repository);
  const authProviderSettings = new AuthProviderSettingsService(
    repository,
    env,
    options.oidcFetch,
    secretResolver,
    options.ldapClientFactory,
  );
  const toolConnectorOptions: ConstructorParameters<
    typeof ToolConnectorService
  >[2] = {
    externalOperationExecutionEnabled: toolOperationExecutionEnabled,
    maxBytes: env.TOOL_OPERATION_FETCH_MAX_BYTES,
    timeoutMs: env.TOOL_OPERATION_FETCH_TIMEOUT_MS,
    ...(toolDispatchPayloadStore === undefined
      ? {}
      : { dispatchPayloadStore: toolDispatchPayloadStore }),
  };
  if (options.toolOperationFetch !== undefined)
    toolConnectorOptions.fetchImpl = options.toolOperationFetch;
  const workflows = new WorkflowService(repository, runs);
  const browserAutomation = new BrowserAutomationService(
    repository,
    workflows,
    objectStore,
    env,
  );
  const abuseControls = new AbuseControlService(repository);
  const files = new FileService(
    repository,
    objectStore,
    quotaCoordinator,
    {
      directUploadMaxBytes: env.FILE_DIRECT_UPLOAD_MAX_BYTES,
      inlineMaxBytes: env.FILE_INLINE_MAX_BYTES,
      resumableUploadMaxBytes: env.FILE_RESUMABLE_UPLOAD_MAX_BYTES,
    },
    {
      policy: env.FILE_MALWARE_SCAN_POLICY,
      ...(options.fileMalwareScanner === undefined
        ? {}
        : { scanner: options.fileMalwareScanner }),
    },
    knowledgeExtractor,
    fileOcrProvider,
  );
  const chats = new ChatService(repository, objectStore, {
    policy: env.FILE_MALWARE_SCAN_POLICY,
    ...(options.fileMalwareScanner === undefined
      ? {}
      : { scanner: options.fileMalwareScanner }),
  });
  const chatEvents = new ChatEventService(chatEventTransport);
  const temporaryChatCleanup = new TemporaryChatCleanupWorker(
    repository,
    chats,
    {
      enabled: env.TEMPORARY_CHAT_CLEANUP_ENABLED,
      intervalMs: env.TEMPORARY_CHAT_CLEANUP_INTERVAL_MS,
      batchSize: env.TEMPORARY_CHAT_CLEANUP_BATCH_SIZE,
      leaseSeconds: env.TEMPORARY_CHAT_CLEANUP_LEASE_SECONDS,
    },
  );
  return buildServiceRegistry({
    abuseControls,
    activeVectorStoreDeployment,
    authProviderSettings,
    browserAutomation,
    chatEvents,
    chats,
    dataConnectorExecutor,
    delegatedOAuth,
    directorySync,
    env,
    files,
    knowledge,
    ...(knowledgeVectorStore === undefined ? {} : { knowledgeVectorStore }),
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
  });
}
