import { OpenAPIHono, type RouteConfig } from "@hono/zod-openapi";

import { securitySchemes } from "./common";
import { administrationRoutes } from "./administration-routes";
import { authProviderAdministrationRoutes } from "./auth-provider-administration";
import { adminInsightsRoutes } from "./admin-insights";
import { billingRoutes } from "./billing";
import { browserAutomationRoutes } from "./browser-automation";
import { chatRoutes } from "./chats";
import { chatExperienceRoutes } from "./chat-experience";
import { channelRoutes } from "./channels";
import { capabilityRoutes } from "./capabilities";
import { capabilityPublicationRoutes } from "./capabilities-publication";
import { capabilityFlagRoutes } from "./capability-flags";
import { collaborationRoutes } from "./collaboration-routes";
import { contentPolicyRoutes } from "./content-policy";
import { contentPolicyLifecycleRoutes } from "./content-policy-lifecycle";
import { dataConnectorRoutes } from "./data-connectors";
import { delegatedOAuthRoutes } from "./delegated-oauth";
import { deviceAuthorizationRoutes } from "./device-authorizations";
import { edgeSecurityRoutes } from "./edge-security";
import { enterpriseSurfaceRoutes } from "./enterprise-surfaces";
import { enterpriseLifecycleSurfaceRoutes } from "./enterprise-lifecycle-surfaces";
import { computeArtifactSurfaceRoutes } from "./compute-artifact-surfaces";
import { tableSurfaceRoutes } from "./table-surfaces";
import { evalRoutes } from "./evals";
import { fileRoutes } from "./files";
import { governanceRoutes } from "./governance";
import { knowledgeRoutes } from "./knowledge";
import { imageRoutes } from "./images";
import { jobRoutes } from "./jobs";
import { localAuthRoutes } from "./local-auth";
import { federatedAuthRoutes } from "./federated-auth";
import { toolApprovalRoutes } from "./tool-approvals";
import { toolCatalogRoutes } from "./tool-catalog";
import { toolConnectorRoutes } from "./tool-connectors";
import { toolDispatchRequestRoutes } from "./tool-dispatch-requests";
import {
  getInterfacePreferencesRoute,
  updateInterfacePreferencesRoute,
} from "./interface-preferences";
import { getHealthRoute } from "./system";
import { tenancyRoutes } from "./tenancy";
import { tenantAdministrationRoutes } from "./tenant-administration";
import {
  approveSupportSessionRequestRoute,
  createSessionRoute,
  createSupportSessionRequestRoute,
  createSupportSessionRoute,
  listSessionsRoute,
  listSupportSessionRequestsRoute,
  listSupportSessionsRoute,
  localLoginRoute,
  rejectSupportSessionRequestRoute,
  revokeCurrentSessionRoute,
  revokeOtherSessionsRoute,
  revokeSessionRoute,
  revokeSupportSessionRoute,
  verifyLocalMfaRoute,
} from "./sessions";
import {
  getCurrentPrincipalRoute,
  updateCurrentProfileRoute,
} from "./identity";
import { managedModelRoutes } from "./managed-models";
import { notificationRoutes } from "./notifications";
import { openAiCompatibilityRoutes } from "./openai-compatibility";
import { openApiRoutes } from "./openapi";
import { openWebUiChatRoutes } from "./openwebui-chats";
import { openWebUiChannelRoutes } from "./openwebui-channels";
import { openWebUiSystemRoutes } from "./openwebui-system";
import { operationalGovernanceRoutes } from "./operational-governance";
import { operationalPostureRoutes } from "./operational-posture";
import { providerCapabilityReportRoutes } from "./provider-capability-reports";
import { providerKindCatalogRoutes } from "./provider-kind-catalog";
import { providerRoutes } from "./providers";
import { modelCapabilityProbeRoutes } from "./model-capability-probe";
import { promptRoutes } from "./prompts";
import { ragGovernanceRoutes } from "./rag-governance";
import { readinessRoutes } from "./readiness";
import { runRoutes } from "./runs";
import { ssoAdministrationRoutes } from "./sso-administration";
import { scimRoutes } from "./scim";
import { webRoutes } from "./web";
import { webhookRoutes } from "./webhooks";
import { voiceRoutes } from "./voices";
import { workflowRoutes } from "./workflows";
import { workspaceContentRoutes } from "./workspace-content";
import { ROMEO_PRODUCT_VERSION } from "./version";
import { applyApiDeprecationsToOpenApiDocument } from "./api-deprecations";

export const contractRoutes = [
  ...administrationRoutes,
  ...authProviderAdministrationRoutes,
  ...adminInsightsRoutes,
  ...billingRoutes,
  ...browserAutomationRoutes,
  ...tenancyRoutes,
  ...tenantAdministrationRoutes,
  getHealthRoute,
  getInterfacePreferencesRoute,
  updateInterfacePreferencesRoute,
  getCurrentPrincipalRoute,
  updateCurrentProfileRoute,
  listSessionsRoute,
  createSessionRoute,
  revokeCurrentSessionRoute,
  revokeOtherSessionsRoute,
  revokeSessionRoute,
  listSupportSessionsRoute,
  createSupportSessionRoute,
  revokeSupportSessionRoute,
  listSupportSessionRequestsRoute,
  createSupportSessionRequestRoute,
  approveSupportSessionRequestRoute,
  rejectSupportSessionRequestRoute,
  localLoginRoute,
  verifyLocalMfaRoute,
  ...managedModelRoutes,
  ...notificationRoutes,
  ...openAiCompatibilityRoutes,
  ...openApiRoutes,
  ...operationalGovernanceRoutes,
  ...operationalPostureRoutes,
  ...providerCapabilityReportRoutes,
  ...providerKindCatalogRoutes,
  ...providerRoutes,
  ...modelCapabilityProbeRoutes,
  ...promptRoutes,
  ...ragGovernanceRoutes,
  ...readinessRoutes,
  ...runRoutes,
  ...ssoAdministrationRoutes,
  ...scimRoutes,
  ...chatRoutes,
  ...chatExperienceRoutes,
  ...channelRoutes,
  ...capabilityRoutes,
  ...capabilityPublicationRoutes,
  ...capabilityFlagRoutes,
  ...collaborationRoutes,
  ...contentPolicyRoutes,
  ...contentPolicyLifecycleRoutes,
  ...dataConnectorRoutes,
  ...delegatedOAuthRoutes,
  ...deviceAuthorizationRoutes,
  ...edgeSecurityRoutes,
  ...enterpriseSurfaceRoutes,
  ...enterpriseLifecycleSurfaceRoutes,
  ...computeArtifactSurfaceRoutes,
  ...tableSurfaceRoutes,
  ...evalRoutes,
  ...fileRoutes,
  ...governanceRoutes,
  ...knowledgeRoutes,
  ...imageRoutes,
  ...jobRoutes,
  ...localAuthRoutes,
  ...federatedAuthRoutes,
  ...toolApprovalRoutes,
  ...toolCatalogRoutes,
  ...toolConnectorRoutes,
  ...toolDispatchRequestRoutes,
  ...webRoutes,
  ...webhookRoutes,
  ...voiceRoutes,
  ...workflowRoutes,
  ...workspaceContentRoutes,
] as const;

export interface ContractOpenApiDocumentOptions {
  openWebUiCompatibilityEnabled?: boolean;
}

export function contractOpenApiDocument(
  options: ContractOpenApiDocumentOptions = {},
) {
  const registry = new OpenAPIHono();
  for (const [name, schema] of Object.entries(securitySchemes)) {
    registry.openAPIRegistry.registerComponent("securitySchemes", name, schema);
  }
  const registeredOperations = new Set<string>();
  const registerRoute = (route: RouteConfig): void => {
    const operation = `${route.method.toUpperCase()} ${route.path}`;
    if (registeredOperations.has(operation)) {
      throw new Error(`Duplicate HTTP contract operation: ${operation}`);
    }
    registeredOperations.add(operation);
    registry.openAPIRegistry.registerPath(route as RouteConfig);
  };
  for (const route of contractRoutes) {
    registerRoute(route as RouteConfig);
  }
  if (options.openWebUiCompatibilityEnabled) {
    for (const route of [
      ...openWebUiSystemRoutes,
      ...openWebUiChatRoutes,
      ...openWebUiChannelRoutes,
    ]) {
      registerRoute(route as RouteConfig);
    }
  }
  const document = registry.getOpenAPI31Document({
    openapi: "3.1.0",
    info: {
      title: "Romeo API Contracts",
      version: ROMEO_PRODUCT_VERSION,
    },
  });
  applyApiDeprecationsToOpenApiDocument(
    document as unknown as Record<string, unknown>,
  );
  return document;
}
