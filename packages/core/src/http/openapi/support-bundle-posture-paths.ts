import { errorResponse, success } from "./helpers";

export const supportBundlePosturePaths = {
  "/admin/support-bundle/posture": {
    get: {
      summary: "Report sanitized support bundle posture",
      responses: {
        200: success("Support bundle posture", {
          $ref: "#/components/schemas/SupportBundlePostureReport",
        }),
        403: errorResponse,
      },
    },
  },
};
