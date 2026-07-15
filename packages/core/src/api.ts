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
import { registerAlertFiringPostureRoutes } from "./http/routes/alert-firing-posture";
import { registerAnalyticsAuthzPostureRoutes } from "./http/routes/analytics-authz-posture";
import { registerApiKeyRoutes } from "./http/routes/api-keys";
import { registerAuditIntegrityPostureRoutes } from "./http/routes/audit-integrity-posture";
import { registerAuditRoutes } from "./http/routes/audit";
import { registerAuthRoutes } from "./http/routes/auth";
import { registerBillingRoutes } from "./http/routes/billing";
import { registerBillingOperationsPostureRoutes } from "./http/routes/billing-operations-posture";
import { registerBrowserAutomationRoutes } from "./http/routes/browser-automation";
import { registerBootstrapRoutes } from "./http/routes/bootstrap";
import { registerChannelRoutes } from "./http/routes/channels";
import { registerChatRoutes } from "./http/routes/chats";
import { registerChatTagRoutes } from "./http/routes/chat-tags";
import { registerCiGovernancePostureRoutes } from "./http/routes/ci-governance-posture";
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
import { registerIdentityLivePostureRoutes } from "./http/routes/identity-live-posture";
import { registerKnowledgeRoutes } from "./http/routes/knowledge";
import { registerKubernetesPostureRoutes } from "./http/routes/kubernetes-posture";
import { registerMigrationDrillPostureRoutes } from "./http/routes/migration-drill-posture";
import { registerJobRoutes } from "./http/routes/jobs";
import { registerNetworkPartitionPostureRoutes } from "./http/routes/network-partition-posture";
import { registerNotificationAdapterLivePostureRoutes } from "./http/routes/notification-adapter-live-posture";
import { registerNotificationRoutes } from "./http/routes/notifications";
import { registerOpenApiDocsRoute } from "./http/routes/openapi-docs";
import { registerOpenWebUiRoutes } from "./http/routes/openwebui";
import { registerOrganizationRoutes } from "./http/routes/organizations";
import { registerPostgresOperationalPostureRoutes } from "./http/routes/postgres-operational-posture";
import { registerProviderRoutes } from "./http/routes/providers";
import { registerProviderOutagePostureRoutes } from "./http/routes/provider-outage-posture";
import { registerPromptTemplateRoutes } from "./http/routes/prompt-templates";
import { registerQuotaRoutes } from "./http/routes/quotas";
import { registerReadinessRoutes } from "./http/routes/readiness";
import { registerReleaseReadbackPostureRoutes } from "./http/routes/release-readback-posture";
import { registerReleaseSecurityPostureRoutes } from "./http/routes/release-security-posture";
import { registerRunRoutes } from "./http/routes/runs";
import { registerScimRoutes } from "./http/routes/scim";
import { registerSecretRotationDrillPostureRoutes } from "./http/routes/secret-rotation-drill-posture";
import { registerServiceAccountRoutes } from "./http/routes/service-accounts";
import { registerSessionRoutes } from "./http/routes/sessions";
import { registerSupportBundlePostureRoutes } from "./http/routes/support-bundle-posture";
import { registerTargetQualityPostureRoutes } from "./http/routes/target-quality-posture";
import { registerTenantPurgeEvidencePostureRoutes } from "./http/routes/tenant-purge-evidence-posture";
import { registerToolDispatchPostureRoutes } from "./http/routes/tool-dispatch-posture";
import { registerToolRoutes } from "./http/routes/tools";
import { registerUsageRoutes } from "./http/routes/usage";
import { registerUserRoutes } from "./http/routes/users";
import { registerVoiceProviderLivePostureRoutes } from "./http/routes/voice-provider-live-posture";
import { registerVoiceRoutes } from "./http/routes/voices";
import { registerWebhookRoutes } from "./http/routes/webhooks";
import { registerWorkflowRoutes } from "./http/routes/workflows";
import { registerWorkspaceRoutes } from "./http/routes/workspaces";
import type { AppBindings } from "./http/context";
import { openApiDocument } from "./http/openapi/document";
import { createServices } from "./services";

export function createRomeoApi(
  repository: RomeoRepository = defaultRepository,
  serviceOptions?: Parameters<typeof createServices>[1],
) {
  const env = serviceOptions?.env ?? readEnv();
  const services = createServices(repository, { ...serviceOptions, env });
  const requestContextOptions = { devSeededLogin: env.DEV_SEEDED_LOGIN };
  const app = new OpenAPIHono<AppBindings>();

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
  registerAnalyticsAuthzPostureRoutes(app);
  registerApiKeyRoutes(app);
  registerAlertFiringPostureRoutes(app);
  registerAuditIntegrityPostureRoutes(app);
  registerAuditRoutes(app);
  registerBillingRoutes(app);
  registerBillingOperationsPostureRoutes(app);
  registerBrowserAutomationRoutes(app);
  registerCompatibilityRoutes(app);
  registerProviderRoutes(app);
  registerProviderOutagePostureRoutes(app);
  registerPromptTemplateRoutes(app);
  registerAgentRoutes(app);
  registerAgentKnowledgeRoutes(app);
  if (env.OPENWEBUI_COMPATIBILITY_ENABLED) {
    registerOpenWebUiRoutes(app);
  }
  registerPostgresOperationalPostureRoutes(app);
  registerCiGovernancePostureRoutes(app);
  registerChatRoutes(app);
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
  registerIdentityLivePostureRoutes(app);
  registerJobRoutes(app);
  registerKnowledgeRoutes(app);
  registerKubernetesPostureRoutes(app);
  registerMigrationDrillPostureRoutes(app);
  registerNetworkPartitionPostureRoutes(app);
  registerNotificationAdapterLivePostureRoutes(app);
  registerNotificationRoutes(app);
  registerOrganizationRoutes(app);
  registerOpenApiDocsRoute(app);
  registerQuotaRoutes(app);
  registerReadinessRoutes(app);
  registerReleaseReadbackPostureRoutes(app);
  registerReleaseSecurityPostureRoutes(app);
  registerRunRoutes(app);
  registerScimRoutes(app);
  registerSecretRotationDrillPostureRoutes(app);
  registerServiceAccountRoutes(app);
  registerSessionRoutes(app);
  registerSupportBundlePostureRoutes(app);
  registerTargetQualityPostureRoutes(app);
  registerTenantPurgeEvidencePostureRoutes(app);
  registerToolDispatchPostureRoutes(app);
  registerToolRoutes(app);
  registerUsageRoutes(app);
  registerUserRoutes(app);
  registerVoiceProviderLivePostureRoutes(app);
  registerVoiceRoutes(app);
  registerWebhookRoutes(app);
  registerWorkflowRoutes(app);
  registerWorkspaceRoutes(app);

  app.get("/api/v1/openapi.json", (context) =>
    context.json(
      openApiDocument({
        openWebUiCompatibilityEnabled: env.OPENWEBUI_COMPATIBILITY_ENABLED,
      }),
    ),
  );

  return app;
}

export const romeoApi = createRomeoApi();
