import { errorResponse, success } from "./helpers";

export const secretRotationDrillPosturePaths = {
  "/admin/secret-rotation/drill-posture": {
    get: {
      summary: "Get metadata-only secret rotation drill posture",
      responses: {
        200: success("Secret rotation drill posture", {
          $ref: "#/components/schemas/SecretRotationDrillPostureReport",
        }),
        403: errorResponse,
      },
    },
  },
};
