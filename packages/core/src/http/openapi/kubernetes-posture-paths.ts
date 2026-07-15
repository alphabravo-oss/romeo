import { errorResponse, success } from "./helpers";

export const kubernetesPosturePaths = {
  "/admin/kubernetes/posture": {
    get: {
      summary: "Report sanitized Kubernetes live-evidence posture",
      responses: {
        200: success("Kubernetes posture", {
          $ref: "#/components/schemas/KubernetesPostureReport",
        }),
        403: errorResponse,
      },
    },
  },
};
