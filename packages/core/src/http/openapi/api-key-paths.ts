import {
  arrayEnvelope,
  created,
  errorResponse,
  jsonContent,
  success,
} from "./helpers";

export const apiKeyPaths = {
  "/api-keys": {
    get: {
      summary: "List API keys",
      responses: { 200: arrayEnvelope("API key"), 403: errorResponse },
    },
    post: {
      summary: "Create an API key",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/CreateApiKeyRequest",
        }),
      },
      responses: {
        201: created("Created API key"),
        400: errorResponse,
        403: errorResponse,
      },
    },
  },
  "/api-keys/bulk-revoke": {
    post: {
      summary: "Revoke multiple API keys",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/BulkRevokeApiKeysRequest",
        }),
      },
      responses: {
        200: success("API key bulk revoke result", {
          $ref: "#/components/schemas/BulkActionResult",
        }),
        400: errorResponse,
        403: errorResponse,
      },
    },
  },
  "/api-keys/{apiKeyId}/revoke": {
    post: {
      summary: "Revoke an API key",
      parameters: [
        {
          name: "apiKeyId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: success("API key"),
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
};
