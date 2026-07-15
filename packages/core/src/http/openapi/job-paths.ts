import { arrayEnvelope, errorResponse, success } from "./helpers";

export const jobPaths = {
  "/jobs": {
    get: {
      summary: "List background jobs",
      responses: { 200: arrayEnvelope("Background job"), 403: errorResponse },
    },
  },
  "/jobs/operational-summary": {
    get: {
      summary: "Summarize background job lag and alert state",
      responses: {
        200: success("Background job operational summary"),
        403: errorResponse,
      },
    },
  },
};
