import { errorResponse, success } from "./helpers";

export const releaseSecurityPosturePaths = {
  "/admin/release-security/posture": {
    get: {
      summary: "Report sanitized release security posture",
      responses: {
        200: success("Release security posture", {
          $ref: "#/components/schemas/ReleaseSecurityPostureReport",
        }),
        403: errorResponse,
      },
    },
  },
};
