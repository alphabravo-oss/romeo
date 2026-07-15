import {
  arrayEnvelope,
  created,
  dataEnvelope,
  errorResponse,
  jsonContent,
} from "./helpers";

export const collaborationPaths = {
  "/share-targets": {
    get: {
      summary: "Search same-organization share targets",
      parameters: [
        {
          name: "query",
          in: "query",
          required: false,
          schema: { type: "string" },
        },
        {
          name: "limit",
          in: "query",
          required: false,
          schema: { type: "integer", minimum: 1, maximum: 50 },
        },
      ],
      responses: { 200: arrayEnvelope("Share target"), 403: errorResponse },
    },
  },
  "/agents/{agentId}/shares": {
    get: {
      summary: "List agent resource shares",
      parameters: [{ $ref: "#/components/parameters/AgentId" }],
      responses: {
        200: arrayEnvelope("Resource grant"),
        403: errorResponse,
        404: errorResponse,
      },
    },
    post: {
      summary: "Share an agent through resource grants",
      parameters: [{ $ref: "#/components/parameters/AgentId" }],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/ShareResourceRequest",
        }),
      },
      responses: {
        201: arrayEnvelope("Resource grant"),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/knowledge-bases/{knowledgeBaseId}/shares": {
    get: {
      summary: "List knowledge-base resource shares",
      parameters: [{ $ref: "#/components/parameters/KnowledgeBaseId" }],
      responses: {
        200: arrayEnvelope("Resource grant"),
        403: errorResponse,
        404: errorResponse,
      },
    },
    post: {
      summary: "Share a knowledge base through resource grants",
      parameters: [{ $ref: "#/components/parameters/KnowledgeBaseId" }],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/ShareResourceRequest",
        }),
      },
      responses: {
        201: arrayEnvelope("Resource grant"),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/chats/{chatId}/shares": {
    get: {
      summary: "List chat resource shares",
      parameters: [{ $ref: "#/components/parameters/ChatId" }],
      responses: {
        200: arrayEnvelope("Resource grant"),
        403: errorResponse,
        404: errorResponse,
      },
    },
    post: {
      summary: "Share a chat through resource grants",
      parameters: [{ $ref: "#/components/parameters/ChatId" }],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/ShareResourceRequest",
        }),
      },
      responses: {
        201: arrayEnvelope("Resource grant"),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/files/{fileId}/shares": {
    get: {
      summary: "List file resource shares",
      parameters: [
        {
          name: "fileId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: arrayEnvelope("Resource grant"),
        403: errorResponse,
        404: errorResponse,
      },
    },
    post: {
      summary: "Share a file through resource grants",
      parameters: [
        {
          name: "fileId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/ShareResourceRequest",
        }),
      },
      responses: {
        201: arrayEnvelope("Resource grant"),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/agent-gallery": {
    get: {
      summary: "List discoverable published agents for a workspace",
      parameters: [
        {
          name: "workspaceId",
          in: "query",
          required: false,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: arrayEnvelope("Agent gallery item"),
        403: errorResponse,
      },
    },
  },
  "/favorites": {
    get: {
      summary: "List caller resource favorites",
      responses: {
        200: arrayEnvelope("Resource favorite"),
        403: errorResponse,
      },
    },
    post: {
      summary: "Favorite an agent or knowledge base",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/CreateFavoriteRequest",
        }),
      },
      responses: {
        201: created("Resource favorite"),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/favorites/{favoriteId}": {
    delete: {
      summary: "Delete a resource favorite",
      parameters: [{ $ref: "#/components/parameters/FavoriteId" }],
      responses: {
        200: created("Resource favorite"),
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/folders": {
    get: {
      summary: "List caller-visible workspace folders",
      parameters: [
        {
          name: "workspaceId",
          in: "query",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: {
          description: "Caller-visible workspace folders",
          content: jsonContent(
            dataEnvelope({
              type: "array",
              items: { $ref: "#/components/schemas/WorkspaceFolder" },
            }),
          ),
        },
        403: errorResponse,
      },
    },
    post: {
      summary: "Create a workspace folder",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/CreateFolderRequest",
        }),
      },
      responses: {
        201: {
          description: "Workspace folder",
          content: jsonContent(
            dataEnvelope({
              $ref: "#/components/schemas/WorkspaceFolder",
            }),
          ),
        },
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/folders/{folderId}": {
    get: {
      summary: "Get a workspace folder",
      parameters: [{ $ref: "#/components/parameters/FolderId" }],
      responses: {
        200: {
          description: "Workspace folder",
          content: jsonContent(
            dataEnvelope({
              $ref: "#/components/schemas/WorkspaceFolder",
            }),
          ),
        },
        403: errorResponse,
        404: errorResponse,
      },
    },
    patch: {
      summary: "Update a workspace folder",
      description:
        "Renames, moves, expands/collapses, or updates metadata for a caller-writable folder. Parent changes are cycle-checked and folder names remain unique per workspace.",
      parameters: [{ $ref: "#/components/parameters/FolderId" }],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/UpdateFolderRequest",
        }),
      },
      responses: {
        200: {
          description: "Workspace folder",
          content: jsonContent(
            dataEnvelope({
              $ref: "#/components/schemas/WorkspaceFolder",
            }),
          ),
        },
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
    delete: {
      summary: "Delete a workspace folder",
      description:
        "Deletes the folder and its folder-item associations. Child folders are moved to the workspace root; underlying chats, agents, and knowledge bases are not deleted.",
      parameters: [{ $ref: "#/components/parameters/FolderId" }],
      responses: {
        200: {
          description: "Deleted workspace folder",
          content: jsonContent(
            dataEnvelope({
              $ref: "#/components/schemas/WorkspaceFolder",
            }),
          ),
        },
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/folders/{folderId}/shares": {
    get: {
      summary: "List folder resource shares",
      parameters: [{ $ref: "#/components/parameters/FolderId" }],
      responses: {
        200: arrayEnvelope("Resource grant"),
        403: errorResponse,
        404: errorResponse,
      },
    },
    post: {
      summary: "Share a folder through resource grants",
      parameters: [{ $ref: "#/components/parameters/FolderId" }],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/ShareResourceRequest",
        }),
      },
      responses: {
        201: arrayEnvelope("Resource grant"),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/folders/{folderId}/items": {
    get: {
      summary: "List visible items in a workspace folder",
      parameters: [{ $ref: "#/components/parameters/FolderId" }],
      responses: {
        200: arrayEnvelope("Workspace folder item"),
        403: errorResponse,
        404: errorResponse,
      },
    },
    post: {
      summary: "Add an accessible resource to a workspace folder",
      parameters: [{ $ref: "#/components/parameters/FolderId" }],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/CreateFolderItemRequest",
        }),
      },
      responses: {
        201: created("Workspace folder item"),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/folders/{folderId}/items/{itemId}": {
    delete: {
      summary: "Remove an item from a workspace folder",
      parameters: [
        { $ref: "#/components/parameters/FolderId" },
        { $ref: "#/components/parameters/FolderItemId" },
      ],
      responses: {
        200: created("Workspace folder item"),
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
};
