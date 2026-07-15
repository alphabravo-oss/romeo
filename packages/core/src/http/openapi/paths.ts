import { auditPaths } from "./audit-paths";
import { authPaths } from "./auth-paths";
import { abuseControlPaths } from "./abuse-control-paths";
import { adminAnalyticsPaths } from "./admin-analytics-paths";
import { apiKeyPaths } from "./api-key-paths";
import { billingPaths } from "./billing-paths";
import { browserAutomationPaths } from "./browser-automation-paths";
import { channelPaths } from "./channel-paths";
import { collaborationPaths } from "./collaboration-paths";
import { compatibilityPaths } from "./compatibility-paths";
import { dataConnectorPaths } from "./data-connector-paths";
import { delegatedOAuthPaths } from "./delegated-oauth-paths";
import { deviceAuthorizationPaths } from "./device-authorization-paths";
import { edgeSecurityPaths } from "./edge-security-paths";
import { evalPaths } from "./eval-paths";
import { filePaths } from "./file-paths";
import { gaEvidencePaths } from "./ga-evidence-paths";
import { groupPaths } from "./group-paths";
import { governancePaths } from "./governance-paths";
import {
  arrayEnvelope,
  dataEnvelope,
  created,
  errorResponse,
  jsonContent,
  success,
} from "./helpers";
import { jobPaths } from "./job-paths";
import { knowledgePaths } from "./knowledge-paths";
import { notificationPaths } from "./notification-paths";
import { openWebUiPaths } from "./openwebui-paths";
import { postgresOperationalPaths } from "./postgres-operational-paths";
import { promptTemplatePaths } from "./prompt-template-paths";
import { providerPaths } from "./provider-paths";
import { quotaPaths } from "./quota-paths";
import { readinessPaths } from "./readiness-paths";
import { scimPaths } from "./scim-paths";
import { serviceAccountPaths } from "./service-account-paths";
import { sessionPaths } from "./session-paths";
import { tenantAdminPaths } from "./tenant-admin-paths";
import { toolPaths } from "./tool-paths";
import { usagePaths } from "./usage-paths";
import { userPaths } from "./user-paths";
import { voicePaths } from "./voice-paths";
import { webhookPaths } from "./webhook-paths";
import { workflowPaths } from "./workflow-paths";
import { workspacePaths } from "./workspace-paths";

export interface OpenApiPathOptions {
  openWebUiCompatibilityEnabled?: boolean;
}

export function openApiPaths(options: OpenApiPathOptions = {}) {
  return mergePathGroups({
    ...authPaths,
    ...abuseControlPaths,
    ...adminAnalyticsPaths,
    ...apiKeyPaths,
    ...serviceAccountPaths,
    ...auditPaths,
    ...billingPaths,
    ...browserAutomationPaths,
    ...channelPaths,
    ...compatibilityPaths,
    ...governancePaths,
    ...mergePathGroups(
      collaborationPaths,
      options.openWebUiCompatibilityEnabled ? openWebUiPaths : {},
    ),
    ...promptTemplatePaths,
    ...dataConnectorPaths,
    ...delegatedOAuthPaths,
    ...deviceAuthorizationPaths,
    ...edgeSecurityPaths,
    ...sessionPaths,
    ...evalPaths,
    ...filePaths,
    ...gaEvidencePaths,
    ...groupPaths,
    ...voicePaths,
    ...usagePaths,
    ...userPaths,
    ...webhookPaths,
    ...quotaPaths,
    ...notificationPaths,
    ...postgresOperationalPaths,
    ...providerPaths,
    ...readinessPaths,
    ...scimPaths,
    ...jobPaths,
    ...tenantAdminPaths,
    ...toolPaths,
    ...workflowPaths,
    ...workspacePaths,
    "/health": {
      get: {
        summary: "Check API readiness",
        responses: {
          200: success("API health status", {
            $ref: "#/components/schemas/HealthStatus",
          }),
        },
      },
    },
    "/docs": {
      get: {
        summary: "Render local OpenAPI documentation",
        responses: {
          200: {
            description: "Self-contained HTML API documentation",
            content: { "text/html": { schema: { type: "string" } } },
          },
        },
      },
    },
    "/me": {
      get: {
        summary: "Get current subject and bootstrap context",
        responses: {
          200: {
            description:
              "Current user bootstrap with server-authoritative deployment posture",
            content: jsonContent({
              $ref: "#/components/schemas/BootstrapResponse",
            }),
          },
          500: errorResponse,
        },
      },
      patch: {
        summary: "Update the current user's email or display name",
        requestBody: {
          required: true,
          content: jsonContent({
            $ref: "#/components/schemas/UpdateMyProfileRequest",
          }),
        },
        responses: {
          200: success("User", { $ref: "#/components/schemas/User" }),
          400: errorResponse,
          403: errorResponse,
          409: errorResponse,
        },
      },
    },
    "/organizations": {
      get: {
        summary: "List organizations visible to the caller",
        responses: {
          200: success("Organizations", {
            type: "array",
            items: { $ref: "#/components/schemas/Organization" },
          }),
          500: errorResponse,
        },
      },
    },
    "/workspaces": {
      get: {
        summary: "List workspaces visible to the caller",
        responses: {
          200: success("Workspaces", {
            type: "array",
            items: { $ref: "#/components/schemas/Workspace" },
          }),
          500: errorResponse,
        },
      },
      post: {
        summary: "Create a workspace",
        requestBody: {
          required: true,
          content: jsonContent({
            $ref: "#/components/schemas/CreateWorkspaceRequest",
          }),
        },
        responses: {
          201: created("Workspace", {
            $ref: "#/components/schemas/Workspace",
          }),
          400: errorResponse,
          403: errorResponse,
          409: errorResponse,
        },
      },
    },
    "/agents": {
      get: {
        summary: "List agents in a workspace",
        parameters: [
          {
            name: "workspaceId",
            in: "query",
            required: false,
            schema: { type: "string" },
          },
        ],
        responses: { 200: arrayEnvelope("Agent"), 403: errorResponse },
      },
      post: {
        summary: "Create an agent",
        requestBody: {
          required: true,
          content: jsonContent({
            $ref: "#/components/schemas/CreateAgentRequest",
          }),
        },
        responses: {
          201: created("Agent"),
          400: errorResponse,
          403: errorResponse,
        },
      },
    },
    "/agents/{agentId}": {
      get: {
        summary: "Get an agent",
        parameters: [{ $ref: "#/components/parameters/AgentId" }],
        responses: {
          200: success("Agent", { $ref: "#/components/schemas/Agent" }),
          403: errorResponse,
          404: errorResponse,
        },
      },
      patch: {
        summary: "Update an agent draft",
        parameters: [{ $ref: "#/components/parameters/AgentId" }],
        requestBody: {
          required: true,
          content: jsonContent({
            $ref: "#/components/schemas/UpdateAgentRequest",
          }),
        },
        responses: {
          200: success("Agent"),
          400: errorResponse,
          403: errorResponse,
          404: errorResponse,
        },
      },
    },
    "/agents/{agentId}/clone": {
      post: {
        summary: "Clone an agent",
        parameters: [{ $ref: "#/components/parameters/AgentId" }],
        requestBody: {
          required: true,
          content: jsonContent({
            $ref: "#/components/schemas/CloneAgentRequest",
          }),
        },
        responses: {
          201: created("Agent"),
          400: errorResponse,
          403: errorResponse,
          404: errorResponse,
        },
      },
    },
    "/agents/{agentId}/export": {
      get: {
        summary: "Export an agent draft as a versioned JSON document",
        parameters: [{ $ref: "#/components/parameters/AgentId" }],
        responses: {
          200: success("Agent export document"),
          403: errorResponse,
          404: errorResponse,
        },
      },
    },
    "/agents/import": {
      post: {
        summary: "Import an agent draft from a versioned JSON document",
        requestBody: {
          required: true,
          content: jsonContent({
            $ref: "#/components/schemas/ImportAgentRequest",
          }),
        },
        responses: {
          201: created("Agent"),
          400: errorResponse,
          403: errorResponse,
          404: errorResponse,
        },
      },
    },
    "/agents/{agentId}/knowledge-bases": {
      get: {
        summary: "List knowledge bases bound to an agent",
        parameters: [{ $ref: "#/components/parameters/AgentId" }],
        responses: {
          200: arrayEnvelope("Agent knowledge binding"),
          403: errorResponse,
          404: errorResponse,
        },
      },
    },
    "/agents/{agentId}/knowledge-bases/{knowledgeBaseId}": {
      patch: {
        summary: "Update an agent knowledge-base binding",
        parameters: [
          { $ref: "#/components/parameters/AgentId" },
          { $ref: "#/components/parameters/KnowledgeBaseId" },
        ],
        requestBody: {
          required: true,
          content: jsonContent({
            $ref: "#/components/schemas/UpdateAgentKnowledgeBindingRequest",
          }),
        },
        responses: {
          200: success("Agent knowledge binding"),
          400: errorResponse,
          403: errorResponse,
          404: errorResponse,
        },
      },
    },
    "/agents/{agentId}/versions": {
      get: {
        summary: "List published agent versions",
        parameters: [{ $ref: "#/components/parameters/AgentId" }],
        responses: {
          200: arrayEnvelope("Agent version"),
          403: errorResponse,
          404: errorResponse,
        },
      },
      post: {
        summary: "Publish the current agent draft",
        parameters: [{ $ref: "#/components/parameters/AgentId" }],
        responses: {
          201: created("Agent version"),
          403: errorResponse,
          404: errorResponse,
          409: errorResponse,
        },
      },
    },
    "/agents/{agentId}/versions/{versionId}/diff": {
      get: {
        summary: "Diff two published agent versions",
        parameters: [
          { $ref: "#/components/parameters/AgentId" },
          { $ref: "#/components/parameters/AgentVersionId" },
          {
            name: "compareTo",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          200: success("Agent version diff"),
          403: errorResponse,
          404: errorResponse,
        },
      },
    },
    "/agents/{agentId}/versions/{versionId}/rollback": {
      post: {
        summary: "Roll an agent back to a published version",
        parameters: [
          { $ref: "#/components/parameters/AgentId" },
          { $ref: "#/components/parameters/AgentVersionId" },
        ],
        responses: {
          200: success("Agent"),
          403: errorResponse,
          404: errorResponse,
        },
      },
    },
    "/chats": {
      get: {
        summary: "List chats in a workspace",
        parameters: [
          {
            name: "workspaceId",
            in: "query",
            required: false,
            schema: { type: "string" },
          },
          {
            name: "archived",
            in: "query",
            required: false,
            schema: {
              type: "string",
              enum: ["active", "archived", "all"],
              default: "active",
            },
          },
        ],
        responses: {
          200: {
            description: "Chats",
            content: jsonContent(
              dataEnvelope({
                type: "array",
                items: { $ref: "#/components/schemas/Chat" },
              }),
            ),
          },
          403: errorResponse,
        },
      },
      post: {
        summary: "Create a chat",
        requestBody: {
          required: true,
          content: jsonContent({
            $ref: "#/components/schemas/CreateChatRequest",
          }),
        },
        responses: {
          201: success("Chat", { $ref: "#/components/schemas/Chat" }),
          400: errorResponse,
          403: errorResponse,
        },
      },
    },
    "/chat-tags": {
      get: {
        summary: "List caller-scoped chat tags",
        description:
          "Returns the current user's chat tags. Tags are user-scoped organizational metadata and are not OpenWebUI compatibility routes.",
        responses: {
          200: {
            description: "Chat tags",
            content: jsonContent(
              dataEnvelope({
                type: "array",
                items: { $ref: "#/components/schemas/ChatTag" },
              }),
            ),
          },
          403: errorResponse,
        },
      },
    },
    "/chat-tags/{tagSlug}/chats": {
      get: {
        summary: "List chats assigned to a caller-scoped tag",
        parameters: [
          {
            name: "tagSlug",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "archived",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["active", "archived", "all"] },
          },
        ],
        responses: {
          200: {
            description: "Tagged chats",
            content: jsonContent(
              dataEnvelope({
                type: "array",
                items: { $ref: "#/components/schemas/Chat" },
              }),
            ),
          },
          403: errorResponse,
        },
      },
    },
    "/chats/{chatId}": {
      get: {
        summary: "Get a chat",
        parameters: [{ $ref: "#/components/parameters/ChatId" }],
        responses: {
          200: success("Chat", { $ref: "#/components/schemas/Chat" }),
          404: errorResponse,
        },
      },
      patch: {
        summary: "Update chat metadata",
        parameters: [{ $ref: "#/components/parameters/ChatId" }],
        requestBody: {
          required: true,
          content: jsonContent({
            $ref: "#/components/schemas/UpdateChatRequest",
          }),
        },
        responses: {
          200: success("Chat", { $ref: "#/components/schemas/Chat" }),
          400: errorResponse,
          403: errorResponse,
          404: errorResponse,
        },
      },
      delete: {
        summary: "Delete a chat through the governed deletion path",
        description:
          "Deletes a writable chat after confirmChatId exactly matches the path chatId. The deletion reuses the governed data-deletion engine, blocks active legal holds, and returns metadata-only deletion counts.",
        parameters: [{ $ref: "#/components/parameters/ChatId" }],
        requestBody: {
          required: true,
          content: jsonContent({
            $ref: "#/components/schemas/DeleteChatRequest",
          }),
        },
        responses: {
          200: success("Data deletion result", {
            $ref: "#/components/schemas/DataDeletionResult",
          }),
          400: errorResponse,
          403: errorResponse,
          404: errorResponse,
          409: errorResponse,
        },
      },
    },
    "/chats/{chatId}/delete-preview": {
      get: {
        summary: "Preview chat deletion counts",
        description:
          "Returns the metadata-only governed deletion plan for a writable chat. This is the product-facing chat lifecycle preview; no message bodies, comments, prompts, titles, or payloads are returned.",
        parameters: [{ $ref: "#/components/parameters/ChatId" }],
        responses: {
          200: success("Data deletion preview", {
            $ref: "#/components/schemas/DataDeletionPreview",
          }),
          403: errorResponse,
          404: errorResponse,
        },
      },
    },
    "/chats/{chatId}/tag-assignments": {
      get: {
        summary: "List caller-scoped tags assigned to a chat",
        parameters: [{ $ref: "#/components/parameters/ChatId" }],
        responses: {
          200: {
            description: "Chat tag assignments",
            content: jsonContent(
              dataEnvelope({
                type: "array",
                items: { $ref: "#/components/schemas/ChatTag" },
              }),
            ),
          },
          403: errorResponse,
          404: errorResponse,
        },
      },
      post: {
        summary: "Assign a caller-scoped tag to a chat",
        description:
          "Creates or reuses a caller-scoped tag and assigns it to a readable chat. Audit metadata stores tag IDs and slug hashes only, not tag names.",
        parameters: [{ $ref: "#/components/parameters/ChatId" }],
        requestBody: {
          required: true,
          content: jsonContent({
            $ref: "#/components/schemas/AssignChatTagRequest",
          }),
        },
        responses: {
          201: {
            description: "Updated chat tag assignments",
            content: jsonContent(
              dataEnvelope({
                type: "array",
                items: { $ref: "#/components/schemas/ChatTag" },
              }),
            ),
          },
          400: errorResponse,
          403: errorResponse,
          404: errorResponse,
        },
      },
    },
    "/chats/{chatId}/tag-assignments/{tagSlug}": {
      delete: {
        summary: "Remove a caller-scoped tag assignment from a chat",
        parameters: [
          { $ref: "#/components/parameters/ChatId" },
          {
            name: "tagSlug",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          200: {
            description: "Updated chat tag assignments",
            content: jsonContent(
              dataEnvelope({
                type: "array",
                items: { $ref: "#/components/schemas/ChatTag" },
              }),
            ),
          },
          403: errorResponse,
          404: errorResponse,
        },
      },
    },
    "/chats/{chatId}/messages": {
      get: {
        summary: "List messages for a chat",
        parameters: [{ $ref: "#/components/parameters/ChatId" }],
        responses: {
          200: {
            description: "Messages",
            content: jsonContent(
              dataEnvelope({
                type: "array",
                items: { $ref: "#/components/schemas/Message" },
              }),
            ),
          },
          404: errorResponse,
        },
      },
    },
    "/chats/{chatId}/messages/{messageId}": {
      delete: {
        summary: "Delete a single chat message",
        description:
          "Deletes one message, and its attachments, from a writable chat. Used to remove the trailing message pair being replaced before a regenerated run is started.",
        parameters: [
          { $ref: "#/components/parameters/ChatId" },
          { $ref: "#/components/parameters/MessageId" },
        ],
        responses: {
          200: success("Message", { $ref: "#/components/schemas/Message" }),
          403: errorResponse,
          404: errorResponse,
          409: errorResponse,
        },
      },
    },
    "/chats/{chatId}/message-feedback": {
      get: {
        summary: "List the caller's assistant-message feedback for a chat",
        description:
          "Returns caller-specific feedback state for assistant messages in the chat. Message content, reviewer identity, raw usage metadata, and free-text feedback are not returned.",
        parameters: [{ $ref: "#/components/parameters/ChatId" }],
        responses: {
          200: {
            description: "Message feedback states",
            content: jsonContent(
              dataEnvelope({
                type: "array",
                items: { $ref: "#/components/schemas/MessageFeedbackState" },
              }),
            ),
          },
          403: errorResponse,
          404: errorResponse,
        },
      },
    },
    "/chats/{chatId}/messages/{messageId}/feedback": {
      get: {
        summary: "Get the caller's feedback for a message",
        description:
          "Returns only the caller's configured rating state and redaction flags. Message content, reviewer identity, raw usage metadata, and free-text feedback are not returned.",
        parameters: [
          { $ref: "#/components/parameters/ChatId" },
          { $ref: "#/components/parameters/MessageId" },
        ],
        responses: {
          200: success("Message feedback state", {
            $ref: "#/components/schemas/MessageFeedbackState",
          }),
          403: errorResponse,
          404: errorResponse,
        },
      },
      post: {
        summary: "Record or clear the caller's feedback for a message",
        description:
          "Records positive or negative feedback for assistant messages, or clears the caller's current feedback with `rating=none`. The API accepts a bounded reason code only; it does not accept free-text feedback.",
        parameters: [
          { $ref: "#/components/parameters/ChatId" },
          { $ref: "#/components/parameters/MessageId" },
        ],
        requestBody: {
          required: true,
          content: jsonContent({
            $ref: "#/components/schemas/UpdateMessageFeedbackRequest",
          }),
        },
        responses: {
          200: success("Message feedback state", {
            $ref: "#/components/schemas/MessageFeedbackState",
          }),
          400: errorResponse,
          403: errorResponse,
          404: errorResponse,
          409: errorResponse,
        },
      },
    },
    "/chats/{chatId}/messages/{messageId}/attachments/{attachmentId}": {
      get: {
        summary: "Read an authorized message image attachment",
        parameters: [
          { $ref: "#/components/parameters/ChatId" },
          {
            name: "messageId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "attachmentId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          200: {
            description: "Message image attachment",
            content: {
              "image/png": { schema: { type: "string", format: "binary" } },
              "image/jpeg": { schema: { type: "string", format: "binary" } },
              "image/gif": { schema: { type: "string", format: "binary" } },
              "image/webp": { schema: { type: "string", format: "binary" } },
            },
          },
          403: errorResponse,
          404: errorResponse,
          409: errorResponse,
        },
      },
    },
    "/chats/{chatId}/archive": {
      post: {
        summary: "Archive a chat",
        parameters: [{ $ref: "#/components/parameters/ChatId" }],
        responses: {
          200: success("Chat", { $ref: "#/components/schemas/Chat" }),
          403: errorResponse,
          404: errorResponse,
        },
      },
    },
    "/chats/{chatId}/fork": {
      post: {
        summary: "Fork a chat history into a new chat",
        description:
          "Creates a new chat in the same workspace and copies source messages through an optional message ID. Runs, comments, approvals, and hidden tool/job payloads are not copied.",
        parameters: [{ $ref: "#/components/parameters/ChatId" }],
        requestBody: {
          required: true,
          content: jsonContent({
            $ref: "#/components/schemas/ForkChatRequest",
          }),
        },
        responses: {
          201: success("Chat", { $ref: "#/components/schemas/Chat" }),
          400: errorResponse,
          403: errorResponse,
          404: errorResponse,
          409: errorResponse,
        },
      },
    },
    "/chats/{chatId}/unarchive": {
      post: {
        summary: "Restore an archived chat",
        parameters: [{ $ref: "#/components/parameters/ChatId" }],
        responses: {
          200: success("Chat", { $ref: "#/components/schemas/Chat" }),
          403: errorResponse,
          404: errorResponse,
          409: errorResponse,
        },
      },
    },
    "/chats/{chatId}/legal-hold": {
      post: {
        summary: "Update or clear a chat legal hold",
        parameters: [{ $ref: "#/components/parameters/ChatId" }],
        requestBody: {
          required: true,
          content: jsonContent({
            $ref: "#/components/schemas/UpdateChatLegalHoldRequest",
          }),
        },
        responses: {
          200: success("Chat", { $ref: "#/components/schemas/Chat" }),
          400: errorResponse,
          403: errorResponse,
          404: errorResponse,
        },
      },
    },
    "/chats/{chatId}/comments": {
      get: {
        summary: "List comments for a chat",
        parameters: [{ $ref: "#/components/parameters/ChatId" }],
        responses: {
          200: {
            description: "Chat comments",
            content: jsonContent(
              dataEnvelope({
                type: "array",
                items: { $ref: "#/components/schemas/ChatComment" },
              }),
            ),
          },
          403: errorResponse,
          404: errorResponse,
        },
      },
      post: {
        summary: "Create a chat comment",
        parameters: [{ $ref: "#/components/parameters/ChatId" }],
        requestBody: {
          required: true,
          content: jsonContent({
            $ref: "#/components/schemas/CreateChatCommentRequest",
          }),
        },
        responses: {
          201: success("Chat comment", {
            $ref: "#/components/schemas/ChatComment",
          }),
          400: errorResponse,
          403: errorResponse,
          404: errorResponse,
        },
      },
    },
    "/runs": {
      post: {
        summary: "Start a streamed chat run",
        requestBody: {
          required: true,
          content: jsonContent({
            $ref: "#/components/schemas/StartRunRequest",
          }),
        },
        responses: {
          202: success("Run", { $ref: "#/components/schemas/RunRecord" }),
          400: errorResponse,
          403: errorResponse,
        },
      },
    },
    "/runs/{runId}": {
      get: {
        summary: "Get run state",
        parameters: [{ $ref: "#/components/parameters/RunId" }],
        responses: {
          200: success("Run", { $ref: "#/components/schemas/RunRecord" }),
          404: errorResponse,
        },
      },
    },
    "/runs/{runId}/events": {
      get: {
        summary: "Stream or replay run events",
        parameters: [{ $ref: "#/components/parameters/RunId" }],
        responses: {
          200: {
            description:
              "SSE stream of run lifecycle events. Each frame uses `event: <RunEvent.type>` and JSON `data` shaped like the RunEvent schema.",
            content: {
              "text/event-stream": {
                schema: {
                  type: "string",
                  description:
                    "Server-sent events carrying metadata-only run event JSON. Tool and dispatch frames omit raw arguments, secrets, provider call IDs, payload object keys, and response bodies.",
                },
                examples: {
                  continuing: {
                    summary: "Tool resume progress frame",
                    value:
                      'event: run.continuing\\ndata: {"id":"evt_run_1_8","runId":"run_1","sequence":8,"type":"run.continuing","data":{"reason":"tool_approval","toolId":"tool_datetime","approvalRequestId":"tool_call_1"},"createdAt":"2026-07-01T00:00:00.000Z"}\\n\\n',
                  },
                },
                "x-romeo-event-schema": {
                  $ref: "#/components/schemas/RunEvent",
                },
                "x-romeo-run-continuing-data-schema": {
                  $ref: "#/components/schemas/RunContinuingEventData",
                },
              },
            },
          },
          404: errorResponse,
        },
      },
    },
    "/runs/{runId}/cancel": {
      post: {
        summary: "Cancel an active run",
        parameters: [{ $ref: "#/components/parameters/RunId" }],
        responses: {
          200: success("Run", { $ref: "#/components/schemas/RunRecord" }),
          404: errorResponse,
        },
      },
    },
    "/runs/{runId}/tools/{toolId}/execute": {
      post: {
        summary: "Execute a model-requested tool call for a run",
        parameters: [
          { $ref: "#/components/parameters/RunId" },
          { $ref: "#/components/parameters/ToolId" },
        ],
        requestBody: {
          required: true,
          content: jsonContent({
            $ref: "#/components/schemas/ExecuteRunToolRequest",
          }),
        },
        responses: {
          200: success("Tool result"),
          400: errorResponse,
          403: errorResponse,
          404: errorResponse,
          409: errorResponse,
        },
      },
    },
    ...knowledgePaths,
  });
}

export const defaultOpenApiPaths = openApiPaths();

function mergePathGroups(...groups: Array<Record<string, unknown>>) {
  const merged: Record<string, unknown> = {};
  for (const group of groups) {
    for (const [path, item] of Object.entries(group)) {
      merged[path] = {
        ...(isPathItem(merged[path]) ? merged[path] : {}),
        ...(isPathItem(item) ? item : {}),
      };
    }
  }
  return merged;
}

function isPathItem(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
