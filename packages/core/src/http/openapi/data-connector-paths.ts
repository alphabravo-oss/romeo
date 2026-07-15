import {
  arrayEnvelope,
  created,
  errorResponse,
  jsonContent,
  success,
} from "./helpers";

export const dataConnectorPaths = {
  "/admin/data-connectors/posture": {
    get: {
      summary:
        "Get sanitized data connector runtime, worker, sync, and live-evidence posture",
      responses: {
        200: success("Data connector posture", {
          $ref: "#/components/schemas/DataConnectorPostureReport",
        }),
        403: errorResponse,
      },
    },
  },
  "/data-connectors": {
    get: {
      summary: "List data connectors for a workspace",
      parameters: [
        {
          name: "workspaceId",
          in: "query",
          required: false,
          schema: { type: "string" },
        },
      ],
      responses: { 200: arrayEnvelope("Data connector"), 403: errorResponse },
    },
    post: {
      summary: "Create a data connector for a knowledge base",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/CreateDataConnectorRequest",
        }),
      },
      responses: {
        201: created("Data connector"),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/data-connectors/catalog": {
    get: {
      summary: "Inspect supported data connector types and runtime posture",
      responses: {
        200: success("Data connector catalog", {
          $ref: "#/components/schemas/DataConnectorCatalogReport",
        }),
        403: errorResponse,
      },
    },
  },
  "/data-connectors/{connectorId}/sync": {
    post: {
      summary: "Start a data connector sync",
      parameters: [{ $ref: "#/components/parameters/DataConnectorId" }],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/SyncDataConnectorRequest",
        }),
      },
      responses: {
        202: created("Data connector sync"),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
  },
  "/data-connectors/{connectorId}/syncs": {
    get: {
      summary: "List data connector sync attempts",
      parameters: [{ $ref: "#/components/parameters/DataConnectorId" }],
      responses: {
        200: arrayEnvelope("Data connector sync"),
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
};
