import type { RomeoRepository } from "../domain/repository";
import { AbuseControlService } from "./abuse-control-service";
import { ApiKeyService } from "./api-key-service";
export * from "./audit-integrity";
export * from "./runtime-key-rotation-posture-service";
export * from "./internal-readiness-service";
export * from "./data-connector-sync-coordinator";
export * from "./tenant-scheduled-work-coordinator";
import { AuthProviderSettingsService } from "./auth-provider-settings-service";
import { BrowserAutomationService } from "./browser-automation-service";
import { ChatService } from "./chat-service";
import { lookupNetworkHost } from "./data-connector-network-policy";
import { ChatEventService } from "./chat-event-service";
import { CapabilityService } from "./capability-resolver";
import { createDataConnectorExecutor } from "./data-connector-executor-factory";
import { DelegatedOAuthService } from "./delegated-oauth-service";
import { DirectorySyncService } from "./directory-sync-service";
import { KnowledgeService } from "./knowledge-service";
import { FileService } from "./file-service";
import { ManagedSecretService } from "./managed-secret-service";
import { derivePageCursorSecret } from "./page-cursor";
import { OpenWebUiCompatibilityService } from "./openwebui-compatibility-service";
import { OrganizationCapabilityFlagService } from "./organization-capability-flag-service";
import { createQdrantKnowledgeVectorStore } from "./qdrant-knowledge-vector-store";
import { RunService } from "./run-service";
import { TemporaryChatCleanupWorker } from "./temporary-chat-cleanup-worker";
import {
  canResolveExternalVectorStoreSecret,
  createOidcAuthenticator,
} from "./service-runtime-factories";
import { buildServiceRegistry } from "./service-registry-builder";
import { SessionService } from "./session-service";
import {
  createServiceRuntimeDependencies,
  type ServiceRuntimeDependencies,
} from "./service-runtime-dependencies";
export * from "./service-runtime-dependencies";
import type {
  CreateServicesOptions,
  RomeoServices,
} from "./service-registry-types";
export type {
  CreateServicesOptions,
  RomeoServices,
} from "./service-registry-types";
import { SchemeRoutingSecretResolver } from "./secret-resolver";
import { ToolConnectorService } from "./tool-connector-service";
import { ToolService } from "./tool-service";
import { UserLifecycleService } from "./user-lifecycle-service";
import { WebhookService } from "./webhook-service";
import { WebSearchService } from "./web-search-service";
import { withExternalVectorRoutingActive } from "./vector-store-deployment";

export interface AuthenticationServices {
  apiKeys: ApiKeyService;
  oidc: ReturnType<typeof createOidcAuthenticator>;
  sessions: SessionService;
}

export function createAuthenticationServices(
  repository: RomeoRepository,
  options: CreateServicesOptions,
  runtime: ServiceRuntimeDependencies,
): AuthenticationServices {
  return {
    apiKeys: new ApiKeyService(repository),
    oidc: createOidcAuthenticator(
      repository,
      runtime.env,
      options.oidcFetch,
      runtime.oidcRuntimeCache,
    ),
    sessions: new SessionService(repository),
  };
}

export function createServices(
  repository: RomeoRepository,
  options: CreateServicesOptions = {},
  runtime: ServiceRuntimeDependencies = createServiceRuntimeDependencies(
    options,
  ),
): RomeoServices {
  const env = runtime.env;
  const platformCapabilityPolicy = runtime.capabilityPlatformPolicy;
  const capabilityFlags = new OrganizationCapabilityFlagService(
    repository,
    platformCapabilityPolicy,
  );
  const capabilities = new CapabilityService(
    repository,
    platformCapabilityPolicy,
    capabilityFlags,
  );
  const runEventSequencer = runtime.runEventSequencer;
  const objectStore = runtime.objectStore;
  const quotaCoordinator = runtime.quotaCoordinator;
  const chatEventTransport = runtime.chatEventTransport;
  const vectorStoreDeployment = runtime.vectorStoreDeployment;
  const secretWriter = runtime.secretWriter;
  const managedSecrets = new ManagedSecretService(
    repository,
    env,
    secretWriter,
  );
  const externalSecretResolver = runtime.externalSecretResolver;
  const secretResolver = new SchemeRoutingSecretResolver(
    { "romeo-secret": managedSecrets },
    externalSecretResolver,
  );
  const knowledgeVectorStore = canResolveExternalVectorStoreSecret(env, options)
    ? createQdrantKnowledgeVectorStore(
        env,
        secretResolver,
        undefined,
        runtime.qdrantClientProvider,
      )
    : undefined;
  const activeVectorStoreDeployment =
    knowledgeVectorStore === undefined
      ? vectorStoreDeployment
      : withExternalVectorRoutingActive(vectorStoreDeployment);
  const toolDispatchPayloadStore = runtime.toolDispatchPayloadStore;
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
  const fileMalwareScanner = runtime.fileMalwareScanner;
  const knowledgeExtractor = runtime.knowledgeExtractor;
  const fileOcrProvider = runtime.fileOcrProvider;
  const oidc = createOidcAuthenticator(
    repository,
    env,
    options.oidcFetch,
    runtime.oidcRuntimeCache,
  );
  const voiceProvider = runtime.voiceProvider;
  const sessions = new SessionService(repository);
  const webhookOptions: {
    fetchImpl?: typeof fetch;
    hostLookup?: (
      hostname: string,
    ) => Promise<Array<{ address: string; family: 4 | 6 }>>;
    signingKey: string;
  } = {
    signingKey: env.WEBHOOK_SIGNING_KEY,
    ...(env.WEBHOOK_SIGNING_KEY_PREVIOUS.length === 0
      ? {}
      : { signingKeyPrevious: env.WEBHOOK_SIGNING_KEY_PREVIOUS }),
  };
  if (options.webhookFetch !== undefined) {
    webhookOptions.fetchImpl = options.webhookFetch;
  } else {
    webhookOptions.hostLookup = lookupNetworkHost;
  }
  const webhooks = new WebhookService(repository, webhookOptions);
  const notificationDelivery = runtime.notificationDelivery;
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
    capabilities,
    secretResolver,
    quotaCoordinator,
    webhooks,
    timeoutMs: env.WEB_SEARCH_TIMEOUT_MS,
    ...(options.providerFetch === undefined
      ? {}
      : { fetchImpl: options.providerFetch }),
    hostLookup: lookupNetworkHost,
  });
  const runs = new RunService(
    repository,
    runEventSequencer,
    webhooks,
    options.embeddingFetch,
    objectStore,
    {
      capabilityPlatformPolicy: platformCapabilityPolicy,
      providerCircuitBreaker: runtime.providerCircuitBreaker,
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
        ...(fileMalwareScanner === undefined
          ? {}
          : { scanner: fileMalwareScanner }),
      },
      quotaCoordinator,
      toolOperationExecutionEnabled,
      webRetrieval: (input) => webSearch.retrievalHits(input.subject, input),
    },
  );
  const userCursorSecrets: [string, ...string[]] = [
    derivePageCursorSecret(env.SESSION_SECRET, "admin-users-table"),
  ];
  if (env.SESSION_SECRET_PREVIOUS.length > 0)
    userCursorSecrets.push(
      derivePageCursorSecret(env.SESSION_SECRET_PREVIOUS, "admin-users-table"),
    );
  const users = new UserLifecycleService(repository, {
    cursorSecrets: userCursorSecrets,
  });
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
  const browserAutomation = new BrowserAutomationService(
    repository,
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
      ...(fileMalwareScanner === undefined
        ? {}
        : { scanner: fileMalwareScanner }),
    },
    knowledgeExtractor,
    fileOcrProvider,
  );
  const messagePageCursorSecrets: [string, ...string[]] = [
    derivePageCursorSecret(env.SESSION_SECRET, "chat-message-page"),
  ];
  if (env.SESSION_SECRET_PREVIOUS.length > 0)
    messagePageCursorSecrets.push(
      derivePageCursorSecret(env.SESSION_SECRET_PREVIOUS, "chat-message-page"),
    );
  const messageSearchCursorSecrets: [string, ...string[]] = [
    derivePageCursorSecret(env.SESSION_SECRET, "chat-message-search"),
  ];
  if (env.SESSION_SECRET_PREVIOUS.length > 0)
    messageSearchCursorSecrets.push(
      derivePageCursorSecret(
        env.SESSION_SECRET_PREVIOUS,
        "chat-message-search",
      ),
    );
  const chats = new ChatService(repository, objectStore, {
    messagePageCursorSecrets,
    messageSearchCursorSecrets,
    policy: env.FILE_MALWARE_SCAN_POLICY,
    ...(fileMalwareScanner === undefined
      ? {}
      : { scanner: fileMalwareScanner }),
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
    capabilities,
    capabilityFlags,
    capabilityPlatformPolicy: platformCapabilityPolicy,
    chatEvents,
    chats,
    dataConnectorExecutor,
    delegatedOAuth,
    directorySync,
    env,
    files,
    internalReadiness: runtime.internalReadiness,
    knowledge,
    ...(knowledgeVectorStore === undefined ? {} : { knowledgeVectorStore }),
    managedSecrets,
    notificationDelivery,
    oidcRuntimeCache: runtime.oidcRuntimeCache,
    objectStore,
    oidc,
    openWebUiCompatibility,
    options,
    providerCircuitBreaker: runtime.providerCircuitBreaker,
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
  });
}
