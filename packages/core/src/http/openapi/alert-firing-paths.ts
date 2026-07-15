import { errorResponse, success } from "./helpers";

export const alertFiringPaths = {
  "/admin/alert-firing/posture": {
    get: {
      summary: "Report sanitized live alert-firing evidence posture",
      responses: {
        200: success("Alert-firing posture", {
          $ref: "#/components/schemas/AlertFiringPostureReport",
        }),
        403: errorResponse,
      },
    },
  },
};
