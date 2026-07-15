import { errorResponse, success } from "./helpers";

export const edgeSecurityPaths = {
  "/admin/edge-security/posture": {
    get: {
      summary: "Get sanitized edge, ingress, WAF, and security-header posture",
      responses: {
        200: success("Edge security posture", {
          $ref: "#/components/schemas/EdgeSecurityPostureReport",
        }),
        403: errorResponse,
      },
    },
  },
};
