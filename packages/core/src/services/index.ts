import { readEnv, type RomeoEnv } from "@romeo/config";
import { lookup } from "node:dns/promises";
import {
  memoryObjectStore,
  S3ObjectStore,
  type ObjectStore,
} from "@romeo/storage";
import {
  devVoiceProvider,
  disabledVoiceProvider,
  OpenAICompatibleVoiceProvider,
  parseOpenAICompatibleVoiceCatalog,
  type VoiceProvider,
} from "@romeo/voices";

import type { RomeoRepository } from "../domain/repository";
import { AbuseControlService } from "./abuse-control-service";
import { AnalyticsService } from "./analytics-service";
import { AuditService } from "./audit-service";
import { AuthProviderSettingsService } from "./auth-provider-settings-service";
import { AgentKnowledgeService } from "./agent-knowledge-service";
import { AgentService } from "./agent-service";
import { ApiKeyService } from "./api-key-service";
import { AtlassianDataConnectorExecutor } from "./atlassian-data-connector-executor";
import { BillingService } from "./billing-service";
import { BrowserAutomationService } from "./browser-automation-service";
import { ChannelService } from "./channel-service";
import { ChatService } from "./chat-service";
import { ChatCommentService } from "./chat-comment-service";
import { ChatTagService } from "./chat-tag-service";
import { CollaborationService } from "./collaboration-service";
import {
  AwsSecretsManagerResolver,
  AzureKeyVaultResolver,
  CloudSecretResolver,
  GcpSecretManagerResolver,
} from "./cloud-secret-resolver";
import { DataConnectorService } from "./data-connector-service";
import { DelegatedOAuthService } from "./delegated-oauth-service";
import { DirectorySyncService } from "./directory-sync-service";
import {
  disabledDataConnectorExecutor,
  S3DataConnectorExecutor,
  WebsiteDataConnectorExecutor,
  type DataConnectorExecutor,
  type WebsiteConnectorHostAddress,
} from "./data-connector-executors";
import {
  GitHubDataConnectorExecutor,
  RoutingDataConnectorExecutor,
} from "./github-data-connector-executor";
import { GroupService } from "./group-service";
import { DeviceAuthorizationService } from "./device-authorization-service";
import { KnowledgeService } from "./knowledge-service";
import {
  disabledKnowledgeBinaryExtractor,
  type KnowledgeBinaryExtractor,
} from "./knowledge-extraction-worker";
import { LinearDataConnectorExecutor } from "./linear-data-connector-executor";
import { LocalDocumentTextExtractor } from "./local-document-extractor";
import { LocalAuthService } from "./local-auth-service";
import { LdapAuthService } from "./ldap-auth-service";
import type { LdapClientFactory } from "./ldap-directory-client";
import { LocalPdfTextExtractor } from "./local-pdf-extractor";
import { JobService } from "./job-service";
import { EvalService } from "./eval-service";
import { EdgeSecurityService } from "./edge-security-service";
import { FileService } from "./file-service";
import { GaEvidencePostureService } from "./ga-evidence-posture-service";
import { GovernanceService } from "./governance-service";
import { ManagedSecretService } from "./managed-secret-service";
import { VaultSecretWriter, type SecretWriter } from "./secret-writer";
import {
  disabledNotificationDeliverySender,
  RoutingNotificationDeliverySender,
  ResendEmailNotificationDeliverySender,
  SlackWebhookNotificationDeliverySender,
  SmtpEmailNotificationDeliverySender,
  WebhookNotificationDeliverySender,
  type NotificationDeliverySender,
  type SmtpSendMail,
} from "./notification-delivery";
import {
  PagerDutyEventsNotificationDeliverySender,
  TeamsWebhookNotificationDeliverySender,
} from "./notification-delivery-enterprise";
import { FcmMobilePushNotificationDeliverySender } from "./notification-delivery-mobile";
import { NotificationService } from "./notification-service";
import { OpenAiChatCompletionsService } from "./openai-chat-completions-service";
import { OpenAiEmbeddingsService } from "./openai-embeddings-service";
import { OpenAiModelsService } from "./openai-models-service";
import { OpenWebUiCompatibilityService } from "./openwebui-compatibility-service";
import {
  DiscoveryOidcAuthenticator,
  type OidcAuthenticator,
} from "./oidc-auth-service";
import { NotionDataConnectorExecutor } from "./notion-data-connector-executor";
import { OidcPkceService } from "./oidc-pkce-service";
import { OAuth2PkceService } from "./oauth2-pkce-service";
import { ProviderService } from "./provider-service";
import { PostgresOperationalPostureService } from "./postgres-operational-posture-service";
import { PromptTemplateService } from "./prompt-template-service";
import { createQdrantKnowledgeVectorStore } from "./qdrant-knowledge-vector-store";
import {
  createDisabledQuotaCoordinator,
  type QuotaCoordinator,
} from "./quota-coordination";
import { QuotaService } from "./quota-service";
import { RagPolicyService } from "./rag-policy-service";
import { RagPostureService } from "./rag-posture-service";
import { ReadinessService } from "./readiness-service";
import { RunEventSequencer } from "./run-event-sequencer";
import { RunService } from "./run-service";
import { S3HttpConnectorReader } from "./s3-data-connector-reader";
import { ServiceAccountService } from "./service-account-service";
import { SecretRotationService } from "./secret-rotation-service";
import { SessionService } from "./session-service";
import { SlackDataConnectorExecutor } from "./slack-data-connector-executor";
import {
  disabledSecretResolver,
  EnvironmentSecretResolver,
  SchemeRoutingSecretResolver,
  VaultSecretResolver,
  type SecretResolver,
} from "./secret-resolver";
import {
  EncryptedObjectToolDispatchPayloadStore,
  type ToolDispatchPayloadStore,
} from "./tool-dispatch-payload-store";
import { SamlAuthService } from "./saml-auth-service";
import type { SamlClientFactory } from "./saml-client";
import { ScimService } from "./scim-service";
import { SsoSettingsService } from "./sso-settings-service";
import { TenantAdminService } from "./tenant-admin-service";
import { ToolConnectorService } from "./tool-connector-service";
import { ToolService } from "./tool-service";
import { UsageService } from "./usage-service";
import { UserLifecycleService } from "./user-lifecycle-service";
import { ValkeyQuotaCoordinator } from "./valkey-quota-coordinator";
import { VoiceService } from "./voice-service";
import { WebhookService } from "./webhook-service";
import { WorkflowService } from "./workflow-service";
import { WorkspaceService } from "./workspace-service";
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
  chats: ChatService;
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
  workflows: WorkflowService;
  workspace: WorkspaceService;
}

export function createServices(
  repository: RomeoRepository,
  options: {
    env?: RomeoEnv;
    dataConnectorExecutor?: DataConnectorExecutor;
    knowledgeExtractor?: KnowledgeBinaryExtractor;
    embeddingFetch?: typeof fetch;
    delegatedOAuthFetch?: typeof fetch;
    ldapClientFactory?: LdapClientFactory;
    objectStore?: ObjectStore;
    oidcFetch?: typeof fetch;
    providerFetch?: typeof fetch;
    qdrantFetch?: typeof fetch;
    quotaCoordinator?: QuotaCoordinator;
    samlClientFactory?: SamlClientFactory;
    secretResolver?: SecretResolver;
    secretWriter?: SecretWriter;
    notificationSmtpSendMail?: SmtpSendMail;
    toolOperationFetch?: typeof fetch;
    voiceProvider?: VoiceProvider;
    webhookFetch?: typeof fetch;
  } = {},
): RomeoServices {
  const runEventSequencer = new RunEventSequencer();
  const env = options.env ?? readEnv();
  const objectStore = options.objectStore ?? createObjectStore(env);
  const quotaCoordinator =
    options.quotaCoordinator ?? createQuotaCoordinator(env);
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
    ? createQdrantKnowledgeVectorStore(env, secretResolver, options.qdrantFetch)
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
      secretResolver,
      ...(toolDispatchPayloadStore === undefined
        ? {}
        : { dispatchPayloadStore: toolDispatchPayloadStore }),
      ...(knowledgeVectorStore === undefined ? {} : { knowledgeVectorStore }),
      messageAttachmentMaxBytes: env.MESSAGE_ATTACHMENT_MAX_BYTES,
      quotaCoordinator,
      toolOperationExecutionEnabled,
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
  return {
    abuseControls,
    analytics: new AnalyticsService(repository),
    agentKnowledge: new AgentKnowledgeService(repository),
    agents: new AgentService(repository),
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
    chats: new ChatService(repository, objectStore),
    chatComments: new ChatCommentService(repository, notificationDelivery),
    chatTags: new ChatTagService(repository),
    collaboration: new CollaborationService(repository),
    dataConnectors: new DataConnectorService(
      repository,
      knowledge,
      dataConnectorExecutor,
      {
        executionDriver: env.DATA_CONNECTOR_EXECUTION_DRIVER,
        egressPolicy: env.DATA_CONNECTOR_EGRESS_POLICY,
        allowedHostRuleCount: csvEnv(env.DATA_CONNECTOR_FETCH_ALLOWED_HOSTS)
          .length,
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
      },
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
    files: new FileService(repository, objectStore, quotaCoordinator, {
      directUploadMaxBytes: env.FILE_DIRECT_UPLOAD_MAX_BYTES,
      inlineMaxBytes: env.FILE_INLINE_MAX_BYTES,
      resumableUploadMaxBytes: env.FILE_RESUMABLE_UPLOAD_MAX_BYTES,
    }),
    gaEvidencePosture: new GaEvidencePostureService(env),
    governance: new GovernanceService(repository, objectStore, {
      env,
      scimEnabled: env.SCIM_ENABLED,
      deleteKnowledgeSource: (input) => knowledge.deleteSource(input),
    }),
    groups: new GroupService(repository),
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
    providers: new ProviderService(repository),
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
    workflows,
    workspace: new WorkspaceService(repository),
  };
}

function canResolveExternalVectorStoreSecret(
  env: RomeoEnv,
  options: { secretResolver?: SecretResolver },
): boolean {
  if (env.EXTERNAL_VECTOR_STORE_DRIVER !== "qdrant") return false;
  if (env.QDRANT_API_KEY_REF.trim().startsWith("romeo-secret://")) return true;
  if (options.secretResolver !== undefined) return true;
  return env.SECRET_RESOLVER_DRIVER !== "disabled";
}

function createOidcAuthenticator(
  repository: RomeoRepository,
  env: RomeoEnv,
  fetchImpl: typeof fetch | undefined,
): OidcAuthenticator {
  return new DiscoveryOidcAuthenticator(
    repository,
    env,
    fetchImpl === undefined ? {} : { fetchImpl },
  );
}

function createObjectStore(env: RomeoEnv): ObjectStore {
  if (env.OBJECT_STORE_DRIVER === "s3") {
    return new S3ObjectStore({
      endpoint: env.S3_ENDPOINT,
      bucket: env.S3_BUCKET,
      region: env.S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    });
  }
  return memoryObjectStore;
}

function createQuotaCoordinator(env: RomeoEnv): QuotaCoordinator {
  if (env.QUOTA_COORDINATION_DRIVER === "valkey") {
    return new ValkeyQuotaCoordinator({
      keyPrefix: env.QUOTA_COORDINATION_KEY_PREFIX,
      timeoutMs: env.QUOTA_COORDINATION_TIMEOUT_MS,
      url: env.VALKEY_URL,
    });
  }
  return createDisabledQuotaCoordinator(env.QUOTA_COORDINATION_KEY_PREFIX);
}

function createToolDispatchPayloadStore(
  env: RomeoEnv,
  objectStore: ObjectStore,
): ToolDispatchPayloadStore | undefined {
  if (env.TOOL_DISPATCH_PAYLOAD_STORE_DRIVER !== "object-store")
    return undefined;
  return new EncryptedObjectToolDispatchPayloadStore(objectStore, {
    encryptionKey: env.TOOL_DISPATCH_PAYLOAD_ENCRYPTION_KEY,
    prefix: env.TOOL_DISPATCH_PAYLOAD_STORE_PREFIX,
  });
}

function createKnowledgeExtractor(env: RomeoEnv): KnowledgeBinaryExtractor {
  if (env.KNOWLEDGE_EXTRACTION_DRIVER === "local-pdftotext") {
    return new LocalPdfTextExtractor({
      commandPath: env.PDFTOTEXT_PATH,
      maxBytes: env.KNOWLEDGE_EXTRACTION_MAX_BYTES,
      timeoutMs: env.KNOWLEDGE_EXTRACTION_TIMEOUT_MS,
    });
  }
  if (env.KNOWLEDGE_EXTRACTION_DRIVER === "local-documents") {
    return new LocalDocumentTextExtractor({
      ooxml: { maxBytes: env.KNOWLEDGE_EXTRACTION_MAX_BYTES },
      pdf: {
        commandPath: env.PDFTOTEXT_PATH,
        maxBytes: env.KNOWLEDGE_EXTRACTION_MAX_BYTES,
        timeoutMs: env.KNOWLEDGE_EXTRACTION_TIMEOUT_MS,
      },
    });
  }
  return disabledKnowledgeBinaryExtractor;
}

function createDataConnectorExecutor(
  env: RomeoEnv,
  secretResolver: SecretResolver,
  delegatedOAuth: DelegatedOAuthService,
): DataConnectorExecutor {
  const websiteExecutor = () =>
    new WebsiteDataConnectorExecutor({
      allowedHosts: csvEnv(env.DATA_CONNECTOR_FETCH_ALLOWED_HOSTS),
      egressPolicy: env.DATA_CONNECTOR_EGRESS_POLICY,
      maxBytes: env.DATA_CONNECTOR_FETCH_MAX_BYTES,
      hostLookup: lookupWebsiteConnectorHost,
      retryAttempts: env.DATA_CONNECTOR_FETCH_RETRY_ATTEMPTS,
      retryBackoffMs: env.DATA_CONNECTOR_FETCH_RETRY_BACKOFF_MS,
      timeoutMs: env.DATA_CONNECTOR_FETCH_TIMEOUT_MS,
    });
  const githubExecutor = () =>
    new GitHubDataConnectorExecutor({
      delegatedOAuthCredentials: delegatedOAuth,
      maxBytes: env.DATA_CONNECTOR_FETCH_MAX_BYTES,
      retryAttempts: env.DATA_CONNECTOR_FETCH_RETRY_ATTEMPTS,
      retryBackoffMs: env.DATA_CONNECTOR_FETCH_RETRY_BACKOFF_MS,
      secretResolver,
      timeoutMs: env.DATA_CONNECTOR_FETCH_TIMEOUT_MS,
      token: env.DATA_CONNECTOR_GITHUB_TOKEN,
    });
  const s3Executor = () =>
    new S3DataConnectorExecutor(
      new S3HttpConnectorReader({
        accessKeyId: env.S3_ACCESS_KEY_ID,
        endpoint: env.S3_ENDPOINT,
        secretResolver,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
        retryAttempts: env.DATA_CONNECTOR_FETCH_RETRY_ATTEMPTS,
        retryBackoffMs: env.DATA_CONNECTOR_FETCH_RETRY_BACKOFF_MS,
        timeoutMs: env.DATA_CONNECTOR_FETCH_TIMEOUT_MS,
      }),
      { maxBytes: env.DATA_CONNECTOR_FETCH_MAX_BYTES },
    );
  const atlassianExecutor = () =>
    new AtlassianDataConnectorExecutor({
      allowedHosts: csvEnv(env.DATA_CONNECTOR_FETCH_ALLOWED_HOSTS),
      egressPolicy: env.DATA_CONNECTOR_EGRESS_POLICY,
      maxBytes: env.DATA_CONNECTOR_FETCH_MAX_BYTES,
      hostLookup: lookupWebsiteConnectorHost,
      retryAttempts: env.DATA_CONNECTOR_FETCH_RETRY_ATTEMPTS,
      retryBackoffMs: env.DATA_CONNECTOR_FETCH_RETRY_BACKOFF_MS,
      secretResolver,
      timeoutMs: env.DATA_CONNECTOR_FETCH_TIMEOUT_MS,
    });
  const notionExecutor = () =>
    new NotionDataConnectorExecutor({
      allowedHosts: csvEnv(env.DATA_CONNECTOR_FETCH_ALLOWED_HOSTS),
      egressPolicy: env.DATA_CONNECTOR_EGRESS_POLICY,
      maxBytes: env.DATA_CONNECTOR_FETCH_MAX_BYTES,
      hostLookup: lookupWebsiteConnectorHost,
      retryAttempts: env.DATA_CONNECTOR_FETCH_RETRY_ATTEMPTS,
      retryBackoffMs: env.DATA_CONNECTOR_FETCH_RETRY_BACKOFF_MS,
      secretResolver,
      timeoutMs: env.DATA_CONNECTOR_FETCH_TIMEOUT_MS,
    });
  const linearExecutor = () =>
    new LinearDataConnectorExecutor({
      allowedHosts: csvEnv(env.DATA_CONNECTOR_FETCH_ALLOWED_HOSTS),
      egressPolicy: env.DATA_CONNECTOR_EGRESS_POLICY,
      maxBytes: env.DATA_CONNECTOR_FETCH_MAX_BYTES,
      hostLookup: lookupWebsiteConnectorHost,
      retryAttempts: env.DATA_CONNECTOR_FETCH_RETRY_ATTEMPTS,
      retryBackoffMs: env.DATA_CONNECTOR_FETCH_RETRY_BACKOFF_MS,
      secretResolver,
      timeoutMs: env.DATA_CONNECTOR_FETCH_TIMEOUT_MS,
    });
  const slackExecutor = () =>
    new SlackDataConnectorExecutor({
      allowedHosts: csvEnv(env.DATA_CONNECTOR_FETCH_ALLOWED_HOSTS),
      egressPolicy: env.DATA_CONNECTOR_EGRESS_POLICY,
      maxBytes: env.DATA_CONNECTOR_FETCH_MAX_BYTES,
      hostLookup: lookupWebsiteConnectorHost,
      retryAttempts: env.DATA_CONNECTOR_FETCH_RETRY_ATTEMPTS,
      retryBackoffMs: env.DATA_CONNECTOR_FETCH_RETRY_BACKOFF_MS,
      secretResolver,
      timeoutMs: env.DATA_CONNECTOR_FETCH_TIMEOUT_MS,
    });
  if (env.DATA_CONNECTOR_EXECUTION_DRIVER === "website-fetch") {
    return websiteExecutor();
  }
  if (env.DATA_CONNECTOR_EXECUTION_DRIVER === "github-fetch") {
    return githubExecutor();
  }
  if (env.DATA_CONNECTOR_EXECUTION_DRIVER === "s3-fetch") {
    return s3Executor();
  }
  if (env.DATA_CONNECTOR_EXECUTION_DRIVER === "atlassian-fetch") {
    return atlassianExecutor();
  }
  if (env.DATA_CONNECTOR_EXECUTION_DRIVER === "notion-fetch") {
    return notionExecutor();
  }
  if (env.DATA_CONNECTOR_EXECUTION_DRIVER === "linear-fetch") {
    return linearExecutor();
  }
  if (env.DATA_CONNECTOR_EXECUTION_DRIVER === "slack-fetch") {
    return slackExecutor();
  }
  if (env.DATA_CONNECTOR_EXECUTION_DRIVER === "managed-fetch") {
    return new RoutingDataConnectorExecutor({
      confluence: atlassianExecutor(),
      github: githubExecutor(),
      jira: atlassianExecutor(),
      linear: linearExecutor(),
      notion: notionExecutor(),
      rss: websiteExecutor(),
      s3: s3Executor(),
      slack: slackExecutor(),
      website: websiteExecutor(),
    });
  }
  return disabledDataConnectorExecutor;
}

async function lookupWebsiteConnectorHost(
  hostname: string,
): Promise<WebsiteConnectorHostAddress[]> {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.flatMap((record) =>
    record.family === 4 || record.family === 6
      ? [{ address: record.address, family: record.family }]
      : [],
  );
}

function createNotificationDeliverySender(
  env: RomeoEnv,
  options: {
    fetchImpl?: typeof fetch;
    secretResolver: SecretResolver;
    signingKey: string;
    smtpSendMail?: SmtpSendMail;
  },
): NotificationDeliverySender {
  if (env.NOTIFICATION_DELIVERY_DRIVER === "configured") {
    return new RoutingNotificationDeliverySender({
      email: createConfiguredEmailNotificationDeliverySender(env, options),
      mobile_push: createFcmMobilePushNotificationDeliverySender(env, options),
      pagerduty: createPagerDutyNotificationDeliverySender(env, options),
      slack: createSlackNotificationDeliverySender(env, options),
      teams: createTeamsNotificationDeliverySender(env, options),
      webhook: createWebhookNotificationDeliverySender(options),
    });
  }
  if (env.NOTIFICATION_DELIVERY_DRIVER === "fcm-mobile-push") {
    return createFcmMobilePushNotificationDeliverySender(env, options);
  }
  if (env.NOTIFICATION_DELIVERY_DRIVER === "resend-email") {
    return createResendEmailNotificationDeliverySender(env, options);
  }
  if (env.NOTIFICATION_DELIVERY_DRIVER === "slack-webhook") {
    return createSlackNotificationDeliverySender(env, options);
  }
  if (env.NOTIFICATION_DELIVERY_DRIVER === "smtp-email") {
    return createSmtpEmailNotificationDeliverySender(env, options);
  }
  if (env.NOTIFICATION_DELIVERY_DRIVER === "teams-webhook") {
    return createTeamsNotificationDeliverySender(env, options);
  }
  if (env.NOTIFICATION_DELIVERY_DRIVER === "pagerduty-events") {
    return createPagerDutyNotificationDeliverySender(env, options);
  }
  if (env.NOTIFICATION_DELIVERY_DRIVER === "webhook")
    return createWebhookNotificationDeliverySender(options);
  return disabledNotificationDeliverySender;
}

function createConfiguredEmailNotificationDeliverySender(
  env: RomeoEnv,
  options: {
    fetchImpl?: typeof fetch;
    smtpSendMail?: SmtpSendMail;
  },
): NotificationDeliverySender {
  return env.NOTIFICATION_EMAIL_DELIVERY_DRIVER === "smtp"
    ? createSmtpEmailNotificationDeliverySender(env, options)
    : createResendEmailNotificationDeliverySender(env, options);
}

function createResendEmailNotificationDeliverySender(
  env: RomeoEnv,
  options: {
    fetchImpl?: typeof fetch;
  },
): NotificationDeliverySender {
  return new ResendEmailNotificationDeliverySender({
    apiKey: env.NOTIFICATION_RESEND_API_KEY,
    baseUrl: env.NOTIFICATION_RESEND_BASE_URL,
    from: env.NOTIFICATION_EMAIL_FROM,
    timeoutMs: env.NOTIFICATION_RESEND_TIMEOUT_MS,
    ...(options.fetchImpl === undefined
      ? {}
      : { fetchImpl: options.fetchImpl }),
  });
}

function createSmtpEmailNotificationDeliverySender(
  env: RomeoEnv,
  options: {
    smtpSendMail?: SmtpSendMail;
  },
): NotificationDeliverySender {
  return new SmtpEmailNotificationDeliverySender({
    from: env.NOTIFICATION_EMAIL_FROM,
    host: env.NOTIFICATION_SMTP_HOST,
    password: env.NOTIFICATION_SMTP_PASSWORD,
    port: env.NOTIFICATION_SMTP_PORT,
    secure: env.NOTIFICATION_SMTP_SECURE,
    timeoutMs: env.NOTIFICATION_SMTP_TIMEOUT_MS,
    user: env.NOTIFICATION_SMTP_USER,
    ...(options.smtpSendMail === undefined
      ? {}
      : { sendMail: options.smtpSendMail }),
  });
}

function createSlackNotificationDeliverySender(
  env: RomeoEnv,
  options: {
    fetchImpl?: typeof fetch;
  },
): NotificationDeliverySender {
  return new SlackWebhookNotificationDeliverySender({
    timeoutMs: env.NOTIFICATION_SLACK_TIMEOUT_MS,
    ...(options.fetchImpl === undefined
      ? {}
      : { fetchImpl: options.fetchImpl }),
  });
}

function createTeamsNotificationDeliverySender(
  env: RomeoEnv,
  options: {
    fetchImpl?: typeof fetch;
  },
): NotificationDeliverySender {
  return new TeamsWebhookNotificationDeliverySender({
    timeoutMs: env.NOTIFICATION_TEAMS_TIMEOUT_MS,
    ...(options.fetchImpl === undefined
      ? {}
      : { fetchImpl: options.fetchImpl }),
  });
}

function createPagerDutyNotificationDeliverySender(
  env: RomeoEnv,
  options: {
    fetchImpl?: typeof fetch;
    secretResolver: SecretResolver;
  },
): NotificationDeliverySender {
  return new PagerDutyEventsNotificationDeliverySender({
    eventsUrl: env.NOTIFICATION_PAGERDUTY_EVENTS_URL,
    secretResolver: options.secretResolver,
    timeoutMs: env.NOTIFICATION_PAGERDUTY_TIMEOUT_MS,
    ...(options.fetchImpl === undefined
      ? {}
      : { fetchImpl: options.fetchImpl }),
  });
}

function createFcmMobilePushNotificationDeliverySender(
  env: RomeoEnv,
  options: {
    fetchImpl?: typeof fetch;
    secretResolver: SecretResolver;
  },
): NotificationDeliverySender {
  return new FcmMobilePushNotificationDeliverySender({
    baseUrl: env.NOTIFICATION_FCM_BASE_URL,
    projectId: env.NOTIFICATION_FCM_PROJECT_ID,
    secretResolver: options.secretResolver,
    serviceAccountRef: env.NOTIFICATION_FCM_SERVICE_ACCOUNT_REF,
    timeoutMs: env.NOTIFICATION_FCM_TIMEOUT_MS,
    tokenUrl: env.NOTIFICATION_FCM_TOKEN_URL,
    ...(options.fetchImpl === undefined
      ? {}
      : { fetchImpl: options.fetchImpl }),
  });
}

function createWebhookNotificationDeliverySender(options: {
  fetchImpl?: typeof fetch;
  signingKey: string;
}): NotificationDeliverySender {
  return new WebhookNotificationDeliverySender(options);
}

function createSecretResolver(env: RomeoEnv): SecretResolver {
  if (env.SECRET_RESOLVER_DRIVER === "env")
    return new EnvironmentSecretResolver();
  if (env.SECRET_RESOLVER_DRIVER === "vault") {
    return new VaultSecretResolver({
      address: env.VAULT_ADDR,
      token: env.VAULT_TOKEN,
      namespace: env.VAULT_NAMESPACE,
      kvMount: env.VAULT_KV_MOUNT,
      timeoutMs: env.VAULT_TIMEOUT_MS,
    });
  }
  if (env.SECRET_RESOLVER_DRIVER === "aws-sm")
    return createAwsSecretsManagerResolver(env);
  if (env.SECRET_RESOLVER_DRIVER === "gcp-sm")
    return createGcpSecretManagerResolver(env);
  if (env.SECRET_RESOLVER_DRIVER === "azure-kv")
    return createAzureKeyVaultResolver(env);
  if (env.SECRET_RESOLVER_DRIVER === "cloud") {
    return new CloudSecretResolver({
      aws: createAwsSecretsManagerResolver(env),
      gcp: createGcpSecretManagerResolver(env),
      azure: createAzureKeyVaultResolver(env),
    });
  }
  return disabledSecretResolver;
}

function createSecretWriter(env: RomeoEnv): SecretWriter {
  return new VaultSecretWriter({
    address: env.VAULT_ADDR,
    token: env.VAULT_TOKEN,
    namespace: env.VAULT_NAMESPACE,
    kvMount: env.VAULT_KV_MOUNT,
    timeoutMs: env.VAULT_TIMEOUT_MS,
  });
}

function createAwsSecretsManagerResolver(
  env: RomeoEnv,
): AwsSecretsManagerResolver {
  return new AwsSecretsManagerResolver({
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    sessionToken: env.AWS_SESSION_TOKEN,
    region: env.AWS_REGION,
    timeoutMs: env.AWS_SECRET_MANAGER_TIMEOUT_MS,
  });
}

function createGcpSecretManagerResolver(
  env: RomeoEnv,
): GcpSecretManagerResolver {
  return new GcpSecretManagerResolver({
    accessToken: env.GCP_ACCESS_TOKEN,
    projectId: env.GCP_SECRET_MANAGER_PROJECT,
    timeoutMs: env.GCP_SECRET_MANAGER_TIMEOUT_MS,
  });
}

function createAzureKeyVaultResolver(env: RomeoEnv): AzureKeyVaultResolver {
  return new AzureKeyVaultResolver({
    accessToken: env.AZURE_ACCESS_TOKEN,
    vaultUrl: env.AZURE_KEY_VAULT_URL,
    timeoutMs: env.AZURE_KEY_VAULT_TIMEOUT_MS,
  });
}

function createVoiceProvider(env: RomeoEnv): VoiceProvider {
  if (env.VOICE_PROVIDER_DRIVER === "dev") return devVoiceProvider;
  if (env.VOICE_PROVIDER_DRIVER === "openai-compatible") {
    return new OpenAICompatibleVoiceProvider({
      apiKey: env.VOICE_OPENAI_API_KEY,
      baseUrl: env.VOICE_OPENAI_BASE_URL,
      model: env.VOICE_OPENAI_MODEL,
      transcriptionModel: env.VOICE_OPENAI_TRANSCRIPTION_MODEL,
      voices: parseOpenAICompatibleVoiceCatalog(env.VOICE_OPENAI_VOICES),
      timeoutMs: env.VOICE_OPENAI_TIMEOUT_MS,
    });
  }
  return disabledVoiceProvider;
}

function csvEnv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
