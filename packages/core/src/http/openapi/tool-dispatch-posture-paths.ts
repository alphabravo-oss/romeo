import { errorResponse, success } from "./helpers";

export const toolDispatchPosturePaths = {
  "/admin/tool-dispatch/posture": {
    get: {
      summary:
        "Get sanitized tool-dispatch worker, queue, payload, and live-evidence posture",
      responses: {
        200: success("Tool-dispatch posture", {
          $ref: "#/components/schemas/ToolDispatchPostureReport",
        }),
        403: errorResponse,
      },
    },
  },
};
