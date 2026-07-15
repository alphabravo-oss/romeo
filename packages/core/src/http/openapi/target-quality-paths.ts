import { errorResponse, success } from "./helpers";

export const targetQualityPaths = {
  "/admin/target-quality/posture": {
    get: {
      summary: "Report sanitized target-quality evidence posture",
      responses: {
        200: success("Target quality posture", {
          $ref: "#/components/schemas/TargetQualityPostureReport",
        }),
        403: errorResponse,
      },
    },
  },
};
