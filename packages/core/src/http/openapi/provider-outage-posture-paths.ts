import { errorResponse, success } from "./helpers";

export const providerOutagePosturePaths = {
  "/admin/providers/outage-posture": {
    get: {
      summary: "Get metadata-only provider outage drill posture",
      responses: {
        200: success("Provider outage posture", {
          $ref: "#/components/schemas/ProviderOutagePostureReport",
        }),
        403: errorResponse,
      },
    },
  },
};
