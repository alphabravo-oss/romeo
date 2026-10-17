import { readEnv, type RomeoEnv } from "@romeo/config";
import { ProviderCircuitBreaker } from "@romeo/ai-runtime";
import { disabledObjectStore, type ObjectStore } from "@romeo/storage";
import type { VoiceProvider } from "@romeo/voices";

import {
  capabilityPlatformPolicyFromEnv,
  type CapabilityPlatformPolicy,
} from "./capability-platform-policy";
import type { ChatEventTransport } from "./chat-event-transport";
import type { FileOcrProvider } from "./file-ocr";
import type { FileMalwareScanner } from "./file-service";
import { createDeploymentFileMalwareScanner } from "./file-malware-scanner";
import {
  InternalReadinessService,
  RuntimeReadinessState,
} from "./internal-readiness-service";
import type { KnowledgeBinaryExtractor } from "./knowledge-extraction-worker";
import {
  createNotificationDeliverySender,
  type NotificationDeliveryFactoryOptions,
} from "./notification-delivery-factory";
import type { NotificationDeliverySender } from "./notification-delivery";
import { createOidcRuntimeCache, type OidcRuntimeCache } from "./oidc-client";
import { lookupNetworkHost } from "./outbound-network-policy";
import type { QuotaCoordinator } from "./quota-coordination";
import { BoundedQdrantSdkClientPool } from "./qdrant-sdk-client";
import type { QdrantSdkClientProvider } from "./qdrant-sdk-client";
import { RunEventSequencer } from "./run-event-sequencer";
import type { SecretResolver } from "./secret-resolver";
import type { SecretWriter } from "./secret-writer";
import type { CreateServicesOptions } from "./service-registry-types";
import {
  createChatEventTransport,
  createFileOcrProvider,
  createKnowledgeExtractor,
  createObjectStore,
  createQuotaCoordinator,
  createRunEventTransport,
  createSecretResolver,
  createSecretWriter,
  createToolDispatchPayloadStore,
  createVoiceProvider,
} from "./service-runtime-factories";
import type { ToolDispatchPayloadStore } from "./tool-dispatch-payload-store";
import { withTelemetryObjectStore } from "./telemetry-context";
import {
  vectorStoreDeploymentFromEnv,
  type VectorStoreDeploymentPosture,
} from "./vector-store-deployment";

/**
 * Process-owned dependencies. None may capture a repository, transaction,
 * authenticated subject, tenant ID, or tenant-managed-secret router.
 */
export interface ServiceRuntimeDependencies {
  readonly capabilityPlatformPolicy: CapabilityPlatformPolicy;
  readonly chatEventTransport: ChatEventTransport;
  readonly env: RomeoEnv;
  readonly externalSecretResolver: SecretResolver;
  readonly fileMalwareScanner: FileMalwareScanner | undefined;
  readonly fileOcrProvider: FileOcrProvider;
  readonly internalReadiness: InternalReadinessService;
  readonly knowledgeExtractor: KnowledgeBinaryExtractor;
  readonly notificationDelivery: NotificationDeliverySender;
  readonly oidcRuntimeCache: OidcRuntimeCache;
  readonly objectStore: ObjectStore;
  readonly providerCircuitBreaker: ProviderCircuitBreaker;
  readonly quotaCoordinator: QuotaCoordinator;
  readonly qdrantClientProvider: QdrantSdkClientProvider;
  readonly readinessState: RuntimeReadinessState;
  readonly runEventSequencer: RunEventSequencer;
  readonly secretWriter: SecretWriter;
  readonly toolDispatchPayloadStore: ToolDispatchPayloadStore | undefined;
  readonly vectorStoreDeployment: VectorStoreDeploymentPosture;
  readonly voiceProvider: VoiceProvider;
  close(): void;
}

export function createServiceRuntimeDependencies(
  options: CreateServicesOptions = {},
): ServiceRuntimeDependencies {
  const env = options.env ?? readEnv();
  const baseObjectStore = options.objectStore ?? createObjectStore(env);
  const objectStore =
    baseObjectStore === disabledObjectStore
      ? baseObjectStore
      : withTelemetryObjectStore(baseObjectStore);
  const quotaCoordinator =
    options.quotaCoordinator ?? createQuotaCoordinator(env);
  const providerCircuitBreaker = new ProviderCircuitBreaker({
    cooldownMs: env.MODEL_PROVIDER_CIRCUIT_COOLDOWN_MS,
    failureThreshold: env.MODEL_PROVIDER_CIRCUIT_FAILURE_THRESHOLD,
  });
  const chatEventTransport =
    options.chatEventTransport ?? createChatEventTransport(env);
  const runEventSequencer = new RunEventSequencer(
    options.runEventTransport ?? createRunEventTransport(env),
  );
  const fileOcrProvider = options.fileOcrProvider ?? createFileOcrProvider(env);
  const externalSecretResolver =
    options.secretResolver ?? createSecretResolver(env);
  const notificationDeliveryOptions: NotificationDeliveryFactoryOptions = {
    secretResolver: externalSecretResolver,
    signingKey: env.WEBHOOK_SIGNING_KEY,
    ...(options.notificationFcmClientFactory === undefined
      ? {}
      : { fcmClientFactory: options.notificationFcmClientFactory }),
    ...(options.notificationResendClientFactory === undefined
      ? {}
      : { resendClientFactory: options.notificationResendClientFactory }),
    ...(options.notificationSmtpSendMail === undefined
      ? {}
      : { smtpSendMail: options.notificationSmtpSendMail }),
    // Same egress posture as generic webhooks: resolve, reject private
    // answers, and pin the socket. Tests inject a raw fetch instead.
    ...(options.webhookFetch === undefined
      ? { hostLookup: lookupNetworkHost }
      : { fetchImpl: options.webhookFetch }),
  };
  const readinessState =
    options.runtimeReadinessState ?? new RuntimeReadinessState();
  const oidcRuntimeCache = createOidcRuntimeCache();
  const qdrantClientProvider = new BoundedQdrantSdkClientPool(
    options.qdrantClientFactory,
  );
  const notificationDelivery = createNotificationDeliverySender(
    env,
    notificationDeliveryOptions,
  );
  const internalReadiness = new InternalReadinessService(
    env,
    readinessState,
    objectStore,
    quotaCoordinator,
    options.runtimeDatabaseReadinessProbe === undefined
      ? {}
      : { databaseProbe: options.runtimeDatabaseReadinessProbe },
  );
  let closed = false;
  return {
    capabilityPlatformPolicy: capabilityPlatformPolicyFromEnv(env),
    chatEventTransport,
    env,
    externalSecretResolver,
    fileMalwareScanner:
      options.fileMalwareScanner ?? createDeploymentFileMalwareScanner(env),
    fileOcrProvider,
    internalReadiness,
    knowledgeExtractor:
      options.knowledgeExtractor ??
      createKnowledgeExtractor(env, fileOcrProvider),
    notificationDelivery,
    objectStore,
    oidcRuntimeCache,
    providerCircuitBreaker,
    quotaCoordinator,
    qdrantClientProvider,
    readinessState,
    runEventSequencer,
    secretWriter: options.secretWriter ?? createSecretWriter(env),
    toolDispatchPayloadStore: createToolDispatchPayloadStore(env, objectStore),
    vectorStoreDeployment: vectorStoreDeploymentFromEnv(env),
    voiceProvider: options.voiceProvider ?? createVoiceProvider(env),
    close() {
      if (closed) return;
      closed = true;
      runEventSequencer.close();
      chatEventTransport.close?.();
      notificationDelivery.close?.();
      quotaCoordinator.close?.();
      qdrantClientProvider.close();
      oidcRuntimeCache.discovery.clear();
      oidcRuntimeCache.jwks.clear();
      oidcRuntimeCache.lastJwksRefresh.clear();
    },
  };
}
