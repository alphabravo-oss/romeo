import { errorResponse, jsonContent, success } from "./helpers";

export const abuseControlPaths = {
  "/admin/abuse-controls": {
    get: {
      summary: "Get organization abuse controls and entitlement posture",
      responses: {
        200: success("Abuse control policy", {
          $ref: "#/components/schemas/AbuseControlPolicyReport",
        }),
        403: errorResponse,
      },
    },
    patch: {
      summary: "Update organization suspension, entitlement, and kill-switch policy",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/UpdateAbuseControlPolicyRequest",
        }),
      },
      responses: {
        200: success("Abuse control policy", {
          $ref: "#/components/schemas/AbuseControlPolicyReport",
        }),
        400: errorResponse,
        403: errorResponse,
      },
    },
  },
};

