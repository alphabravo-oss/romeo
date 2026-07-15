import { errorResponse, jsonContent, success } from "./helpers";

export const tenantAdminPaths = {
  "/admin/organizations": {
    get: {
      summary: "List tenant organizations for global administration",
      responses: {
        200: success("Tenant organizations", {
          type: "array",
          items: { $ref: "#/components/schemas/TenantOrganizationSummary" },
        }),
        403: errorResponse,
      },
    },
    post: {
      summary: "Provision a tenant organization with a default workspace",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/CreateTenantOrganizationRequest",
        }),
      },
      responses: {
        201: success("Tenant organization", {
          $ref: "#/components/schemas/TenantProvisioningResult",
        }),
        400: errorResponse,
        403: errorResponse,
        409: errorResponse,
      },
    },
  },
  "/admin/organizations/{orgId}": {
    get: {
      summary: "Get tenant organization lifecycle posture",
      parameters: [{ $ref: "#/components/parameters/OrgId" }],
      responses: {
        200: success("Tenant organization", {
          $ref: "#/components/schemas/TenantOrganizationSummary",
        }),
        403: errorResponse,
        404: errorResponse,
      },
    },
    patch: {
      summary: "Update tenant organization metadata",
      parameters: [{ $ref: "#/components/parameters/OrgId" }],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/UpdateTenantOrganizationRequest",
        }),
      },
      responses: {
        200: success("Tenant organization", {
          $ref: "#/components/schemas/TenantOrganizationSummary",
        }),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
  },
  "/admin/organizations/{orgId}/suspend": {
    post: {
      summary: "Suspend a tenant organization through abuse controls",
      parameters: [{ $ref: "#/components/parameters/OrgId" }],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/TenantOrganizationReasonRequest",
        }),
      },
      responses: {
        200: success("Tenant organization", {
          $ref: "#/components/schemas/TenantOrganizationSummary",
        }),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/admin/organizations/{orgId}/reactivate": {
    post: {
      summary: "Reactivate a suspended tenant organization",
      parameters: [{ $ref: "#/components/parameters/OrgId" }],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/TenantOrganizationConfirmationRequest",
        }),
      },
      responses: {
        200: success("Tenant organization", {
          $ref: "#/components/schemas/TenantOrganizationSummary",
        }),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/admin/organizations/{orgId}/deletion-request": {
    post: {
      summary: "Request governed tenant deletion and suspend the tenant",
      parameters: [{ $ref: "#/components/parameters/OrgId" }],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/TenantOrganizationReasonRequest",
        }),
      },
      responses: {
        200: success("Tenant organization", {
          $ref: "#/components/schemas/TenantOrganizationSummary",
        }),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/admin/organizations/{orgId}/deletion-request/cancel": {
    post: {
      summary: "Cancel a governed tenant deletion request",
      parameters: [{ $ref: "#/components/parameters/OrgId" }],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/TenantOrganizationConfirmationRequest",
        }),
      },
      responses: {
        200: success("Tenant organization", {
          $ref: "#/components/schemas/TenantOrganizationSummary",
        }),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/admin/organizations/{orgId}/deletion-finalization-preview": {
    get: {
      summary:
        "Preview governed tenant deletion finalization readiness and required evidence",
      parameters: [{ $ref: "#/components/parameters/OrgId" }],
      responses: {
        200: success("Tenant deletion finalization preview", {
          $ref: "#/components/schemas/TenantDeletionFinalizationPreview",
        }),
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/admin/organizations/{orgId}/deletion-finalization-evidence": {
    post: {
      summary:
        "Record reviewed metadata-only tenant deletion finalization evidence",
      parameters: [{ $ref: "#/components/parameters/OrgId" }],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/TenantDeletionFinalizationEvidenceRequest",
        }),
      },
      responses: {
        200: success("Tenant deletion finalization preview", {
          $ref: "#/components/schemas/TenantDeletionFinalizationPreview",
        }),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/admin/organizations/{orgId}/deletion-finalization/execute": {
    post: {
      summary: "Execute final governed tenant deletion after evidence approval",
      parameters: [{ $ref: "#/components/parameters/OrgId" }],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/TenantDeletionFinalizationExecuteRequest",
        }),
      },
      responses: {
        200: success("Tenant physical purge result", {
          $ref: "#/components/schemas/TenantPhysicalPurgeResult",
        }),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
        503: errorResponse,
      },
    },
  },
};
