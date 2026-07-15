import {
  arrayEnvelope,
  created,
  errorResponse,
  jsonContent,
  success,
} from "./helpers";

export const promptTemplatePaths = {
  "/prompt-templates": {
    get: {
      summary: "List visible prompt templates",
      parameters: [
        {
          name: "workspaceId",
          in: "query",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "query",
          in: "query",
          required: false,
          schema: { type: "string" },
        },
      ],
      responses: { 200: arrayEnvelope("Prompt template"), 403: errorResponse },
    },
    post: {
      summary: "Create a prompt template",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/CreatePromptTemplateRequest",
        }),
      },
      responses: {
        201: created("Prompt template"),
        400: errorResponse,
        403: errorResponse,
      },
    },
  },
  "/prompt-marketplace": {
    get: {
      summary: "List visible marketplace prompt templates",
      parameters: [
        {
          name: "workspaceId",
          in: "query",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "query",
          in: "query",
          required: false,
          schema: { type: "string" },
        },
      ],
      responses: { 200: arrayEnvelope("Prompt template"), 403: errorResponse },
    },
  },
  "/prompt-templates/{promptTemplateId}": {
    get: {
      summary: "Get a prompt template",
      parameters: [{ $ref: "#/components/parameters/PromptTemplateId" }],
      responses: {
        200: created("Prompt template"),
        403: errorResponse,
        404: errorResponse,
      },
    },
    patch: {
      summary: "Update a prompt template",
      parameters: [{ $ref: "#/components/parameters/PromptTemplateId" }],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/UpdatePromptTemplateRequest",
        }),
      },
      responses: {
        200: created("Prompt template"),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
    delete: {
      summary: "Delete a prompt template",
      parameters: [{ $ref: "#/components/parameters/PromptTemplateId" }],
      responses: {
        200: success("Prompt template"),
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/prompt-templates/{promptTemplateId}/shares": {
    get: {
      summary: "List prompt-template resource shares",
      parameters: [{ $ref: "#/components/parameters/PromptTemplateId" }],
      responses: {
        200: arrayEnvelope("Resource grant"),
        403: errorResponse,
        404: errorResponse,
      },
    },
    post: {
      summary: "Share a prompt template through resource grants",
      parameters: [{ $ref: "#/components/parameters/PromptTemplateId" }],
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
};
