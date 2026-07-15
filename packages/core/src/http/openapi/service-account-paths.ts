import {
  arrayEnvelope,
  created,
  errorResponse,
  jsonContent,
  success,
} from "./helpers";

export const serviceAccountPaths = {
  "/service-accounts": {
    get: {
      summary: "List service accounts",
      responses: { 200: arrayEnvelope("Service account"), 403: errorResponse },
    },
    post: {
      summary: "Create a service account",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/CreateServiceAccountRequest",
        }),
      },
      responses: {
        201: created("Service account"),
        400: errorResponse,
        403: errorResponse,
      },
    },
  },
  "/service-accounts/bulk-disable": {
    post: {
      summary:
        "Disable multiple service accounts and invalidate their API keys",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/BulkDisableServiceAccountsRequest",
        }),
      },
      responses: {
        200: success("Service account bulk disable result", {
          $ref: "#/components/schemas/BulkActionResult",
        }),
        400: errorResponse,
        403: errorResponse,
      },
    },
  },
  "/service-accounts/{serviceAccountId}/api-keys": {
    post: {
      summary: "Create a scoped API key for a service account",
      parameters: [
        {
          name: "serviceAccountId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
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
        404: errorResponse,
      },
    },
  },
  "/service-accounts/{serviceAccountId}/disable": {
    post: {
      summary: "Disable a service account and invalidate its API keys",
      parameters: [
        {
          name: "serviceAccountId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: success("Service account"),
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
};
