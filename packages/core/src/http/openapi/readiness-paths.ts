import { errorResponse, jsonContent, success } from "./helpers";

export const readinessPaths = {
  "/admin/readiness": {
    get: {
      summary: "Get production readiness checks",
      responses: {
        200: success("Production readiness report", {
          $ref: "#/components/schemas/ReadinessReport",
        }),
        403: errorResponse,
      },
    },
  },
  "/admin/rag/posture": {
    get: {
      summary: "Get sanitized RAG and vector posture",
      responses: {
        200: success("RAG posture report", {
          $ref: "#/components/schemas/RagPostureReport",
        }),
        403: errorResponse,
      },
    },
  },
  "/admin/rag/policy": {
    get: {
      summary: "Get org RAG policy",
      responses: {
        200: success("RAG policy", {
          $ref: "#/components/schemas/RagPolicyReport",
        }),
        403: errorResponse,
      },
    },
    patch: {
      summary: "Update org RAG policy",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/UpdateRagPolicyRequest",
        }),
      },
      responses: {
        200: success("RAG policy", {
          $ref: "#/components/schemas/RagPolicyReport",
        }),
        400: errorResponse,
        403: errorResponse,
      },
    },
  },
  "/admin/rag/policy/change-request": {
    get: {
      summary: "Get the latest org RAG policy change request",
      responses: {
        200: success("Latest RAG policy change request", {
          oneOf: [
            { $ref: "#/components/schemas/RagPolicyChangeRequest" },
            { type: "null" },
          ],
        }),
        403: errorResponse,
      },
    },
  },
  "/admin/rag/policy/change-requests": {
    post: {
      summary: "Create a governed org RAG policy change request",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/CreateRagPolicyChangeRequest",
        }),
      },
      responses: {
        201: success("RAG policy change request", {
          $ref: "#/components/schemas/RagPolicyChangeRequest",
        }),
        400: errorResponse,
        403: errorResponse,
        409: errorResponse,
      },
    },
  },
  "/admin/rag/policy/change-requests/{requestId}/approve": {
    post: {
      summary: "Approve and apply a governed org RAG policy change request",
      parameters: [
        {
          name: "requestId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/ReviewRagPolicyChangeRequest",
        }),
      },
      responses: {
        200: success("Approved RAG policy change request", {
          $ref: "#/components/schemas/RagPolicyChangeRequest",
        }),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
  },
  "/admin/rag/policy/change-requests/{requestId}/reject": {
    post: {
      summary: "Reject a governed org RAG policy change request",
      parameters: [
        {
          name: "requestId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/ReviewRagPolicyChangeRequest",
        }),
      },
      responses: {
        200: success("Rejected RAG policy change request", {
          $ref: "#/components/schemas/RagPolicyChangeRequest",
        }),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
  },
  "/admin/sso-settings": {
    get: {
      summary: "Get sanitized SSO settings",
      responses: {
        200: success("Sanitized SSO settings", {
          $ref: "#/components/schemas/SsoSettingsReport",
        }),
        403: errorResponse,
      },
    },
    patch: {
      summary: "Update sanitized SSO settings",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/UpdateSsoSettingsRequest",
        }),
      },
      responses: {
        200: success("Sanitized SSO settings", {
          $ref: "#/components/schemas/SsoSettingsReport",
        }),
        400: errorResponse,
        403: errorResponse,
      },
    },
  },
  "/admin/auth-providers/catalog": {
    get: {
      summary: "List enterprise authentication provider catalog entries",
      responses: {
        200: success("Authentication provider catalog", {
          type: "array",
          items: { $ref: "#/components/schemas/AuthProviderCatalogEntry" },
        }),
        403: errorResponse,
      },
    },
  },
  "/admin/auth-providers/settings": {
    get: {
      summary: "Get sanitized global and org authentication provider settings",
      responses: {
        200: success("Authentication provider settings", {
          $ref: "#/components/schemas/AuthProviderSettingsReport",
        }),
        403: errorResponse,
      },
    },
    patch: {
      summary: "Update global or org authentication provider settings",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/UpdateAuthProviderSettingsRequest",
        }),
      },
      responses: {
        200: success("Authentication provider settings", {
          $ref: "#/components/schemas/AuthProviderSettingsReport",
        }),
        400: errorResponse,
        403: errorResponse,
      },
    },
  },
  "/admin/auth-providers/settings/test": {
    post: {
      summary:
        "Test an authentication provider connection without exposing secrets",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/TestAuthProviderConnectionRequest",
        }),
      },
      responses: {
        200: success("Authentication provider connection test", {
          $ref: "#/components/schemas/AuthProviderConnectionTestReport",
        }),
        400: errorResponse,
        403: errorResponse,
      },
    },
  },
  "/admin/secrets": {
    post: {
      summary: "Store a managed secret and return a one-time ref",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/CreateManagedSecretRequest",
        }),
      },
      responses: {
        201: success("Managed secret reference", {
          $ref: "#/components/schemas/ManagedSecretReference",
        }),
        400: errorResponse,
        403: errorResponse,
        409: errorResponse,
      },
    },
  },
  "/admin/secret-rotation/rewrap/preview": {
    post: {
      summary:
        "Preview encrypted local MFA and managed-secret envelope rewrap readiness",
      requestBody: {
        required: false,
        content: jsonContent({
          $ref: "#/components/schemas/SecretRewrapPreviewRequest",
        }),
      },
      responses: {
        200: success("Secret rewrap preview", {
          $ref: "#/components/schemas/SecretRewrapReport",
        }),
        403: errorResponse,
      },
    },
  },
  "/admin/secret-rotation/rewrap": {
    post: {
      summary:
        "Rewrap encrypted local MFA and managed-secret envelopes with the active key",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/SecretRewrapExecuteRequest",
        }),
      },
      responses: {
        200: success("Secret rewrap report", {
          $ref: "#/components/schemas/SecretRewrapReport",
        }),
        400: errorResponse,
        403: errorResponse,
      },
    },
  },
  "/admin/sso-settings/test": {
    post: {
      summary: "Test sanitized OIDC discovery and JWKS reachability",
      responses: {
        200: success("Sanitized SSO connection test", {
          $ref: "#/components/schemas/SsoConnectionTestReport",
        }),
        403: errorResponse,
      },
    },
  },
  "/admin/sso/oidc/deprovision": {
    post: {
      summary: "Disable a user mapped from the active OIDC issuer and subject",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/DeprovisionSsoOidcUserRequest",
        }),
      },
      responses: {
        200: success("OIDC deprovisioning result", {
          $ref: "#/components/schemas/SsoOidcDeprovisionResult",
        }),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
};
