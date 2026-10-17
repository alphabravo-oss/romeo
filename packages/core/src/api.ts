import { OpenAPIHono } from "@hono/zod-openapi";
import { readEnv } from "@romeo/config";

import type { RomeoRepository } from "./domain/repository";
import type { RepositoryRequestScope } from "./domain/repository-request-scope";
import { defaultRepository } from "./repositories/in-memory";
import { csrfProtection } from "./http/csrf-protection";
import { errorHandler } from "./http/errors";
import { preAuthRateLimit, principalRateLimit } from "./http/rate-limit";
import { requestBodyLimit } from "./http/request-body-limit";
import { requestContext } from "./http/request-context";
import { securityHeaders } from "./http/security-headers";
import { registerAbuseControlRoutes } from "./http/routes/abuse-controls";
import { registerAdminAnalyticsRoutes } from "./http/routes/admin-analytics";
import { registerAgentRoutes } from "./http/routes/agents";
import { registerAgentKnowledgeRoutes } from "./http/routes/agent-knowledge";
import { registerApiKeyRoutes } from "./http/routes/api-keys";
import { registerAuditRoutes } from "./http/routes/audit";
import { registerAuthRoutes } from "./http/routes/auth";
import { registerBillingRoutes } from "./http/routes/billing";
import { registerBrowserAutomationRoutes } from "./http/routes/browser-automation";
import { registerBootstrapRoutes } from "./http/routes/bootstrap";
import { registerChannelRoutes } from "./http/routes/channels";
import { registerCapabilityRoutes } from "./http/routes/capabilities";
import { registerEnterpriseSurfaceRoutes } from "./http/routes/enterprise-surfaces";
import { registerComputeArtifactSurfaceRoutes } from "./http/routes/compute-artifact-surfaces";
import { registerTableSurfaceRoutes } from "./http/routes/table-surfaces";
import { registerCapabilityFlagRoutes } from "./http/routes/capability-flags";
import { registerChatRoutes } from "./http/routes/chats";
import { registerChatExperienceRoutes } from "./http/routes/chat-experience";
import { registerChatTagRoutes } from "./http/routes/chat-tags";
import { registerCollaborationRoutes } from "./http/routes/collaboration";
import { registerContentPolicyRoutes } from "./http/routes/content-policy";
import { registerCompatibilityRoutes } from "./http/routes/compatibility";
import { registerDataConnectorRoutes } from "./http/routes/data-connectors";
import { registerDelegatedOAuthRoutes } from "./http/routes/delegated-oauth";
import { registerDeviceAuthorizationRoutes } from "./http/routes/device-authorizations";
import { registerEdgeSecurityRoutes } from "./http/routes/edge-security";
import { registerEvalRoutes } from "./http/routes/evals";
import { registerFileRoutes } from "./http/routes/files";
import { registerGaEvidencePostureRoutes } from "./http/routes/ga-evidence-posture";
import { registerRuntimeKeyRotationPostureRoutes } from "./http/routes/runtime-key-rotation-posture";
import { registerGovernanceRoutes } from "./http/routes/governance";
import { registerGroupRoutes } from "./http/routes/groups";
import { registerHealthRoutes } from "./http/routes/health";
import { registerKnowledgeRoutes } from "./http/routes/knowledge";
import { registerJobRoutes } from "./http/routes/jobs";
import { registerImageRoutes } from "./http/routes/images";
import { registerNotificationRoutes } from "./http/routes/notifications";
import { registerOpenApiDocsRoute } from "./http/routes/openapi-docs";
import { registerOrganizationRoutes } from "./http/routes/organizations";
import { registerPostgresOperationalPostureRoutes } from "./http/routes/postgres-operational-posture";
import { registerProviderRoutes } from "./http/routes/providers";
import { registerPreferenceRoutes } from "./http/routes/preferences";
import { registerPromptTemplateRoutes } from "./http/routes/prompt-templates";
import { registerQuotaRoutes } from "./http/routes/quotas";
import { registerReadinessRoutes } from "./http/routes/readiness";
import { registerRunRoutes } from "./http/routes/runs";
import { registerScimRoutes } from "./http/routes/scim";
import { registerServiceAccountRoutes } from "./http/routes/service-accounts";
import { registerSessionRoutes } from "./http/routes/sessions";
import { registerToolRoutes } from "./http/routes/tools";
import { registerUsageRoutes } from "./http/routes/usage";
import { registerUserRoutes } from "./http/routes/users";
import { registerVoiceRoutes } from "./http/routes/voices";
import { registerWebhookRoutes } from "./http/routes/webhooks";
import { registerWorkerBrokerRoutes } from "./http/routes/worker-broker";
import { registerRetiredWorkflowRoutes } from "./http/routes/retired-workflows";

import { registerWorkspaceRoutes } from "./http/routes/workspaces";
import { registerWorkspaceContentRoutes } from "./http/routes/workspace-content";
import { registerWebSearchRoutes } from "./http/routes/web-search";
import type { AppBindings } from "./http/context";
import {
  apiDeprecationMiddleware,
  apiDeprecationUsageStore,
} from "./http/api-deprecation";
import {
  createAuthenticationServices,
  createServiceRuntimeDependencies,
  createServices,
} from "./services";
import { RuntimeReadinessState } from "./services/internal-readiness-service";
import { DataConnectorSyncCoordinator } from "./services/data-connector-sync-coordinator";
import { createScheduledRuntimeWorkers } from "./services/scheduled-runtime-workers";
import { WorkerBrokerService } from "./services/worker-broker";
import type {
  WorkerBrokerAudience,
  WorkerBrokerCredential,
} from "./services/worker-broker-token";

export type CreateRomeoApiOptions = NonNullable<
  Parameters<typeof createServices>[1]
> & {
  repositoryRequestScope?: RepositoryRequestScope;
  startBackgroundWorkers?: boolean;
};

export function createRomeoApiRuntime(
  repository: RomeoRepository = defaultRepository,
  serviceOptions?: CreateRomeoApiOptions,
) {
  const env = serviceOptions?.env ?? readEnv();
  const { repositoryRequestScope, ...runtimeServiceOptions } =
    serviceOptions ?? {};
  const runtimeReadinessState =
    runtimeServiceOptions.runtimeReadinessState ?? new RuntimeReadinessState();
  const resolvedServiceOptions = {
    ...runtimeServiceOptions,
    env,
    runtimeReadinessState,
  };
  const runtimeDependencies = createServiceRuntimeDependencies(
    resolvedServiceOptions,
  );
  const services = createServices(
    repository,
    resolvedServiceOptions,
    runtimeDependencies,
  );
  // The in-memory development runtime has no database RLS scope, but it still
  // needs the same durable worker topology as PostgreSQL. A pass-through
  // scope preserves the coordinator's tenant leases, fairness, and complete
  // operation inventory without introducing a second ad-hoc scheduler.
  const scheduledRepositoryScope =
    repositoryRequestScope ?? passthroughRepositoryScope(repository);
  const workerBroker =
    repositoryRequestScope === undefined
      ? undefined
      : new WorkerBrokerService(
          repositoryRequestScope,
          (scopedRepository) =>
            createServices(
              scopedRepository,
              resolvedServiceOptions,
              runtimeDependencies,
            ),
          { credentials: workerBrokerCredentials(env) },
        );
  const dataConnectorSyncCoordinator =
    repositoryRequestScope === undefined
      ? undefined
      : new DataConnectorSyncCoordinator(
          repositoryRequestScope,
          (scopedRepository) =>
            createServices(
              scopedRepository,
              resolvedServiceOptions,
              runtimeDependencies,
            ).dataConnectors,
          {
            enabled:
              env.DATA_CONNECTOR_WORKER_ENABLED &&
              env.SCHEDULED_TENANT_WORK_OWNER === "internal",
          },
        );
  const scheduledRuntimeWorkers =
    env.SCHEDULED_TENANT_WORK_OWNER === "external"
      ? undefined
      : createScheduledRuntimeWorkers({
          createServices: (scopedRepository) =>
            createServices(
              scopedRepository,
              resolvedServiceOptions,
              runtimeDependencies,
            ),
          env,
          scope: scheduledRepositoryScope,
        });
  const requestContextOptions = {
    appOriginSecure: new URL(env.APP_ORIGIN).protocol === "https:",
    devSeededLogin: env.DEV_SEEDED_LOGIN,
    production: env.ROMEO_ENV === "production",
    trustedProxy: {
      EDGE_TRUSTED_PROXY_CIDRS: env.EDGE_TRUSTED_PROXY_CIDRS,
      EDGE_TRUSTED_PROXY_HOPS: env.EDGE_TRUSTED_PROXY_HOPS,
      EDGE_TRUSTED_PROXY_MODE: env.EDGE_TRUSTED_PROXY_MODE,
    },
  };
  const app = new OpenAPIHono<AppBindings>({
    defaultHook: (result) => {
      if (!result.success) throw result.error;
    },
  });

  app.use("*", securityHeaders(env));
  app.use("*", apiDeprecationMiddleware({ store: apiDeprecationUsageStore }));
  app.use("*", requestBodyLimit(env));
  app.use("*", preAuthRateLimit(env));
  app.use("*", csrfProtection(env));
  app.use(
    "*",
    requestContext(services, {
      ...requestContextOptions,
      ...(repositoryRequestScope === undefined
        ? {}
        : {
            repositoryRequestScope,
            createScopedAuthenticationServices: (
              scopedRepository: RomeoRepository,
            ) =>
              createAuthenticationServices(
                scopedRepository,
                resolvedServiceOptions,
                runtimeDependencies,
              ),
            createScopedServices: (scopedRepository: RomeoRepository) =>
              createServices(
                scopedRepository,
                resolvedServiceOptions,
                runtimeDependencies,
              ),
          }),
    }),
  );
  app.use("*", principalRateLimit(env));
  app.onError(errorHandler);

  registerHealthRoutes(app);
  registerAuthRoutes(app);
  registerBootstrapRoutes(app);
  registerAbuseControlRoutes(app);
  registerAdminAnalyticsRoutes(app);
  registerApiKeyRoutes(app);
  registerAuditRoutes(app);
  if (env.BILLING_ENABLED) {
    registerBillingRoutes(app);
  }
  registerBrowserAutomationRoutes(app);
  registerCompatibilityRoutes(app);
  registerProviderRoutes(app);
  registerPreferenceRoutes(app);
  registerPromptTemplateRoutes(app);
  registerAgentRoutes(app);
  registerAgentKnowledgeRoutes(app);
  registerPostgresOperationalPostureRoutes(app);
  registerChatRoutes(app);
  registerChatExperienceRoutes(app);
  registerChatTagRoutes(app);
  registerChannelRoutes(app);
  registerCapabilityRoutes(app);
  registerEnterpriseSurfaceRoutes(app);
  registerComputeArtifactSurfaceRoutes(app);
  registerTableSurfaceRoutes(app);
  registerCapabilityFlagRoutes(app);
  registerCollaborationRoutes(app);
  registerContentPolicyRoutes(app);
  registerDataConnectorRoutes(app);
  registerDelegatedOAuthRoutes(app);
  registerDeviceAuthorizationRoutes(app);
  registerEdgeSecurityRoutes(app);
  registerEvalRoutes(app);
  registerFileRoutes(app);
  registerGaEvidencePostureRoutes(app);
  registerRuntimeKeyRotationPostureRoutes(app);
  registerGovernanceRoutes(app);
  registerGroupRoutes(app);
  registerImageRoutes(app);
  registerJobRoutes(app);
  registerKnowledgeRoutes(app);
  registerNotificationRoutes(app);
  registerOrganizationRoutes(app);
  registerOpenApiDocsRoute(app);
  registerQuotaRoutes(app);
  registerReadinessRoutes(app);
  registerRunRoutes(app);
  registerScimRoutes(app);
  registerServiceAccountRoutes(app);
  registerSessionRoutes(app);
  registerToolRoutes(app);
  registerUsageRoutes(app);
  registerUserRoutes(app);
  registerVoiceRoutes(app);
  registerWebhookRoutes(app);
  registerWorkerBrokerRoutes(app, workerBroker);
  registerRetiredWorkflowRoutes(app);

  registerWebSearchRoutes(app);
  registerWorkspaceContentRoutes(app);
  registerWorkspaceRoutes(app);

  let started = false;
  let closed = false;
  let closePromise: Promise<void> | undefined;
  return {
    app,
    dataConnectorSyncCoordinator,
    scheduledRuntimeWorkers,
    services,
    workerBroker,
    start() {
      if (closed) throw new Error("Romeo API runtime is closed.");
      if (started) return;
      started = true;
      scheduledRuntimeWorkers?.start();
      dataConnectorSyncCoordinator?.start();
      runtimeReadinessState.markStarted();
    },
    stop() {
      runtimeReadinessState.markDraining();
      if (!started) return;
      started = false;
      scheduledRuntimeWorkers?.stop();
      dataConnectorSyncCoordinator?.stop();
    },
    async drain() {
      runtimeReadinessState.markDraining();
      await Promise.all([
        services.temporaryChatCleanup.drain(),
        services.runs.drainTerminalOutboxWorker(),
        services.providers.drainCatalogSyncWorker(),
        services.governanceExports.drain(),
        services.tableExports.drain(),
        dataConnectorSyncCoordinator?.drain(),
        scheduledRuntimeWorkers?.drain(),
      ]);
    },
    close() {
      if (closePromise !== undefined) return closePromise;
      runtimeReadinessState.markDraining();
      closed = true;
      if (started) {
        started = false;
        scheduledRuntimeWorkers?.stop();
        dataConnectorSyncCoordinator?.stop();
      }
      closePromise = (async () => {
        try {
          await Promise.all([
            services.temporaryChatCleanup.drain(),
            services.runs.drainTerminalOutboxWorker(),
            services.providers.drainCatalogSyncWorker(),
            services.governanceExports.drain(),
            services.tableExports.drain(),
            dataConnectorSyncCoordinator?.drain(),
            scheduledRuntimeWorkers?.drain(),
          ]);
        } finally {
          runtimeDependencies.close();
        }
      })();
      return closePromise;
    },
  };
}

function passthroughRepositoryScope(
  repository: RomeoRepository,
): RepositoryRequestScope {
  return {
    runAsSystem: (work) => work(repository),
    runAsTenant: (_orgId, work) => work(repository),
  };
}

function workerBrokerCredentials(
  env: ReturnType<typeof readEnv>,
): Partial<Record<WorkerBrokerAudience, WorkerBrokerCredential>> {
  const credentials: Partial<
    Record<WorkerBrokerAudience, WorkerBrokerCredential>
  > = {};
  addWorkerBrokerCredential(credentials, "tool_dispatch", {
    current: env.TOOL_DISPATCH_BROKER_TOKEN,
    previous: env.TOOL_DISPATCH_BROKER_TOKEN_PREVIOUS,
  });
  addWorkerBrokerCredential(credentials, "browser_automation", {
    current: env.BROWSER_AUTOMATION_BROKER_TOKEN,
    previous: env.BROWSER_AUTOMATION_BROKER_TOKEN_PREVIOUS,
  });
  addWorkerBrokerCredential(credentials, "knowledge_extraction", {
    current: env.KNOWLEDGE_EXTRACTION_BROKER_TOKEN,
    previous: env.KNOWLEDGE_EXTRACTION_BROKER_TOKEN_PREVIOUS,
  });
  return credentials;
}

function addWorkerBrokerCredential(
  credentials: Partial<Record<WorkerBrokerAudience, WorkerBrokerCredential>>,
  audience: WorkerBrokerAudience,
  input: { current: string; previous: string },
): void {
  if (input.current.length === 0) return;
  credentials[audience] = {
    current: input.current,
    ...(input.previous.length === 0 ? {} : { previous: input.previous }),
  };
}

export function createRomeoApi(
  repository: RomeoRepository = defaultRepository,
  serviceOptions?: CreateRomeoApiOptions,
) {
  const runtime = createRomeoApiRuntime(repository, serviceOptions);
  if (serviceOptions?.startBackgroundWorkers === true) runtime.start();
  return runtime.app;
}
