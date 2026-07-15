import { errorResponse, jsonContent, success } from "./helpers";

export const browserAutomationPaths = {
  "/admin/browser-automation/posture": {
    get: {
      summary:
        "Get sanitized browser automation worker, queue, artifact, and live-evidence posture",
      responses: {
        200: success("Browser automation posture", {
          $ref: "#/components/schemas/BrowserAutomationPostureReport",
        }),
        403: errorResponse,
      },
    },
  },
  "/browser-automation-tasks/claim": {
    post: {
      summary: "Claim an approved browser automation workflow task",
      requestBody: {
        required: false,
        content: jsonContent({
          $ref: "#/components/schemas/ClaimBrowserAutomationTaskRequest",
        }),
      },
      responses: {
        200: success("Browser automation task claim result", {
          $ref: "#/components/schemas/BrowserAutomationTaskClaimResult",
        }),
        403: errorResponse,
        409: errorResponse,
      },
    },
  },
  "/browser-automation-tasks/expire": {
    post: {
      summary: "Expire stale browser automation workflow tasks",
      requestBody: {
        required: false,
        content: jsonContent({
          $ref: "#/components/schemas/ExpireBrowserAutomationTasksRequest",
        }),
      },
      responses: {
        200: success("Browser automation task expiry result", {
          $ref: "#/components/schemas/BrowserAutomationTaskExpiryResult",
        }),
        403: errorResponse,
      },
    },
  },
  "/browser-automation-tasks/{jobId}/renew-lease": {
    post: {
      summary: "Renew an active browser automation task lease",
      parameters: [
        {
          name: "jobId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: false,
        content: jsonContent({
          $ref: "#/components/schemas/ClaimBrowserAutomationTaskRequest",
        }),
      },
      responses: {
        200: success("Browser automation task claim result", {
          $ref: "#/components/schemas/BrowserAutomationTaskClaimResult",
        }),
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
  },
  "/browser-automation-tasks/{jobId}/artifacts/uploads": {
    post: {
      summary:
        "Register a screenshot or trace artifact upload for an active browser automation task",
      parameters: [
        {
          name: "jobId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/CreateBrowserAutomationArtifactUploadRequest",
        }),
      },
      responses: {
        202: success("Browser automation artifact upload registration", {
          $ref: "#/components/schemas/BrowserAutomationArtifactUploadRegistration",
        }),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
  },
  "/browser-automation-artifacts/{artifactId}": {
    get: {
      summary:
        "Read a registered browser automation screenshot or trace artifact",
      parameters: [
        {
          name: "artifactId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: {
          description:
            "Binary browser automation artifact bytes. Access is authorized through Romeo; object-store keys are not exposed.",
          content: {
            "application/gzip": {
              schema: { type: "string", format: "binary" },
            },
            "application/json": {
              schema: { type: "string", format: "binary" },
            },
            "application/octet-stream": {
              schema: { type: "string", format: "binary" },
            },
            "application/x-ndjson": {
              schema: { type: "string", format: "binary" },
            },
            "application/zip": {
              schema: { type: "string", format: "binary" },
            },
            "image/jpeg": { schema: { type: "string", format: "binary" } },
            "image/png": { schema: { type: "string", format: "binary" } },
            "image/webp": { schema: { type: "string", format: "binary" } },
          },
        },
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
  },
  "/browser-automation-tasks/{jobId}/complete": {
    post: {
      summary: "Complete an active browser automation task",
      parameters: [
        {
          name: "jobId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/CompleteBrowserAutomationTaskRequest",
        }),
      },
      responses: {
        200: success("Browser automation task readback result", {
          $ref: "#/components/schemas/BrowserAutomationTaskReadbackResult",
        }),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
  },
  "/browser-automation-tasks/{jobId}/fail": {
    post: {
      summary: "Fail an active browser automation task",
      parameters: [
        {
          name: "jobId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/FailBrowserAutomationTaskRequest",
        }),
      },
      responses: {
        200: success("Browser automation task readback result", {
          $ref: "#/components/schemas/BrowserAutomationTaskReadbackResult",
        }),
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
  },
};
