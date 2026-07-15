import { arrayEnvelope, errorResponse, jsonContent, success } from "./helpers";

export const governancePaths = {
  "/audit-logs.csv": {
    get: {
      summary: "Export filtered audit logs as CSV",
      parameters: auditFilterParameters(),
      responses: {
        200: {
          description: "Audit log CSV",
          content: { "text/csv": { schema: { type: "string" } } },
        },
        403: errorResponse,
      },
    },
  },
  "/governance/retention": {
    get: {
      summary: "Get governance retention policy",
      responses: {
        200: success("Retention policy", {
          $ref: "#/components/schemas/RetentionPolicy",
        }),
        403: errorResponse,
      },
    },
    patch: {
      summary: "Update governance retention policy",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/UpdateRetentionPolicyRequest",
        }),
      },
      responses: {
        200: success("Retention policy", {
          $ref: "#/components/schemas/RetentionPolicy",
        }),
        400: errorResponse,
        403: errorResponse,
      },
    },
  },
  "/governance/retention/enforce": {
    post: {
      summary:
        "Enforce audit-log and browser automation artifact retention for the current organization",
      responses: {
        200: success("Retention enforcement result", {
          $ref: "#/components/schemas/RetentionEnforcementResult",
        }),
        403: errorResponse,
      },
    },
  },
  "/governance/data-deletions/preview": {
    post: {
      summary: "Preview a governed data deletion workflow",
      requestBody: {
        required: true,
        content: jsonContent({
          type: "object",
          properties: {
            resourceType: {
              type: "string",
              enum: ["chat", "file_object", "knowledge_source"],
            },
            resourceId: { type: "string" },
          },
        }),
      },
      responses: {
        200: success("Data deletion preview", {
          $ref: "#/components/schemas/DataDeletionPreview",
        }),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/governance/data-deletions/execute": {
    post: {
      summary: "Execute a governed data deletion workflow",
      requestBody: {
        required: true,
        content: jsonContent({
          type: "object",
          properties: {
            resourceType: {
              type: "string",
              enum: ["chat", "file_object", "knowledge_source"],
            },
            resourceId: { type: "string" },
            confirmResourceId: { type: "string" },
          },
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
  "/governance/data-rights/coverage": {
    get: {
      summary:
        "Get metadata-only data rights deletion, export, retention, and support coverage",
      responses: {
        200: success("Data rights coverage", {
          $ref: "#/components/schemas/DataRightsCoverageReport",
        }),
        403: errorResponse,
      },
    },
  },
  "/governance/data-exports/preview": {
    post: {
      summary: "Preview a governed customer data export",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/DataExportRequest",
        }),
      },
      responses: {
        200: success("Data export preview", {
          $ref: "#/components/schemas/DataExportPreview",
        }),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/governance/data-exports/execute": {
    post: {
      summary: "Execute a governed customer data export",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/DataExportRequest",
        }),
      },
      responses: {
        200: success("Data export document", {
          $ref: "#/components/schemas/DataExportDocument",
        }),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/governance/data-exports/packages": {
    get: {
      summary: "List governed customer data export packages",
      responses: {
        200: success("Data export package list", {
          $ref: "#/components/schemas/DataExportPackageList",
        }),
        403: errorResponse,
      },
    },
    post: {
      summary:
        "Create an object-store package for a governed customer data export",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/DataExportRequest",
        }),
      },
      responses: {
        200: success("Data export package", {
          $ref: "#/components/schemas/DataExportPackage",
        }),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
        503: errorResponse,
      },
    },
  },
  "/governance/data-exports/packages/{packageId}": {
    delete: {
      summary: "Delete a governed customer data export package",
      parameters: [
        {
          name: "packageId",
          in: "path",
          required: true,
          schema: { type: "string", pattern: "^export_pkg_[a-f0-9]{20}$" },
        },
      ],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/DeleteDataExportPackageRequest",
        }),
      },
      responses: {
        200: success("Data export package deletion", {
          $ref: "#/components/schemas/DataExportPackageDeleteResult",
        }),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
        503: errorResponse,
      },
    },
  },
  "/governance/data-exports/packages/{packageId}/content": {
    get: {
      summary: "Download a governed customer data export package",
      parameters: [
        {
          name: "packageId",
          in: "path",
          required: true,
          schema: { type: "string", pattern: "^export_pkg_[a-f0-9]{20}$" },
        },
      ],
      responses: {
        200: {
          description: "Data export package document",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/DataExportDocument" },
            },
          },
        },
        403: errorResponse,
        404: errorResponse,
        503: errorResponse,
      },
    },
  },
  "/governance/compliance-report": {
    get: {
      summary: "Export a sanitized governance compliance report",
      responses: { 200: success("Compliance report"), 403: errorResponse },
    },
  },
  "/governance/compliance-report.csv": {
    get: {
      summary: "Export a sanitized governance compliance report as CSV",
      responses: {
        200: {
          description: "Compliance report CSV",
          content: { "text/csv": { schema: { type: "string" } } },
        },
        403: errorResponse,
      },
    },
  },
  "/governance/identity-lifecycle-policy": {
    get: {
      summary: "Get the enterprise identity lifecycle policy posture",
      responses: {
        200: success("Identity lifecycle policy", {
          $ref: "#/components/schemas/IdentityLifecyclePolicy",
        }),
        403: errorResponse,
      },
    },
  },
  "/access-review": {
    get: {
      summary: "List resource grants for access review",
      responses: { 200: arrayEnvelope("Resource grant"), 403: errorResponse },
    },
  },
  "/access-review.csv": {
    get: {
      summary: "Export resource grants for access review as CSV",
      responses: {
        200: {
          description: "Access review CSV",
          content: { "text/csv": { schema: { type: "string" } } },
        },
        403: errorResponse,
      },
    },
  },
  "/access-review/report": {
    get: {
      summary: "Export a redacted enterprise access review report",
      responses: {
        200: success("Access review report", {
          $ref: "#/components/schemas/AccessReviewReport",
        }),
        403: errorResponse,
      },
    },
  },
  "/access-review/report.csv": {
    get: {
      summary: "Export a redacted enterprise access review report as CSV",
      responses: {
        200: {
          description: "Access review report CSV",
          content: { "text/csv": { schema: { type: "string" } } },
        },
        403: errorResponse,
      },
    },
  },
};

export function auditFilterParameters() {
  return [
    {
      name: "action",
      in: "query",
      required: false,
      schema: { type: "string" },
    },
    {
      name: "actorId",
      in: "query",
      required: false,
      schema: { type: "string" },
    },
    {
      name: "outcome",
      in: "query",
      required: false,
      schema: { type: "string", enum: ["success", "failure"] },
    },
    {
      name: "resourceType",
      in: "query",
      required: false,
      schema: { type: "string" },
    },
    {
      name: "resourceId",
      in: "query",
      required: false,
      schema: { type: "string" },
    },
  ];
}
