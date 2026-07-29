import { OpenAPIHono } from "@hono/zod-openapi";
import { readEnv } from "@romeo/config";

import type { RomeoRepository } from "./domain/repository";
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
import { registerChatRoutes } from "./http/routes/chats";
import { registerChatExperienceRoutes } from "./http/routes/chat-experience";
import { registerChatTagRoutes } from "./http/routes/chat-tags";
import { registerCollaborationRoutes } from "./http/routes/collaboration";
import { registerCompatibilityRoutes } from "./http/routes/compatibility";
import { registerDataConnectorRoutes } from "./http/routes/data-connectors";
import { registerDelegatedOAuthRoutes } from "./http/routes/delegated-oauth";
import { registerDeviceAuthorizationRoutes } from "./http/routes/device-authorizations";
import { registerEdgeSecurityRoutes } from "./http/routes/edge-security";
import { registerEvalRoutes } from "./http/routes/evals";
import { registerFileRoutes } from "./http/routes/files";
import { registerGaEvidencePostureRoutes } from "./http/routes/ga-evidence-posture";
import { registerGovernanceRoutes } from "./http/routes/governance";
import { registerGroupRoutes } from "./http/routes/groups";
import { registerHealthRoutes } from "./http/routes/health";
import { registerKnowledgeRoutes } from "./http/routes/knowledge";
import { registerJobRoutes } from "./http/routes/jobs";
import { registerImageRoutes } from "./http/routes/images";
import { registerNotificationRoutes } from "./http/routes/notifications";
import { registerOpenApiDocsRoute } from "./http/routes/openapi-docs";
import { registerOpenWebUiRoutes } from "./http/routes/openwebui";
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
import { registerWorkflowRoutes } from "./http/routes/workflows";
import { registerWorkspaceRoutes } from "./http/routes/workspaces";
import { registerWorkspaceContentRoutes } from "./http/routes/workspace-content";
import { registerWebSearchRoutes } from "./http/routes/web-search";
import type { AppBindings } from "./http/context";
import { createServices } from "./services";

export type CreateRomeoApiOptions = NonNullable<
  Parameters<typeof createServices>[1]
> & {
  startBackgroundWorkers?: boolean;
};

export function createRomeoApi(
  repository: RomeoRepository = defaultRepository,
  serviceOptions?: CreateRomeoApiOptions,
) {
  const env = serviceOptions?.env ?? readEnv();
  const services = createServices(repository, { ...serviceOptions, env });
  if (serviceOptions?.startBackgroundWorkers !== false) {
    services.temporaryChatCleanup.start();
    services.runs.startTerminalOutboxWorker();
  }
  const requestContextOptions = { devSeededLogin: env.DEV_SEEDED_LOGIN };
  const app = new OpenAPIHono<AppBindings>({
    defaultHook: (result) => {
      if (!result.success) throw result.error;
    },
  });

  app.use("*", securityHeaders(env));
  app.use("*", requestBodyLimit(env));
  app.use("*", preAuthRateLimit(env));
  app.use("*", csrfProtection(env));
  app.use("*", requestContext(services, requestContextOptions));
  app.use("*", principalRateLimit(env));
  app.onError(errorHandler);

  registerHealthRoutes(app);
  registerAuthRoutes(app);
  registerBootstrapRoutes(app);
  registerAbuseControlRoutes(app);
  registerAdminAnalyticsRoutes(app);
  registerApiKeyRoutes(app);
  registerAuditRoutes(app);
  registerBillingRoutes(app);
  registerBrowserAutomationRoutes(app);
  registerCompatibilityRoutes(app);
  registerProviderRoutes(app);
  registerPreferenceRoutes(app);
  registerPromptTemplateRoutes(app);
  registerAgentRoutes(app);
  registerAgentKnowledgeRoutes(app);
  if (env.OPENWEBUI_COMPATIBILITY_ENABLED) {
    registerOpenWebUiRoutes(app);
  }
  registerPostgresOperationalPostureRoutes(app);
  registerChatRoutes(app);
  registerChatExperienceRoutes(app);
  registerChatTagRoutes(app);
  registerChannelRoutes(app);
  registerCollaborationRoutes(app);
  registerDataConnectorRoutes(app);
  registerDelegatedOAuthRoutes(app);
  registerDeviceAuthorizationRoutes(app);
  registerEdgeSecurityRoutes(app);
  registerEvalRoutes(app);
  registerFileRoutes(app);
  registerGaEvidencePostureRoutes(app);
  registerGovernanceRoutes(app);
  registerGroupRoutes(app);
  registerImageRoutes(app);
  registerJobRoutes(app);
  registerKnowledgeRoutes(app);
  registerNotificationRoutes(app);
  registerOrganizationRoutes(app);
  registerOpenApiDocsRoute(app, {
    openWebUiCompatibilityEnabled: env.OPENWEBUI_COMPATIBILITY_ENABLED,
  });
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
  registerWorkflowRoutes(app);
  registerWebSearchRoutes(app);
  registerWorkspaceContentRoutes(app);
  registerWorkspaceRoutes(app);

  return app;
}

export const romeoApi = createRomeoApi();
