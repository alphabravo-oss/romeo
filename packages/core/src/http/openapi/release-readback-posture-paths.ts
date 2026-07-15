import { errorResponse, success } from "./helpers";

export const releaseReadbackPosturePaths = {
  "/admin/release-readback/posture": {
    get: {
      summary: "Report sanitized release readback posture",
      responses: {
        200: success("Release readback posture", {
          $ref: "#/components/schemas/ReleaseReadbackPostureReport",
        }),
        403: errorResponse,
      },
    },
  },
};
