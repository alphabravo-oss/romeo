import { errorResponse, success } from "./helpers";

export const ciGovernancePosturePaths = {
  "/admin/ci-governance/posture": {
    get: {
      summary: "Report sanitized CI governance posture",
      responses: {
        200: success("CI governance posture", {
          $ref: "#/components/schemas/CiGovernancePostureReport",
        }),
        403: errorResponse,
      },
    },
  },
};
