import { errorResponse, success } from "./helpers";

export const billingOperationsPosturePaths = {
  "/admin/billing/operations-posture": {
    get: {
      summary: "Get metadata-only billing operations cadence and alert posture",
      responses: {
        200: success("Billing operations posture", {
          $ref: "#/components/schemas/BillingOperationsPostureReport",
        }),
        403: errorResponse,
      },
    },
  },
};
