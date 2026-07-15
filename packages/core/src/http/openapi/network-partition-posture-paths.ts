import { errorResponse, success } from "./helpers";

export const networkPartitionPosturePaths = {
  "/admin/network/partition-posture": {
    get: {
      summary: "Get metadata-only network partition drill posture",
      responses: {
        200: success("Network partition posture", {
          $ref: "#/components/schemas/NetworkPartitionPostureReport",
        }),
        403: errorResponse,
      },
    },
  },
};
