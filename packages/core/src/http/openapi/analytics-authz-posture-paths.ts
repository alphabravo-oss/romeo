import { dataEnvelope, jsonContent } from "./helpers";

export const analyticsAuthzPosturePaths = {
  "/admin/analytics/authz-posture": {
    get: {
      summary: "Read target analytics authorization evidence posture",
      responses: {
        200: {
          description:
            "Metadata-only posture for reviewed target analytics authorization, export, scope, resource-grant, tenancy, and redaction evidence.",
          content: jsonContent(
            dataEnvelope({
              $ref: "#/components/schemas/AnalyticsAuthzPostureReport",
            }),
          ),
        },
      },
    },
  },
};
