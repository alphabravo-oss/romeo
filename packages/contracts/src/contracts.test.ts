import { describe, expect, it } from "vitest";

import { MessageSchema, UpdateChatSchema } from "./chat-schemas";
import { contractOpenApiDocument } from "./document";
import { EnqueueChatTurnSchema, StartRunSchema } from "./runs";
import {
  InterfacePreferencesSchema,
  UpdateInterfacePreferencesSchema,
} from "./interface-preferences";
import { StartDelegatedOAuthSchema } from "./delegated-oauth";
import { CreateDeviceAuthorizationSchema } from "./device-authorizations";
import { EdgeSecurityPostureCheckSchema } from "./edge-security";
import { LocalLoginSchema, LocalMfaVerifySchema } from "./sessions";
import {
  ManagedModelSafetySettingsSchema,
  versionDiffSchema,
} from "./managed-model-schemas";
import { CreateKnowledgeBaseSchema } from "./knowledge-schemas";

describe("Romeo HTTP contracts", () => {
  it("keeps response-side version diff fields forward compatible", () => {
    expect(
      versionDiffSchema.safeParse({
        agentId: "agent_default",
        leftVersionId: "version_1",
        rightVersionId: "version_2",
        changes: [
          { field: "futureManagedModelField", left: null, right: null },
        ],
      }).success,
    ).toBe(true);

    const document = contractOpenApiDocument() as any;
    const fieldSchema =
      document.paths["/api/v1/agents/{agentId}/versions/{versionId}/diff"].get
        .responses["200"].content["application/json"].schema.properties.data
        .properties.changes.items.properties.field;
    expect(fieldSchema).toMatchObject({
      type: "string",
      "x-extensible-enum": expect.arrayContaining([
        "promptSuggestions",
        "tags",
      ]),
    });
    expect(fieldSchema).not.toHaveProperty("enum");
  });

  it("keeps response and mutation schemas strict", () => {
    expect(
      InterfacePreferencesSchema.safeParse({
        theme: "system",
        locale: "en",
        fontSize: "medium",
        density: "comfortable",
        reducedMotion: false,
        uncontracted: true,
      }).success,
    ).toBe(false);
    expect(
      LocalLoginSchema.safeParse({
        email: "user@example.com",
        password: "secret",
        uncontracted: true,
      }).success,
    ).toBe(false);
    expect(
      LocalMfaVerifySchema.safeParse({
        challengeToken: "challenge",
        code: "123456",
        recoveryCode: "rmfa-aaaa-bbbb-cccc-dddd",
      }).success,
    ).toBe(false);
    expect(
      StartDelegatedOAuthSchema.safeParse({
        providerId: "github",
        workspaceId: "workspace_1",
        connectorType: "github",
        uncontracted: true,
      }).success,
    ).toBe(false);
    expect(
      CreateDeviceAuthorizationSchema.safeParse({
        name: "Desktop",
        scopes: ["me:read"],
        uncontracted: true,
      }).success,
    ).toBe(false);
    expect(
      EdgeSecurityPostureCheckSchema.safeParse({
        id: "tls",
        status: "pass",
        severity: "info",
        message: "TLS is configured.",
        details: {},
      }).success,
    ).toBe(true);
    expect(
      EdgeSecurityPostureCheckSchema.safeParse({
        id: "tls",
        status: "pass",
        severity: "info",
        message: "TLS is configured.",
        details: {},
        uncontracted: true,
      }).success,
    ).toBe(false);

    expect(UpdateInterfacePreferencesSchema.safeParse({}).success).toBe(false);
    expect(
      UpdateInterfacePreferencesSchema.safeParse({ theme: "dark" }).success,
    ).toBe(true);
    expect(
      UpdateInterfacePreferencesSchema.safeParse({
        theme: "dark",
        uncontracted: true,
      }).success,
    ).toBe(false);
  });

  it("keeps message-tree fields additive on the chat and run contracts", () => {
    expect(
      MessageSchema.safeParse({
        id: "msg_2",
        chatId: "chat_1",
        role: "assistant",
        content: "Second answer",
        parentId: "msg_1",
        createdAt: "2026-07-16T12:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      UpdateChatSchema.safeParse({ activeLeafMessageId: "msg_2" }).success,
    ).toBe(true);

    // historyBoundaryMessageId keeps working on its own; parentMessageId is additive
    // and accepts null to fork from the chat root.
    expect(
      StartRunSchema.safeParse({
        chatId: "chat_1",
        agentId: "agent_1",
        content: "Retry",
        historyBoundaryMessageId: "msg_1",
      }).success,
    ).toBe(true);
    expect(
      StartRunSchema.safeParse({
        chatId: "chat_1",
        agentId: "agent_1",
        content: "Retry",
        parentMessageId: null,
      }).success,
    ).toBe(true);
    expect(
      EnqueueChatTurnSchema.safeParse({
        agentId: "agent_1",
        content: "Retry",
        parentMessageId: "msg_1",
      }).success,
    ).toBe(false);
    expect(
      StartRunSchema.safeParse({
        chatId: "chat_1",
        agentId: "agent_1",
        content: "Ask from selected collections",
        knowledgeBaseIds: ["kb_1", "kb_2"],
      }).success,
    ).toBe(true);
    expect(
      StartRunSchema.safeParse({
        chatId: "chat_1",
        agentId: "agent_1",
        content: "Ask without knowledge",
        knowledgeBaseIds: [],
      }).success,
    ).toBe(true);
    expect(
      EnqueueChatTurnSchema.safeParse({
        agentId: "agent_1",
        content: "Queued with override",
        knowledgeBaseIds: [],
      }).success,
    ).toBe(true);
    expect(
      CreateKnowledgeBaseSchema.safeParse({
        workspaceId: "workspace_1",
        name: "Private notes",
        scope: "user_private",
      }).success,
    ).toBe(true);
    expect(
      CreateKnowledgeBaseSchema.safeParse({
        workspaceId: "workspace_1",
        name: "Org policy",
        scope: "org",
      }).success,
    ).toBe(true);
    expect(
      CreateKnowledgeBaseSchema.safeParse({
        workspaceId: "workspace_1",
        name: "Bad scope",
        scope: "personal",
      }).success,
    ).toBe(false);
    expect(
      ManagedModelSafetySettingsSchema.safeParse({
        knowledgeGroundingMode: "required",
      }).success,
    ).toBe(true);
    expect(
      ManagedModelSafetySettingsSchema.safeParse({
        knowledgeGroundingMode: "strict",
      }).success,
    ).toBe(false);
  });

  it("emits complete OpenAPI metadata from the route contracts", () => {
    const document = contractOpenApiDocument();

    expect(Object.keys(document.paths ?? {})).toEqual(
      expect.arrayContaining([
        "/api/v1/health",
        "/api/v1/docs",
        "/api/v1/openapi.json",
        "/api/v1/me/interface-preferences",
        "/api/v1/me",
        "/api/v1/sessions",
        "/api/v1/sessions/current",
        "/api/v1/sessions/revoke-others",
        "/api/v1/sessions/{sessionId}",
        "/api/v1/admin/impersonation/sessions",
        "/api/v1/admin/impersonation/sessions/{sessionId}/revoke",
        "/api/v1/admin/impersonation/requests",
        "/api/v1/admin/impersonation/requests/{requestId}/approve",
        "/api/v1/admin/impersonation/requests/{requestId}/reject",
        "/api/v1/auth/local/login",
        "/api/v1/auth/local/mfa/verify",
        "/api/v1/auth/ldap/login",
        "/api/v1/auth/local/status",
        "/api/v1/auth/local/password",
        "/api/v1/auth/local/mfa/totp/enroll",
        "/api/v1/auth/local/mfa/totp/confirm",
        "/api/v1/auth/local/mfa/recovery-codes/generate",
        "/api/v1/auth/local/mfa/factors/{factorId}/disable",
        "/api/v1/auth/oidc/start",
        "/api/v1/auth/oidc/callback",
        "/api/v1/auth/oauth2/start",
        "/api/v1/auth/oauth2/callback",
        "/api/v1/auth/saml/start",
        "/api/v1/auth/saml/callback",
        "/api/v1/auth/saml/metadata",
        "/api/v1/tool-approvals",
        "/api/v1/tool-approvals/{approvalRequestId}/approve",
        "/api/v1/tool-approvals/{approvalRequestId}/cancel",
        "/api/v1/tool-approvals/{approvalRequestId}/reject",
        "/api/v1/tools",
        "/api/v1/tools/{toolId}/execute",
        "/api/v1/tool-calls",
        "/api/v1/agents/{agentId}/tools",
        "/api/v1/agents/{agentId}/tools/{toolId}",
        "/api/v1/tool-connectors",
        "/api/v1/tool-connectors/catalog",
        "/api/v1/tool-connectors/{connectorId}",
        "/api/v1/tools/openapi",
        "/api/v1/tools/webhook",
        "/api/v1/tools/mcp",
        "/api/v1/tool-connectors/{connectorId}/auth",
        "/api/v1/tool-connectors/{connectorId}/auth/check",
        "/api/v1/tool-connectors/{connectorId}/network-policy",
        "/api/v1/tool-connectors/{connectorId}/operations",
        "/api/v1/tool-connectors/{connectorId}/operations/{operationId}",
        "/api/v1/tool-connectors/{connectorId}/operations/{operationId}/test",
        "/api/v1/tool-connectors/{connectorId}/operations/{operationId}/dispatch",
        "/api/v1/tool-connectors/{connectorId}/operations/{operationId}/dispatch-requests",
        "/api/v1/tool-operation-dispatch-requests/claim",
        "/api/v1/tool-operation-dispatch-requests/expire",
        "/api/v1/tool-operation-dispatch-requests/{jobId}/renew-lease",
        "/api/v1/tool-operation-dispatch-requests/{jobId}/payload",
        "/api/v1/tool-operation-dispatch-requests/{jobId}/complete",
        "/api/v1/tool-operation-dispatch-requests/{jobId}/fail",
        "/api/v1/tool-operation-dispatch-requests/{jobId}/cancel",
        "/api/v1/runs/{runId}/tools/{toolId}/execute",
        "/api/v1/admin/edge-security/posture",
        "/api/v1/jobs",
        "/api/v1/jobs/operational-summary",
        "/api/v1/admin/readiness",
        "/api/v1/admin/rag/posture",
        "/api/v1/admin/rag/policy",
        "/api/v1/admin/rag/policy/change-request",
        "/api/v1/admin/rag/policy/change-requests",
        "/api/v1/admin/rag/policy/change-requests/{requestId}/approve",
        "/api/v1/admin/rag/policy/change-requests/{requestId}/reject",
        "/api/v1/admin/auth-providers/catalog",
        "/api/v1/admin/auth-providers/settings",
        "/api/v1/admin/auth-providers/settings/test",
        "/api/v1/admin/secrets",
        "/api/v1/admin/sso/oidc/deprovision",
        "/api/v1/admin/sso-settings",
        "/api/v1/admin/sso-settings/test",
        "/api/v1/admin/secret-rotation/rewrap/preview",
        "/api/v1/admin/secret-rotation/rewrap",
        "/api/v1/governance/retention",
        "/api/v1/governance/data-deletions/preview",
        "/api/v1/governance/data-exports/packages",
        "/api/v1/governance/compliance-report.csv",
        "/api/v1/access-review/report",
        "/api/v1/governance/identity-lifecycle-policy",
        "/api/v1/scim/v2/ServiceProviderConfig",
        "/api/v1/scim/v2/Users",
        "/api/v1/scim/v2/Users/{userId}",
        "/api/v1/scim/v2/Groups",
        "/api/v1/scim/v2/Groups/{groupId}",
        "/api/v1/admin/ga/evidence-posture",
        "/api/v1/admin/postgres/operational-posture",
        "/api/v1/collaboration/channels",
        "/api/v1/collaboration/channels/direct-messages",
        "/api/v1/collaboration/channels/{channelId}",
        "/api/v1/collaboration/channels/{channelId}/events",
        "/api/v1/collaboration/channels/{channelId}/members",
        "/api/v1/collaboration/channels/{channelId}/members/{userId}",
        "/api/v1/collaboration/channels/{channelId}/messages",
        "/api/v1/collaboration/channels/{channelId}/messages/{messageId}",
        "/api/v1/collaboration/channels/{channelId}/messages/{messageId}/thread",
        "/api/v1/collaboration/channels/{channelId}/messages/{messageId}/reactions/{name}",
      ]),
    );
    expect(document.paths?.["/api/v1/health"]?.get).toMatchObject({
      operationId: "system.getHealth",
      tags: ["System"],
      security: [],
    });
    expect(
      document.paths?.["/api/v1/me/interface-preferences"]?.get,
    ).toMatchObject({
      operationId: "interfacePreferences.getCurrent",
      tags: ["Interface Preferences"],
    });
    expect(
      document.paths?.["/api/v1/me/interface-preferences"]?.patch,
    ).toMatchObject({
      operationId: "interfacePreferences.updateCurrent",
      tags: ["Interface Preferences"],
    });
    expect(document.paths?.["/api/v1/me"]?.get).toMatchObject({
      operationId: "identity.getCurrentPrincipal",
      tags: ["Identity"],
    });
    expect(document.paths?.["/api/v1/me"]?.patch).toMatchObject({
      operationId: "identity.updateCurrentProfile",
      tags: ["Identity"],
    });
    expect(document.paths?.["/api/v1/auth/ldap/login"]?.post).toMatchObject({
      operationId: "localAuth.loginLdap",
      tags: ["Local authentication"],
      security: [],
    });
    expect(document.paths?.["/api/v1/auth/local/status"]?.get).toMatchObject({
      operationId: "localAuth.getStatus",
      tags: ["Local authentication"],
    });
    expect(
      document.paths?.["/api/v1/auth/local/mfa/factors/{factorId}/disable"]
        ?.post,
    ).toMatchObject({
      operationId: "localAuth.disableTotpFactor",
      tags: ["Local authentication"],
    });
    expect(document.paths?.["/api/v1/auth/oidc/start"]?.get).toMatchObject({
      operationId: "federatedAuth.startOidcLogin",
      tags: ["Federated authentication"],
      security: [],
    });
    expect(document.paths?.["/api/v1/auth/saml/callback"]?.post).toMatchObject({
      operationId: "federatedAuth.completeSamlLogin",
      tags: ["Federated authentication"],
      security: [],
    });
    expect(document.paths?.["/api/v1/auth/saml/metadata"]?.get).toMatchObject({
      operationId: "federatedAuth.getSamlMetadata",
      tags: ["Federated authentication"],
      security: [],
    });
    expect(document.paths?.["/api/v1/tool-approvals"]?.get).toMatchObject({
      operationId: "toolApprovals.list",
      tags: ["Tool approvals"],
    });
    expect(
      document.paths?.["/api/v1/tool-approvals/{approvalRequestId}/approve"]
        ?.post,
    ).toMatchObject({
      operationId: "toolApprovals.approve",
      tags: ["Tool approvals"],
    });
    expect(document.paths?.["/api/v1/tools"]?.get).toMatchObject({
      operationId: "tools.list",
      tags: ["Tools"],
    });
    expect(
      document.paths?.["/api/v1/tools/{toolId}/execute"]?.post,
    ).toMatchObject({ operationId: "tools.execute", tags: ["Tools"] });
    expect(
      document.paths?.["/api/v1/runs/{runId}/tools/{toolId}/execute"]?.post,
    ).toMatchObject({ operationId: "tools.executeForRun", tags: ["Tools"] });
    expect(
      document.paths?.["/api/v1/agents/{agentId}/tools/{toolId}"]?.patch,
    ).toMatchObject({
      operationId: "tools.updateAgentBinding",
      tags: ["Tools"],
    });
    expect(document.paths?.["/api/v1/tool-connectors"]?.get).toMatchObject({
      operationId: "toolConnectors.list",
      tags: ["Tool connectors"],
    });
    expect(
      document.paths?.["/api/v1/tool-connectors/{connectorId}/auth"]?.patch,
    ).toMatchObject({
      operationId: "toolConnectors.updateAuth",
      tags: ["Tool connectors"],
    });
    expect(
      document.paths?.[
        "/api/v1/tool-connectors/{connectorId}/operations/{operationId}/dispatch"
      ]?.post,
    ).toMatchObject({
      operationId: "toolConnectors.dispatchOperation",
      tags: ["Tool connectors"],
    });
    expect(
      document.paths?.[
        "/api/v1/tool-connectors/{connectorId}/operations/{operationId}/dispatch-requests"
      ]?.post,
    ).toMatchObject({
      operationId: "toolDispatchRequests.enqueue",
      tags: ["Tool dispatch requests"],
    });
    expect(
      document.paths?.[
        "/api/v1/tool-operation-dispatch-requests/{jobId}/complete"
      ]?.post,
    ).toMatchObject({
      operationId: "toolDispatchRequests.complete",
      tags: ["Tool dispatch requests"],
    });
    expect(
      document.paths?.["/api/v1/admin/edge-security/posture"]?.get,
    ).toMatchObject({
      operationId: "edgeSecurity.getPosture",
      tags: ["Edge security"],
    });
    expect(
      document.paths?.["/api/v1/admin/ga/evidence-posture"]?.get,
    ).toMatchObject({
      operationId: "operationalPosture.getGaEvidence",
      tags: ["Operational posture"],
    });
    expect(
      document.paths?.["/api/v1/admin/postgres/operational-posture"]?.get,
    ).toMatchObject({
      operationId: "operationalPosture.getPostgres",
      tags: ["Operational posture"],
    });
    expect(
      document.paths?.["/api/v1/collaboration/channels"]?.get,
    ).toMatchObject({ operationId: "channels.list", tags: ["Channels"] });
    expect(
      document.paths?.["/api/v1/collaboration/channels/{channelId}/events"]
        ?.get,
    ).toMatchObject({
      operationId: "channels.streamEvents",
      tags: ["Channels"],
    });
    expect(
      document.paths?.[
        "/api/v1/collaboration/channels/{channelId}/messages/{messageId}/reactions/{name}"
      ]?.delete,
    ).toMatchObject({
      operationId: "channels.removeReaction",
      tags: ["Channels"],
    });
    expect(
      document.paths?.["/api/v1/admin/browser-automation/posture"]?.get,
    ).toMatchObject({
      operationId: "browserAutomation.getPosture",
      tags: ["Browser Automation"],
    });
    expect(
      document.paths?.[
        "/api/v1/browser-automation-tasks/{jobId}/artifacts/uploads"
      ]?.post,
    ).toMatchObject({
      operationId: "browserAutomation.createArtifactUpload",
      tags: ["Browser Automation"],
    });
    expect(document.paths?.["/api/v1/chat/completions"]?.post).toMatchObject({
      operationId: "openAiCompatibility.createChatCompletion",
      tags: ["OpenAI compatibility"],
    });
    expect(document.paths?.["/api/models/{model}"]?.get).toMatchObject({
      operationId: "openAiCompatibility.retrieveModelAlias",
      tags: ["OpenAI compatibility"],
    });
    expect(document.paths?.["/api/v1/jobs"]?.get).toMatchObject({
      operationId: "jobs.list",
      tags: ["Jobs"],
    });
    expect(
      document.paths?.["/api/v1/jobs/operational-summary"]?.get,
    ).toMatchObject({
      operationId: "jobs.getOperationalSummary",
      tags: ["Jobs"],
    });
    expect(document.paths?.["/api/v1/admin/readiness"]?.get).toMatchObject({
      operationId: "readiness.getReport",
      tags: ["Readiness"],
    });
    expect(document.paths?.["/api/v1/admin/rag/posture"]?.get).toMatchObject({
      operationId: "ragGovernance.getPosture",
      tags: ["RAG governance"],
    });
    expect(document.paths?.["/api/v1/admin/rag/policy"]?.patch).toMatchObject({
      operationId: "ragGovernance.updatePolicy",
      tags: ["RAG governance"],
    });
    expect(
      document.paths?.[
        "/api/v1/admin/rag/policy/change-requests/{requestId}/approve"
      ]?.post,
    ).toMatchObject({
      operationId: "ragGovernance.approvePolicyChangeRequest",
      tags: ["RAG governance"],
    });
    expect(
      document.paths?.["/api/v1/admin/auth-providers/catalog"]?.get,
    ).toMatchObject({
      operationId: "authProviderAdministration.listCatalog",
      tags: ["Authentication provider administration"],
    });
    expect(
      document.paths?.["/api/v1/admin/auth-providers/settings"]?.patch,
    ).toMatchObject({
      operationId: "authProviderAdministration.updateSettings",
      tags: ["Authentication provider administration"],
    });
    expect(document.paths?.["/api/v1/admin/secrets"]?.post).toMatchObject({
      operationId: "authProviderAdministration.createManagedSecret",
      tags: ["Authentication provider administration"],
    });
    expect(document.paths?.["/api/v1/admin/sso-settings"]?.patch).toMatchObject(
      {
        operationId: "ssoAdministration.updateSettings",
        tags: ["SSO administration"],
      },
    );
    expect(
      document.paths?.["/api/v1/admin/secret-rotation/rewrap"]?.post,
    ).toMatchObject({
      operationId: "ssoAdministration.executeSecretRewrap",
      tags: ["SSO administration"],
    });
    expect(
      document.paths?.["/api/v1/governance/data-exports/packages"]?.post,
    ).toMatchObject({
      operationId: "governance.createDataExportPackage",
      tags: ["Governance"],
    });
    expect(document.paths?.["/api/v1/access-review/report"]?.get).toMatchObject(
      {
        operationId: "governance.getAccessReviewReport",
        tags: ["Governance"],
      },
    );
    expect(document.paths?.["/api/v1/scim/v2/Users"]?.post).toMatchObject({
      operationId: "scim.createUser",
      tags: ["SCIM"],
      security: [{ bearerAuth: [] }],
    });
    expect(
      document.paths?.["/api/v1/scim/v2/Groups/{groupId}"]?.patch,
    ).toMatchObject({
      operationId: "scim.patchGroup",
      tags: ["SCIM"],
      security: [{ bearerAuth: [] }],
    });
    expect(document.components?.securitySchemes).toEqual(
      expect.objectContaining({
        bearerAuth: expect.objectContaining({ type: "http" }),
        sessionCookie: expect.objectContaining({ type: "apiKey" }),
      }),
    );
    expect(document.paths?.["/api/v1/docs"]?.get).toMatchObject({
      operationId: "system.getApiDocs",
      tags: ["System"],
      security: [],
    });
    expect(document.paths?.["/api/v1/openapi.json"]?.get).toMatchObject({
      operationId: "system.getOpenApiDocument",
      tags: ["System"],
      security: [],
    });

    for (const pathItem of Object.values(document.paths ?? {})) {
      for (const method of ["delete", "get", "patch", "post", "put"] as const) {
        const operation = pathItem?.[method];
        if (operation === undefined) continue;
        expect(operation.operationId).toEqual(expect.any(String));
        expect(operation.tags).toEqual(expect.any(Array));
        expect(operation.security).toEqual(expect.any(Array));
      }
    }
  });

  it("publishes optional OpenWebUI contracts only when enabled", () => {
    const disabled = contractOpenApiDocument();
    const enabled = contractOpenApiDocument({
      openWebUiCompatibilityEnabled: true,
    });

    expect(disabled.paths?.["/api/v1/openwebui/config"]).toBeUndefined();
    expect(enabled.paths?.["/api/v1/openwebui/config"]?.get).toMatchObject({
      operationId: "openWebUi.getConfig",
      tags: ["OpenWebUI compatibility"],
      security: [],
    });
    expect(enabled.paths?.["/api/v1/auths/"]?.get).toMatchObject({
      operationId: "openWebUi.getSessionUser",
      security: [{ bearerAuth: [] }, { sessionCookie: [] }],
    });
    expect(enabled.paths?.["/api/config"]?.get).toMatchObject({
      operationId: "openWebUi.getConfigAlias",
    });
    expect(enabled.paths?.["/api/v1/chats/"]?.get).toMatchObject({
      operationId: "openWebUi.listChats",
      security: [{ bearerAuth: [] }, { sessionCookie: [] }],
    });
    expect(
      enabled.paths?.["/api/v1/chats/{chatId}/tags"]?.delete,
    ).toMatchObject({ operationId: "openWebUi.deleteChatTag" });
    expect(enabled.paths?.["/api/v1/folders/{folderId}"]?.delete).toMatchObject(
      {
        operationId: "openWebUi.deleteFolder",
      },
    );
    expect(
      enabled.paths?.["/api/v1/collaboration/folders/{folderId}"]?.delete,
    ).toMatchObject({ operationId: "collaboration.deleteFolder" });
    expect(enabled.paths?.["/api/v1/channels/"]?.get).toMatchObject({
      operationId: "openWebUi.listChannels",
    });
    expect(
      enabled.paths?.[
        "/api/v1/channels/{channelId}/messages/{messageId}/reactions/add"
      ]?.post,
    ).toMatchObject({ operationId: "openWebUi.addChannelMessageReaction" });
    expect(
      enabled.paths?.["/api/v1/channels/{channelId}/events"]?.get?.responses?.[
        "200"
      ]?.content,
    ).toHaveProperty("text/event-stream");
  });
});
