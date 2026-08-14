import { readEnv } from "@romeo/config";
import { disabledObjectStore } from "@romeo/storage";

import type { RomeoRepository } from "../domain/repository";
import { AbuseControlService } from "./abuse-control-service";
import { AuthProviderSettingsService } from "./auth-provider-settings-service";
import { BrowserAutomationService } from "./browser-automation-service";
import { ChatService } from "./chat-service";
import { lookupNetworkHost } from "./data-connector-network-policy";
import { ChatEventService } from "./chat-event-service";
import { CapabilityService } from "./capability-resolver";
import { capabilityPlatformPolicyFromEnv } from "./capability-platform-policy";
import { createDataConnectorExecutor } from "./data-connector-executor-factory";
import { DelegatedOAuthService } from "./delegated-oauth-service";
import { DirectorySyncService } from "./directory-sync-service";
import { KnowledgeService } from "./knowledge-service";
import { withTelemetryObjectStore } from "./telemetry-context";
import { FileService } from "./file-service";
import { ManagedSecretService } from "./managed-secret-service";
import { derivePageCursorSecret } from "./page-cursor";
import { createNotificationDeliverySender } from "./notification-delivery-factory";
import { OpenWebUiCompatibilityService } from "./openwebui-compatibility-service";
import { OrganizationCapabilityFlagService } from "./organization-capability-flag-service";
import { createQdrantKnowledgeVectorStore } from "./qdrant-knowledge-vector-store";
import { RunEventSequencer } from "./run-event-sequencer";
import { RunService } from "./run-service";
import { TemporaryChatCleanupWorker } from "./temporary-chat-cleanup-worker";
import {
  canResolveExternalVectorStoreSecret,
  createFileOcrProvider,
  createChatEventTransport,
  createKnowledgeExtractor,
  createObjectStore,
  createOidcAuthenticator,
  createQuotaCoordinator,
  createRunEventTransport,
  createSecretResolver,
  createSecretWriter,
  createToolDispatchPayloadStore,
  createVoiceProvider,
} from "./service-runtime-factories";
import { buildServiceRegistry } from "./service-registry-builder";
import { SessionService } from "./session-service";
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
import { WorkflowService } from "./workflow-service";
import { WebSearchService } from "./web-search-service";
import {
  vectorStoreDeploymentFromEnv,
  withExternalVectorRoutingActive,
} from "./vector-store-deployment";

export function createServices(
  repository: RomeoRepository,
  options: CreateServicesOptions = {},
): RomeoServices {
  const env = options.env ?? readEnv();
  const platformCapabilityPolicy = capabilityPlatformPolicyFromEnv(env);
  const capabilityFlags = new OrganizationCapabilityFlagService(
    repository,
    platformCapabilityPolicy,
  );
  const capabilities = new CapabilityService(
    repository,
    platformCapabilityPolicy,
    capabilityFlags,
  );
  const runEventSequencer = new RunEventSequencer(
    options.runEventTransport ?? createRunEventTransport(env),
  );
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
  const webhookOptions: {
    fetchImpl?: typeof fetch;
    hostLookup?: (
      hostname: string,
    ) => Promise<Array<{ address: string; family: 4 | 6 }>>;
    signingKey: string;
  } = {
    signingKey: env.WEBHOOK_SIGNING_KEY,
  };
  if (options.webhookFetch !== undefined) {
    webhookOptions.fetchImpl = options.webhookFetch;
  } else {
    webhookOptions.hostLookup = lookupNetworkHost;
  }
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
