import { errorResponse, success } from "./helpers";

export const adminAnalyticsPaths = {
  "/admin/analytics/summary": {
    get: {
      summary:
        "Summarize admin quality, usage, provider, tool, and job analytics",
      responses: {
        200: success("Admin analytics summary", {
          $ref: "#/components/schemas/AdminAnalyticsSummary",
        }),
        403: errorResponse,
      },
    },
  },
  "/admin/analytics/summary.csv": {
    get: {
      summary: "Export redacted admin analytics summary as CSV",
      responses: {
        200: {
          description: "Redacted admin analytics CSV export",
          content: {
            "text/csv": { schema: { type: "string" } },
          },
        },
        403: errorResponse,
      },
    },
  },
};
