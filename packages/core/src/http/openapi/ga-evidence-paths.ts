import { errorResponse, success } from "./helpers";

export const gaEvidencePaths = {
  "/admin/ga/evidence-posture": {
    get: {
      summary:
        "Report sanitized GA evidence posture from configured checklist, preflight, target-plan, and bundle files",
      responses: {
        200: success("GA evidence posture", {
          $ref: "#/components/schemas/GaEvidencePostureReport",
        }),
        403: errorResponse,
      },
    },
  },
};
