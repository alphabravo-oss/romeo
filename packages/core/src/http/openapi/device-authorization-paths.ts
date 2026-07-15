import { errorResponse, jsonContent, success } from "./helpers";

export const deviceAuthorizationPaths = {
  "/device-authorizations": {
    get: {
      summary: "List device authorizations for the current user",
      description:
        "Returns device authorization metadata without refresh-token hashes.",
      responses: {
        200: success("Device authorizations", {
          type: "array",
          items: { $ref: "#/components/schemas/DeviceAuthorization" },
        }),
        403: errorResponse,
      },
    },
    post: {
      summary: "Create a refreshable device authorization",
      description:
        "Returns one-time access and refresh tokens. Store them in platform secure storage; later list responses return metadata only.",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/CreateDeviceAuthorizationRequest",
        }),
      },
      responses: {
        201: success("Created device authorization", {
          $ref: "#/components/schemas/CreatedDeviceAuthorization",
        }),
        400: errorResponse,
        403: errorResponse,
      },
    },
  },
  "/device-authorizations/refresh": {
    post: {
      summary: "Rotate a device authorization with a refresh token",
      description:
        "Public native-client refresh endpoint. A valid refresh token revokes the previous backing access API key, rotates the refresh token, and returns replacement tokens once.",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/RefreshDeviceAuthorizationRequest",
        }),
      },
      responses: {
        200: success("Refreshed device authorization", {
          $ref: "#/components/schemas/CreatedDeviceAuthorization",
        }),
        400: errorResponse,
        403: errorResponse,
      },
    },
  },
  "/device-authorizations/{deviceAuthorizationId}/revoke": {
    post: {
      summary: "Revoke a device authorization",
      description:
        "Owner/admin revocation invalidates the current backing access API key and refresh token.",
      parameters: [
        {
          name: "deviceAuthorizationId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: success("Device authorization", {
          $ref: "#/components/schemas/DeviceAuthorization",
        }),
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
};
